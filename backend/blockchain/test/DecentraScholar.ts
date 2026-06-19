import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("DecentraScholar contracts", function () {
  async function deployFixture() {
    const [owner, editor, author, coordinator, reviewer1, reviewer2, reader] =
      await ethers.getSigners();

    const dstToken = await ethers.deployContract("DSTToken", [owner.address]);
    const dstProtocolVault = await ethers.deployContract("DSTProtocolVault", [
      owner.address,
      await dstToken.getAddress(),
    ]);
    const dstTreasury = await ethers.deployContract("DSTTreasury", [
      owner.address,
      await dstToken.getAddress(),
      ethers.parseEther("0.001"),
    ]);
    const registry = await ethers.deployContract("PaperRegistry", [owner.address]);
    const reviewManager = await ethers.deployContract("ReviewManager", [
      owner.address,
      await registry.getAddress(),
    ]);
    const interactions = await ethers.deployContract("ReaderInteractions", [
      owner.address,
      await registry.getAddress(),
    ]);

    await registry.setEditor(editor.address, true);
    await registry.setReviewManager(await reviewManager.getAddress());
    await reviewManager.setCoordinator(coordinator.address, true);
    await dstToken.setMinter(await dstTreasury.getAddress(), true);
    await dstProtocolVault.setCoordinator(coordinator.address, true);
    await owner.sendTransaction({
      to: await dstTreasury.getAddress(),
      value: ethers.parseEther("50"),
    });

    return {
      owner,
      editor,
      author,
      coordinator,
      reviewer1,
      reviewer2,
      reader,
      dstToken,
      dstProtocolVault,
      dstTreasury,
      registry,
      reviewManager,
      interactions,
    };
  }

  it("maps the submission, review, and publication flow", async function () {
    const { author, coordinator, reviewer1, reviewer2, registry, reviewManager } =
      await deployFixture();
    const paperId = ethers.id("P001");

    await registry
      .connect(author)
      .submitPaper(
        paperId,
        "Decentralised Governance Models",
        "Political Science",
        "ipfs://abstract-v1",
        "ipfs://submission-v1",
      );

    let paper = await registry.getPaper(paperId);
    expect(paper.author).to.equal(author.address);
    expect(paper.status).to.equal(1n);

    await reviewManager
      .connect(coordinator)
      .createSession(
        paperId,
        [reviewer1.address, reviewer2.address],
        [true, false],
        1_800_000_000,
        1,
      );
    await reviewManager
      .connect(coordinator)
      .assignReviewers(paperId, [reviewer1.address, reviewer2.address]);

    paper = await registry.getPaper(paperId);
    expect(paper.status).to.equal(2n);

    await reviewManager
      .connect(reviewer1)
      .submitReview(1, 1, ethers.id("review-1"));
    await reviewManager
      .connect(reviewer2)
      .submitReview(1, 1, ethers.id("review-2"));

    await reviewManager
      .connect(coordinator)
      .finalizeSession(1, 1, ethers.encodeBytes32String("majority_accept"));

    paper = await registry.getPaper(paperId);
    expect(paper.status).to.equal(4n);

    await registry
      .connect(author)
      .publishPaper(paperId, "10.5555/fyp.2026.001", "ipfs://publication-v1");

    paper = await registry.getPaper(paperId);
    expect(paper.status).to.equal(6n);
    expect(await registry.isPublished(paperId)).to.equal(true);
    expect(paper.doi).to.equal("10.5555/fyp.2026.001");
  });

  it("supports the reader interaction model from the frontend", async function () {
    const { author, reader, coordinator, reviewer1, registry, reviewManager, interactions } =
      await deployFixture();
    const paperId = ethers.id("P009");

    await registry
      .connect(author)
      .submitPaper(
        paperId,
        "Reputation Systems in DAOs",
        "Computer Science",
        "ipfs://abstract",
        "ipfs://submission",
      );

    await reviewManager
      .connect(coordinator)
      .createSession(paperId, [reviewer1.address], [true], 1_800_000_100, 1);
    await reviewManager
      .connect(coordinator)
      .assignReviewers(paperId, [reviewer1.address]);
    await reviewManager
      .connect(reviewer1)
      .submitReview(1, 1, ethers.id("review-pass"));
    await reviewManager
      .connect(coordinator)
      .finalizeSession(1, 1, ethers.encodeBytes32String("single_accept"));
    await registry.connect(author).publishPaper(paperId, "10.5555/fyp.2026.009", "ipfs://pub");

    await interactions.connect(reader).setBookmark(paperId, true);
    expect(await interactions.bookmarks(paperId, reader.address)).to.equal(true);

    await interactions.connect(reader).recordRead(paperId);
    let stats = await interactions.getPaperStats(paperId);
    expect(stats.reads).to.equal(1n);

    await interactions.connect(reader).submitRating(paperId, 8);
    stats = await interactions.getPaperStats(paperId);
    expect(stats.ratingCount).to.equal(1n);
    expect(stats.ratingTotalHalfSteps).to.equal(8n);
    expect(await interactions.userRatings(paperId, reader.address)).to.equal(8n);
    expect(await interactions.getAverageRatingHalfSteps(paperId)).to.equal(8n);

    await interactions.connect(reader).registerDownload(paperId);
    await interactions.connect(reader).registerDownload(paperId);
    await interactions.connect(reader).registerDownload(paperId);

    stats = await interactions.getPaperStats(paperId);
    expect(stats.downloads).to.equal(3n);

    const policy = await interactions.getDownloadPolicy(paperId, reader.address);
    expect(policy.allowed).to.equal(false);
    expect(policy.remaining).to.equal(0n);
    expect(policy.recentDownloads).to.equal(3n);

    await expect(interactions.connect(reader).registerDownload(paperId))
      .to.be.revertedWithCustomError(interactions, "DownloadLimitReached");
  });

  it("mints DST on purchase and redeems it back for ETH", async function () {
    const { reader, dstToken, dstTreasury } = await deployFixture();
    const tokenAmount = ethers.parseEther("25");
    const ethCost = ethers.parseEther("0.025");

    await dstTreasury.connect(reader).buy(tokenAmount, { value: ethCost });
    expect(await dstToken.balanceOf(reader.address)).to.equal(tokenAmount);

    await dstToken.connect(reader).approve(await dstTreasury.getAddress(), tokenAmount);
    await dstTreasury.connect(reader).redeem(tokenAmount);

    expect(await dstToken.balanceOf(reader.address)).to.equal(0n);
  });

  it("moves submission fees, reviewer stakes, rewards, and slashing on-chain", async function () {
    const { author, coordinator, reviewer1, dstToken, dstTreasury, dstProtocolVault } =
      await deployFixture();
    const paperId = ethers.id("P777");
    const submissionFee = ethers.parseEther("90");
    const reviewerStake = ethers.parseEther("18");
    const reviewerReward = ethers.parseEther("20");
    const slashedAmount = ethers.parseEther("3");

    await dstTreasury.connect(author).buy(submissionFee, { value: ethers.parseEther("0.09") });
    await dstTreasury.connect(reviewer1).buy(reviewerStake, { value: ethers.parseEther("0.018") });

    await dstToken.connect(author).approve(await dstProtocolVault.getAddress(), submissionFee);
    await dstProtocolVault.connect(author).reserveSubmissionFee(paperId, submissionFee);

    const paperFunding = await dstProtocolVault.getPaperFunding(paperId);
    expect(paperFunding.totalSubmitted).to.equal(submissionFee);
    expect(paperFunding.priorityFeesSubmitted).to.equal(0n);
    expect(paperFunding.rewardPoolRemaining).to.equal(ethers.parseEther("67.5"));
    expect(paperFunding.feeVaultAccrued).to.equal(ethers.parseEther("22.5"));

    await dstToken.connect(reviewer1).approve(await dstProtocolVault.getAddress(), reviewerStake);
    await dstProtocolVault.connect(reviewer1).lockReviewerStake(paperId, reviewerStake);

    const stake = await dstProtocolVault.getReviewerStake(paperId, reviewer1.address);
    expect(stake.active).to.equal(true);
    expect(stake.amount).to.equal(reviewerStake);

    const reviewerBalanceBefore = await dstToken.balanceOf(reviewer1.address);
    await dstProtocolVault
      .connect(coordinator)
      .settleReviewer(paperId, reviewer1.address, reviewerReward, slashedAmount);
    const reviewerBalanceAfter = await dstToken.balanceOf(reviewer1.address);

    expect(reviewerBalanceAfter - reviewerBalanceBefore).to.equal(
      reviewerReward + (reviewerStake - slashedAmount)
    );

    const fundingAfter = await dstProtocolVault.getPaperFunding(paperId);
    expect(fundingAfter.rewardPoolRemaining).to.equal(ethers.parseEther("47.5"));
    expect(fundingAfter.feeVaultAccrued).to.equal(ethers.parseEther("25.5"));
  });

  it("allows revision-requested papers to re-enter review", async function () {
    const { author, coordinator, reviewer1, registry, reviewManager } =
      await deployFixture();
    const paperId = ethers.id("P004");

    await registry
      .connect(author)
      .submitPaper(paperId, "Clinical Risk Prediction", "Data Science", "", "");

    await reviewManager
      .connect(coordinator)
      .createSession(paperId, [reviewer1.address], [false], 1_800_000_200, 1);
    await reviewManager
      .connect(coordinator)
      .assignReviewers(paperId, [reviewer1.address]);
    await reviewManager.connect(reviewer1).submitReview(1, 2, ethers.id("needs-revision"));
    await reviewManager
      .connect(coordinator)
      .finalizeSession(1, 3, ethers.encodeBytes32String("needs_revision"));

    let paper = await registry.getPaper(paperId);
    expect(paper.status).to.equal(3n);

    await reviewManager
      .connect(coordinator)
      .createSession(paperId, [reviewer1.address], [false], 1_800_000_300, 2);
    await reviewManager
      .connect(coordinator)
      .assignReviewers(paperId, [reviewer1.address]);

    paper = await registry.getPaper(paperId);
    expect(paper.status).to.equal(2n);
  });

  it("tracks priority fees separately from the base submission fee", async function () {
    const { author, dstToken, dstTreasury, dstProtocolVault } = await deployFixture();
    const paperId = ethers.id("P888");
    const submissionFee = ethers.parseEther("90");
    const priorityFee = ethers.parseEther("20");

    await dstTreasury.connect(author).buy(submissionFee + priorityFee, {
      value: ethers.parseEther("0.11"),
    });

    await dstToken.connect(author).approve(await dstProtocolVault.getAddress(), submissionFee + priorityFee);
    await dstProtocolVault.connect(author).reserveSubmissionFee(paperId, submissionFee);
    await dstProtocolVault.connect(author).reservePriorityFee(paperId, priorityFee);

    const funding = await dstProtocolVault.getPaperFunding(paperId);
    expect(funding.totalSubmitted).to.equal(submissionFee + priorityFee);
    expect(funding.priorityFeesSubmitted).to.equal(priorityFee);
    expect(funding.rewardPoolRemaining).to.equal(ethers.parseEther("87.5"));
    expect(funding.feeVaultAccrued).to.equal(ethers.parseEther("22.5"));
  });

  it("stores richer session state for incomplete, high-priority, and abandoned review rounds", async function () {
    const { author, coordinator, reviewer1, registry, reviewManager } = await deployFixture();
    const paperId = ethers.id("P999");

    await registry
      .connect(author)
      .submitPaper(paperId, "Panel Recovery Logic", "Distributed Systems", "", "");

    await reviewManager
      .connect(coordinator)
      .createSession(paperId, [reviewer1.address], [false], 1_800_000_400, 1);

    await reviewManager
      .connect(coordinator)
      .markRoundIncomplete(
        1,
        1_800_000_500,
        true,
        ethers.encodeBytes32String("single_submit")
      );

    let session = await reviewManager.getSession(1);
    expect(session.phase).to.equal(3n);
    expect(session.roundStatus).to.equal(2n);
    expect(session.highPriority).to.equal(true);

    await reviewManager
      .connect(coordinator)
      .setHighPriority(1, true, ethers.encodeBytes32String("priority_fee_paid"));
    await reviewManager
      .connect(coordinator)
      .extendDeadline(1, 1_800_000_600, ethers.encodeBytes32String("extended"));

    session = await reviewManager.getSession(1);
    expect(session.deadline).to.equal(1_800_000_600n);
    expect(session.highPriority).to.equal(true);

    await reviewManager
      .connect(coordinator)
      .finalizeSession(1, 4, ethers.encodeBytes32String("review_abandoned"));

    session = await reviewManager.getSession(1);
    expect(session.decision).to.equal(4n);
    expect(session.phase).to.equal(4n);
    expect(session.finalized).to.equal(true);

    const paper = await registry.getPaper(paperId);
    expect(paper.status).to.equal(7n);
  });
});
