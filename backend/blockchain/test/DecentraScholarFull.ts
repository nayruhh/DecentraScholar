/**
 * DecentraScholar - Report-Style Hardhat Test Suite
 * =================================================
 * 8 representative scenarios used for report evidence:
 *
 * T1 - Full Publish Flow
 * T2 - Submission Fee Split
 * T3 - Reviewer Assignment Guard
 * T4 - Majority Acceptance
 * T5 - Rebuttal Deadlock and Tiebreaker
 * T6 - No-Show Slashing
 * T7 - Registry Access Control
 * T8 - Reader Interaction Guards
 *
 * Run with: npx.cmd hardhat test .\test\DecentraScholarFull.ts
 */

import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

async function deployAll() {
  const [owner, author, reviewer1, reviewer2, reviewer3, stranger, reader] =
    await ethers.getSigners();

  const dstToken = await ethers.deployContract("DSTToken", [owner.address]);
  const weiPerDst = ethers.parseUnits("1", 15);
  const dstTreasury = await ethers.deployContract("DSTTreasury", [
    owner.address,
    await dstToken.getAddress(),
    weiPerDst,
  ]);
  const dstProtocolVault = await ethers.deployContract("DSTProtocolVault", [
    owner.address,
    await dstToken.getAddress(),
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

  await registry.setReviewManager(await reviewManager.getAddress());
  await dstToken.setMinter(await dstTreasury.getAddress(), true);
  await dstProtocolVault.setCoordinator(owner.address, true);
  await reviewManager.setCoordinator(owner.address, true);

  await owner.sendTransaction({
    to: await dstTreasury.getAddress(),
    value: ethers.parseEther("100"),
  });

  return {
    owner,
    author,
    reviewer1,
    reviewer2,
    reviewer3,
    stranger,
    reader,
    dstToken,
    dstTreasury,
    dstProtocolVault,
    registry,
    reviewManager,
    interactions,
    weiPerDst,
  };
}

async function buyDst(ctx: Awaited<ReturnType<typeof deployAll>>, signer: Awaited<ReturnType<typeof ethers.getSigners>>[number], tokenAmount: bigint) {
  const cost = (tokenAmount * ctx.weiPerDst) / ethers.parseEther("1");
  await ctx.dstTreasury.connect(signer).buy(tokenAmount, { value: cost });
}

async function createAssignedSession(
  ctx: Awaited<ReturnType<typeof deployAll>>,
  paperId: string,
  reviewers: Awaited<ReturnType<typeof ethers.getSigners>>[number][],
  revisionCycle = 1
) {
  const addresses = reviewers.map((reviewer) => reviewer.address);
  await ctx.reviewManager.connect(ctx.owner).createSession(
    paperId,
    addresses,
    addresses.map(() => false),
    1_900_000_000 + revisionCycle,
    revisionCycle
  );
  await ctx.reviewManager.connect(ctx.owner).assignReviewers(paperId, addresses);
}

async function publishAcceptedPaper(ctx: Awaited<ReturnType<typeof deployAll>>, label: string) {
  const paperId = ethers.id(label);
  await ctx.registry.connect(ctx.author).submitPaper(
    paperId,
    `${label} Published Paper`,
    "Computer Science",
    "ipfs://abstract",
    "ipfs://submission"
  );
  await createAssignedSession(ctx, paperId, [ctx.reviewer1]);
  await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://review-accept");
  await ctx.reviewManager.connect(ctx.owner).finalizeSession(
    1,
    1,
    ethers.encodeBytes32String("accepted")
  );
  await ctx.registry.connect(ctx.author).publishPaper(paperId, `10.5555/${label}`, "ipfs://publication");
  return paperId;
}

describe("DecentraScholar - 8 Selected Report Tests", function () {
  describe("T1 - Full Publish Flow", function () {
    it("accepted paper can be acknowledged and officially published by the author", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("T1-paper");
      const doi = "10.5555/t1.2026";

      const submitTx = await ctx.registry.connect(ctx.author).submitPaper(
        paperId,
        "T1 Full Publish Flow",
        "Computer Science",
        "ipfs://abstract",
        "ipfs://submission"
      );
      const submitReceipt = await submitTx.wait();

      console.log("\n  [T1] Paper submitted");
      console.log(`       Gas used (submitPaper): ${submitReceipt!.gasUsed}`);

      await createAssignedSession(ctx, paperId, [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]);
      for (const reviewer of [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]) {
        await ctx.reviewManager.connect(reviewer).submitReview(1, 1, "ipfs://review-accept");
      }

      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1,
        1,
        ethers.encodeBytes32String("unanimous_accept")
      );

      const acceptedPaper = await ctx.registry.getPaper(paperId);
      expect(acceptedPaper.status).to.equal(4n);
      console.log("\n  [T1] Session finalized -> Accepted");
      console.log(`       paper.status: ${acceptedPaper.status} (4=Accepted)`);

      const ackTx = await ctx.registry.connect(ctx.author).acknowledgeDecision(paperId);
      const ackReceipt = await ackTx.wait();
      expect(await ctx.registry.hasAcknowledgedDecision(paperId, ctx.author.address)).to.equal(true);
      console.log("\n  [T1] Author acknowledged decision");
      console.log(`       Gas used (acknowledgeDecision): ${ackReceipt!.gasUsed}`);

      const publishTx = await ctx.registry.connect(ctx.author).publishPaper(paperId, doi, "ipfs://publication");
      const publishReceipt = await publishTx.wait();
      const publishedPaper = await ctx.registry.getPaper(paperId);

      expect(await ctx.registry.isPublished(paperId)).to.equal(true);
      expect(publishedPaper.doi).to.equal(doi);
      expect(Number(publishedPaper.publishedAt)).to.be.greaterThan(0);

      console.log("\n  [T1] Author published paper");
      console.log(`       Gas used (publishPaper): ${publishReceipt!.gasUsed}`);
      console.log("       isPublished: true");
      console.log(`       paper.doi: ${publishedPaper.doi}`);
      console.log(`       paper.publishedAt: ${publishedPaper.publishedAt}`);
      console.log("  [T1] PASS");
    });
  });

  describe("T2 - Submission Fee Split", function () {
    it("splits a 100 DST submission fee into 75 DST reward pool and 25 DST fee vault", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("T2-paper");
      const submissionFee = ethers.parseEther("100");

      await buyDst(ctx, ctx.author, submissionFee);
      await ctx.dstToken.connect(ctx.author).approve(await ctx.dstProtocolVault.getAddress(), submissionFee);

      console.log("\n  [T2] Reserving submission fee: 100 DST");
      const tx = await ctx.dstProtocolVault.connect(ctx.author).reserveSubmissionFee(paperId, submissionFee);
      const receipt = await tx.wait();
      const funding = await ctx.dstProtocolVault.getPaperFunding(paperId);

      expect(funding.rewardPoolRemaining).to.equal(ethers.parseEther("75"));
      expect(funding.feeVaultAccrued).to.equal(ethers.parseEther("25"));
      expect(await ctx.dstProtocolVault.feeVaultBalance()).to.equal(ethers.parseEther("25"));

      console.log(`       totalSubmitted:      ${ethers.formatEther(funding.totalSubmitted)} DST`);
      console.log(`       rewardPoolRemaining: ${ethers.formatEther(funding.rewardPoolRemaining)} DST`);
      console.log(`       feeVaultAccrued:     ${ethers.formatEther(funding.feeVaultAccrued)} DST`);
      console.log(`       feeVaultBalance:     ${ethers.formatEther(await ctx.dstProtocolVault.feeVaultBalance())} DST`);
      console.log(`       Gas used (reserveSubmissionFee): ${receipt!.gasUsed}`);
      console.log("  [T2] Expected split: 75% reviewer reward pool / 25% protocol fee vault");
      console.log("  [T2] Observed split: 75 DST reward pool / 25 DST fee vault");
      console.log("  [T2] PASS");
    });
  });

  describe("T3 - Reviewer Assignment Guard", function () {
    it("registers pre-assigned reviewers during session creation", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("T3-paper");

      await ctx.registry.connect(ctx.author).submitPaper(
        paperId,
        "T3 Assignment Guard",
        "Security",
        "ipfs://abstract",
        "ipfs://submission"
      );
      await ctx.reviewManager.connect(ctx.owner).createSession(
        paperId,
        [ctx.reviewer1.address],
        [false],
        1_900_000_000,
        1
      );

      console.log("\n  [T3] Session created with reviewer slot");
      console.log("       assignedReviewers mapping populated by createSession");
      console.log("\n  [T3] Reviewer attempts to submit review");

      expect(await ctx.reviewManager.assignedReviewers(paperId, ctx.reviewer1.address)).to.equal(true);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://review");

      console.log("       Expected result: submission succeeds");
      console.log("  [T3] PASS");
    });
  });

  describe("T4 - Majority Acceptance", function () {
    it("accepts a paper after two accept votes and one reject vote, then rewards reviewers", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("T4-paper");
      const submissionFee = ethers.parseEther("90");
      const stakeAmount = ethers.parseEther("15");
      const rewardAmount = ethers.parseEther("20");

      await ctx.registry.connect(ctx.author).submitPaper(
        paperId,
        "T4 Majority Acceptance",
        "Physics",
        "ipfs://abstract",
        "ipfs://submission"
      );
      await createAssignedSession(ctx, paperId, [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]);

      await buyDst(ctx, ctx.author, submissionFee);
      await ctx.dstToken.connect(ctx.author).approve(await ctx.dstProtocolVault.getAddress(), submissionFee);
      await ctx.dstProtocolVault.connect(ctx.author).reserveSubmissionFee(paperId, submissionFee);

      for (const reviewer of [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]) {
        await buyDst(ctx, reviewer, stakeAmount);
        await ctx.dstToken.connect(reviewer).approve(await ctx.dstProtocolVault.getAddress(), stakeAmount);
        await ctx.dstProtocolVault.connect(reviewer).lockReviewerStake(paperId, stakeAmount);
      }

      console.log("\n  [T4] Submitting reviews:");
      const votes = [
        { reviewer: ctx.reviewer1, vote: 1, label: "Accept" },
        { reviewer: ctx.reviewer2, vote: 1, label: "Accept" },
        { reviewer: ctx.reviewer3, vote: 2, label: "Reject" },
      ];
      for (const vote of votes) {
        const tx = await ctx.reviewManager.connect(vote.reviewer).submitReview(1, vote.vote, `ipfs://${vote.label}`);
        const receipt = await tx.wait();
        console.log(`       ${vote.reviewer.address.slice(0, 10)}... vote=${vote.label}  gas=${receipt!.gasUsed}`);
      }

      const finalizeTx = await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1,
        1,
        ethers.encodeBytes32String("majority_accept")
      );
      const finalizeReceipt = await finalizeTx.wait();
      const session = await ctx.reviewManager.getSession(1);
      const paper = await ctx.registry.getPaper(paperId);

      expect(session.decision).to.equal(1n);
      expect(session.finalized).to.equal(true);
      expect(paper.status).to.equal(4n);

      console.log("\n  [T4] Session finalized -> Accepted");
      console.log(`       Gas used (finalizeSession): ${finalizeReceipt!.gasUsed}`);
      console.log(`       session.decision: ${session.decision} (1=Accepted)`);
      console.log(`       session.finalized: ${session.finalized}`);
      console.log(`       paper.status: ${paper.status} (4=Accepted)`);

      console.log("\n  [T4] Settling reviewers:");
      for (const reviewer of [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]) {
        const before = await ctx.dstToken.balanceOf(reviewer.address);
        const tx = await ctx.dstProtocolVault.connect(ctx.owner).settleReviewer(
          paperId,
          reviewer.address,
          rewardAmount,
          0n
        );
        const receipt = await tx.wait();
        const after = await ctx.dstToken.balanceOf(reviewer.address);
        const received = after - before;
        expect(received).to.equal(rewardAmount + stakeAmount);
        console.log(`       ${reviewer.address.slice(0, 10)}... received ${ethers.formatEther(received)} DST  gas=${receipt!.gasUsed}`);
      }

      console.log("  [T4] PASS");
    });
  });

  describe("T5 - Rebuttal Deadlock and Tiebreaker", function () {
    it("records a tiebreaker and finalizes a deadlocked rebuttal path", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("T5-paper");

      await ctx.registry.connect(ctx.author).submitPaper(
        paperId,
        "T5 Rebuttal Deadlock",
        "Distributed Systems",
        "ipfs://abstract",
        "ipfs://submission"
      );
      await createAssignedSession(ctx, paperId, [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]);

      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://blind-accept");
      await ctx.reviewManager.connect(ctx.reviewer2).submitReview(1, 3, "ipfs://blind-neutral");
      await ctx.reviewManager.connect(ctx.reviewer3).submitReview(1, 2, "ipfs://blind-reject");

      console.log("\n  [T5] Blind review produced no final majority");
      const rebuttalTx = await ctx.reviewManager.connect(ctx.owner).setRebuttalPhase(
        1,
        ethers.encodeBytes32String("mixed_votes")
      );
      const rebuttalReceipt = await rebuttalTx.wait();
      console.log("       Session moved to Rebuttal phase");
      console.log(`       Gas used (setRebuttalPhase): ${rebuttalReceipt!.gasUsed}`);

      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://rebuttal-accept");
      await ctx.reviewManager.connect(ctx.reviewer2).submitReview(1, 2, "ipfs://rebuttal-reject");

      console.log("\n  [T5] Rebuttal phase remained deadlocked");
      await ctx.reviewManager.connect(ctx.owner).assignTiebreaker(paperId, ctx.stranger.address);
      expect(await ctx.reviewManager.hasTiebreaker(paperId)).to.equal(true);
      expect(await ctx.reviewManager.assignedReviewers(paperId, ctx.stranger.address)).to.equal(true);
      console.log("       Tiebreaker reviewer assigned");
      console.log("       hasTiebreaker flag set: true");

      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1,
        2,
        ethers.encodeBytes32String("tiebreaker_reject")
      );
      const paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(5n);

      console.log("\n  [T5] Final decision resolved through tiebreaker path");
      console.log("       Deadlock handled without leaving session unfinished");
      console.log(`       paper.status: ${paper.status} (5=Rejected)`);
      console.log("  [T5] PASS");
    });
  });

  describe("T6 - No-Show Slashing", function () {
    it("clears a no-show reviewer slot, slashes the stake, and allows replacement", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("T6-paper");
      const submissionFee = ethers.parseEther("90");
      const stakeAmount = ethers.parseEther("15");

      await ctx.registry.connect(ctx.author).submitPaper(
        paperId,
        "T6 No-Show Slashing",
        "Law",
        "ipfs://abstract",
        "ipfs://submission"
      );
      await ctx.reviewManager.connect(ctx.owner).createSession(
        paperId,
        [ctx.reviewer1.address, ctx.reviewer2.address],
        [false, false],
        1_900_000_000,
        1
      );

      await buyDst(ctx, ctx.author, submissionFee);
      await ctx.dstToken.connect(ctx.author).approve(await ctx.dstProtocolVault.getAddress(), submissionFee);
      await ctx.dstProtocolVault.connect(ctx.author).reserveSubmissionFee(paperId, submissionFee);

      await buyDst(ctx, ctx.reviewer1, stakeAmount);
      await ctx.dstToken.connect(ctx.reviewer1).approve(await ctx.dstProtocolVault.getAddress(), stakeAmount);
      await ctx.dstProtocolVault.connect(ctx.reviewer1).lockReviewerStake(paperId, stakeAmount);

      const feeVaultBefore = await ctx.dstProtocolVault.feeVaultBalance();
      const reviewerBalanceBefore = await ctx.dstToken.balanceOf(ctx.reviewer1.address);

      console.log(`\n  [T6] Reviewer stake locked: ${ethers.formatEther(stakeAmount)} DST`);
      console.log(`       feeVaultBalance before slash: ${ethers.formatEther(feeVaultBefore)} DST`);

      const clearTx = await ctx.reviewManager.connect(ctx.owner).clearReviewerSlot(1, 0);
      const clearReceipt = await clearTx.wait();
      const clearedSlot = await ctx.reviewManager.getReviewSlot(1, 0);
      expect(clearedSlot.reviewer).to.equal(ethers.ZeroAddress);

      console.log("\n  [T6] Reviewer failed to participate");
      console.log("       Slot cleared");
      console.log(`       reviewer address reset to zero address: ${clearedSlot.reviewer}`);
      console.log(`       Gas used (clearReviewerSlot): ${clearReceipt!.gasUsed}`);

      const slashTx = await ctx.dstProtocolVault.connect(ctx.owner).settleReviewer(
        paperId,
        ctx.reviewer1.address,
        0n,
        stakeAmount
      );
      const slashReceipt = await slashTx.wait();
      const feeVaultAfter = await ctx.dstProtocolVault.feeVaultBalance();
      const reviewerBalanceAfter = await ctx.dstToken.balanceOf(ctx.reviewer1.address);

      expect(feeVaultAfter - feeVaultBefore).to.equal(stakeAmount);
      expect(reviewerBalanceAfter).to.equal(reviewerBalanceBefore);

      console.log("\n  [T6] Stake slashed");
      console.log(`       feeVaultBalance after slash: ${ethers.formatEther(feeVaultAfter)} DST`);
      console.log(`       reviewer DST balance change: ${ethers.formatEther(reviewerBalanceAfter - reviewerBalanceBefore)} DST`);
      console.log(`       Gas used (settleReviewer): ${slashReceipt!.gasUsed}`);

      await ctx.reviewManager.connect(ctx.reviewer3).joinReview(1, false);
      const replacementSlot = await ctx.reviewManager.getReviewSlot(1, 0);
      expect(replacementSlot.reviewer.toLowerCase()).to.equal(ctx.reviewer3.address.toLowerCase());

      console.log("\n  [T6] Replacement reviewer joined cleared slot");
      console.log(`       replacement reviewer: ${replacementSlot.reviewer}`);
      console.log("  [T6] PASS");
    });
  });

  describe("T7 - Registry Access Control", function () {
    it("rejects restricted registry actions from non-authors and strangers", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("T7-paper");

      await ctx.registry.connect(ctx.author).submitPaper(
        paperId,
        "T7 Registry Access Control",
        "Governance",
        "ipfs://abstract",
        "ipfs://submission"
      );
      await createAssignedSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://review-accept");
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1,
        1,
        ethers.encodeBytes32String("accepted")
      );

      console.log("\n  [T7] Stranger attempts restricted registry actions:");
      console.log("       publishPaper by non-author");
      await expect(
        ctx.registry.connect(ctx.stranger).publishPaper(paperId, "10.5555/t7", "ipfs://publication")
      ).to.be.revertedWithCustomError(ctx.registry, "Unauthorized");

      console.log("       acknowledgeDecision by non-author");
      await expect(
        ctx.registry.connect(ctx.stranger).acknowledgeDecision(paperId)
      ).to.be.revertedWithCustomError(ctx.registry, "Unauthorized");

      console.log("       updateSubmission by non-author");
      await expect(
        ctx.registry.connect(ctx.stranger).updateSubmission(paperId, "ipfs://new-abstract", "ipfs://new-submission")
      ).to.be.revertedWithCustomError(ctx.registry, "Unauthorized");

      console.log("\n  [T7] Expected result: all restricted calls revert");
      console.log("       publishPaper revert: Unauthorized");
      console.log("       acknowledgeDecision revert: Unauthorized");
      console.log("       updateSubmission revert: Unauthorized");
      console.log("  [T7] PASS");
    });
  });

  describe("T8 - Reader Interaction Guards", function () {
    it("rejects invalid ratings, accepts boundary ratings, and enforces download quotas per reader", async function () {
      const ctx = await deployAll();
      const paperId = await publishAcceptedPaper(ctx, "T8-paper");

      console.log("\n  [T8] Invalid rating checks:");
      await expect(
        ctx.interactions.connect(ctx.reader).submitRating(paperId, 0)
      ).to.be.revertedWithCustomError(ctx.interactions, "InvalidRating");
      console.log("       rating 0 -> reverted with InvalidRating");

      await expect(
        ctx.interactions.connect(ctx.reader).submitRating(paperId, 11)
      ).to.be.revertedWithCustomError(ctx.interactions, "InvalidRating");
      console.log("       rating 11 -> reverted with InvalidRating");

      console.log("\n  [T8] Boundary rating checks:");
      await ctx.interactions.connect(ctx.reader).submitRating(paperId, 1);
      console.log("       rating 1 accepted");
      await ctx.interactions.connect(ctx.reviewer2).submitRating(paperId, 10);
      console.log("       rating 10 accepted");

      let stats = await ctx.interactions.getPaperStats(paperId);
      expect(stats.ratingCount).to.equal(2n);
      expect(await ctx.interactions.getAverageRatingHalfSteps(paperId)).to.equal(5n);

      console.log("\n  [T8] Download limit check:");
      for (let i = 0; i < 3; i++) {
        await ctx.interactions.connect(ctx.reader).registerDownload(paperId);
      }
      stats = await ctx.interactions.getPaperStats(paperId);
      expect(stats.downloads).to.equal(3n);
      console.log("       first three downloads accepted");

      await expect(
        ctx.interactions.connect(ctx.reader).registerDownload(paperId)
      ).to.be.revertedWithCustomError(ctx.interactions, "DownloadLimitReached");
      console.log("       fourth download reverted with DownloadLimitReached");

      console.log("\n  [T8] Independent reader quota check:");
      await ctx.interactions.connect(ctx.reviewer2).registerDownload(paperId);
      const reviewer2Policy = await ctx.interactions.getDownloadPolicy(paperId, ctx.reviewer2.address);
      expect(reviewer2Policy.remaining).to.equal(2n);
      console.log("       second reader still has separate download allowance");
      console.log(`       second reader remaining downloads: ${reviewer2Policy.remaining}`);
      console.log("  [T8] PASS");
    });
  });
});
