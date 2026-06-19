/**
 * DecentraScholar — Adversarial & Edge-Case Test Suite
 * =====================================================
 * Tests what the protocol rejects, not just what it accepts.
 * Covers access-control violations, state-machine guards, financial
 * invariants, and full rejection / abandonment paths.
 *
 * Groups:
 *   A – Access control & authorization
 *   B – Assignment guards (assignedReviewers mapping)
 *   C – Session state-machine guards
 *   D – Paper registry guards
 *   E – Financial guards (vault & stake)
 *   F – Reader-interaction guards
 *   G – Full rejection / abandonment lifecycle
 *
 * Run with:  npx hardhat test test/DecentraScholarAdversarial.ts
 */

import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

// ---------------------------------------------------------------------------
// Shared deploy fixture
// ---------------------------------------------------------------------------
async function deployAll() {
  const [owner, author, reviewer1, reviewer2, reviewer3, stranger, reader] =
    await ethers.getSigners();

  const dstToken = await ethers.deployContract("DSTToken", [owner.address]);
  const weiPerDst = ethers.parseUnits("1", 15); // 0.001 ETH / DST
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
  const reviewerReputation = await ethers.deployContract("ReviewerReputation", [owner.address]);
  const interactions = await ethers.deployContract("ReaderInteractions", [
    owner.address,
    await registry.getAddress(),
  ]);

  // Wire up roles
  await registry.setReviewManager(await reviewManager.getAddress());
  await dstToken.setMinter(await dstTreasury.getAddress(), true);
  await dstProtocolVault.setCoordinator(owner.address, true);
  await reviewManager.setCoordinator(owner.address, true);
  await reviewerReputation.setCoordinator(owner.address, true);

  // Seed treasury
  await owner.sendTransaction({
    to: await dstTreasury.getAddress(),
    value: ethers.parseEther("100"),
  });

  return {
    owner, author, reviewer1, reviewer2, reviewer3, stranger, reader,
    dstToken, dstTreasury, dstProtocolVault,
    registry, reviewManager, reviewerReputation, interactions,
    weiPerDst,
  };
}

// Helper: buy DST for a signer
async function buyDst(
  dstTreasury: Awaited<ReturnType<typeof ethers.deployContract>>,
  signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  tokenAmount: bigint,
  weiPerDst: bigint
) {
  const cost = (tokenAmount * weiPerDst) / ethers.parseEther("1");
  await dstTreasury.connect(signer).buy(tokenAmount, { value: cost });
}

// Helper: submit paper + create session + register reviewers in mapping
async function setupSession(
  ctx: Awaited<ReturnType<typeof deployAll>>,
  paperId: string,
  reviewers: Awaited<ReturnType<typeof ethers.getSigners>>[number][]
) {
  const { owner, registry, reviewManager } = ctx;
  await registry.connect(ctx.author).submitPaper(
    paperId, "Test Paper", "CS", "ipfs://abs", "ipfs://sub"
  );
  const addrs = reviewers.map(r => r.address);
  await reviewManager.connect(owner).createSession(
    paperId, addrs, addrs.map(() => false), 1_900_000_000, 1
  );
  // Populate the assignedReviewers mapping so submitReview passes the guard
  if (addrs.length > 0) {
    await reviewManager.connect(owner).assignReviewers(paperId, addrs);
  }
  return { sessionId: 1 };
}

// ---------------------------------------------------------------------------
describe("DecentraScholar — Adversarial & Edge-Case Test Suite", function () {

  // =========================================================================
  // A: ACCESS CONTROL & AUTHORIZATION
  // =========================================================================
  describe("A – Access control & authorization", function () {

    it("A1: stranger cannot call createSession (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("A1-paper");
      await ctx.registry.connect(ctx.author).submitPaper(
        paperId, "A1", "CS", "", ""
      );
      await expect(
        ctx.reviewManager.connect(ctx.stranger).createSession(
          paperId, [], [], 1_900_000_000, 1
        )
      ).to.be.revertedWithCustomError(ctx.reviewManager, "Unauthorized");
    });

    it("A2: stranger cannot call finalizeSession (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("A2-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await expect(
        ctx.reviewManager.connect(ctx.stranger).finalizeSession(
          1, 1, ethers.encodeBytes32String("bad_actor")
        )
      ).to.be.revertedWithCustomError(ctx.reviewManager, "Unauthorized");
    });

    it("A3: stranger cannot call assignReviewers (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("A3-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "A3", "CS", "", "");
      await expect(
        ctx.reviewManager.connect(ctx.stranger).assignReviewers(
          paperId, [ctx.reviewer1.address]
        )
      ).to.be.revertedWithCustomError(ctx.reviewManager, "Unauthorized");
    });

    it("A4: stranger cannot call assignTiebreaker (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("A4-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "A4", "CS", "", "");
      await expect(
        ctx.reviewManager.connect(ctx.stranger).assignTiebreaker(
          paperId, ctx.reviewer1.address
        )
      ).to.be.revertedWithCustomError(ctx.reviewManager, "Unauthorized");
    });

    it("A5: stranger cannot call settleReviewer (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("A5-paper");
      await expect(
        ctx.dstProtocolVault.connect(ctx.stranger).settleReviewer(
          paperId, ctx.reviewer1.address, 0n, 0n
        )
      ).to.be.revertedWithCustomError(ctx.dstProtocolVault, "Unauthorized");
    });

    it("A6: author cannot acceptAssignment for their own paper", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("A6-paper");
      // Create session with author as one of the reviewer slots
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "A6", "CS", "", "");
      await ctx.reviewManager.connect(ctx.owner).createSession(
        paperId,
        [ctx.author.address, ctx.reviewer1.address],
        [false, false],
        1_900_000_000,
        1
      );
      // Author is in slot 0 but should be rejected by the author-check guard
      await expect(
        ctx.reviewManager.connect(ctx.author).acceptAssignment(1)
      ).to.be.revertedWith("Author cannot review own paper");
    });

    it("A7: non-owner cannot update setCoordinator (NotOwner)", async function () {
      const ctx = await deployAll();
      await expect(
        ctx.reviewManager.connect(ctx.stranger).setCoordinator(ctx.stranger.address, true)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "NotOwner");
    });

    it("A8: non-owner cannot call setReviewManager on registry (NotOwner)", async function () {
      const ctx = await deployAll();
      await expect(
        ctx.registry.connect(ctx.stranger).setReviewManager(ctx.stranger.address)
      ).to.be.revertedWithCustomError(ctx.registry, "NotOwner");
    });
  });

  // =========================================================================
  // B: ASSIGNMENT GUARDS (assignedReviewers mapping)
  // =========================================================================
  describe("B – Assignment guards", function () {

    it("B1: pre-assigned reviewer is registered during session creation", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("B1-paper");
      // Pre-assigned reviewers are now registered as part of createSession.
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "B1", "CS", "", "");
      await ctx.reviewManager.connect(ctx.owner).createSession(
        paperId, [ctx.reviewer1.address], [false], 1_900_000_000, 1
      );
      // The reviewer can submit without a separate assignReviewers transaction.
      expect(await ctx.reviewManager.assignedReviewers(paperId, ctx.reviewer1.address)).to.equal(true);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://rev");
    });

    it("B2: self-selected reviewer is registered when joining", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("B2-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "B2", "CS", "", "");
      // Self-select session (no pre-assigned reviewers)
      await ctx.reviewManager.connect(ctx.owner).createSession(
        paperId, [], [], 1_900_000_000, 1
      );
      // reviewer1 self-selects into an open slot
      await ctx.reviewManager.connect(ctx.reviewer1).joinReview(1, false);
      // Self-selected reviewers are registered when they join.
      expect(await ctx.reviewManager.assignedReviewers(paperId, ctx.reviewer1.address)).to.equal(true);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://rev");
    });

    it("B3: stranger with no slot cannot call acceptAssignment (ReviewerNotAssigned)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("B3-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await expect(
        ctx.reviewManager.connect(ctx.stranger).acceptAssignment(1)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "ReviewerNotAssigned");
    });

    it("B4: stranger with no slot cannot call declineAssignment (ReviewerNotAssigned)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("B4-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await expect(
        ctx.reviewManager.connect(ctx.stranger).declineAssignment(1)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "ReviewerNotAssigned");
    });

    it("B5: reviewer cannot acceptAssignment twice (AlreadyAccepted)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("B5-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).acceptAssignment(1);
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).acceptAssignment(1)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyAccepted");
    });

    it("B6: reviewer cannot declineAssignment twice (AlreadyDeclined)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("B6-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).declineAssignment(1);
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).declineAssignment(1)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyDeclined");
    });

    it("B7: assignTiebreaker sets hasTiebreaker flag for the paper", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("B7-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "B7", "CS", "", "");
      expect(await ctx.reviewManager.hasTiebreaker(paperId)).to.equal(false);
      await ctx.reviewManager.connect(ctx.owner).assignTiebreaker(paperId, ctx.reviewer3.address);
      expect(await ctx.reviewManager.hasTiebreaker(paperId)).to.equal(true);
      expect(await ctx.reviewManager.assignedReviewers(paperId, ctx.reviewer3.address)).to.equal(true);
    });
  });

  // =========================================================================
  // C: SESSION STATE-MACHINE GUARDS
  // =========================================================================
  describe("C – Session state-machine guards", function () {

    it("C1: finalized session cannot be finalized again (AlreadyFinalized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C1-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://rev");
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 1, ethers.encodeBytes32String("accept")
      );
      await expect(
        ctx.reviewManager.connect(ctx.owner).finalizeSession(
          1, 2, ethers.encodeBytes32String("reject_again")
        )
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyFinalized");
    });

    it("C2: reviewer cannot submit blind review twice (AlreadySubmitted)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C2-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://first");
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://second")
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadySubmitted");
    });

    it("C3: reviewer cannot submit rebuttal vote twice (AlreadySubmitted)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C3-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]);
      // Blind round
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://r1");
      await ctx.reviewManager.connect(ctx.reviewer2).submitReview(1, 3, "ipfs://r2");
      await ctx.reviewManager.connect(ctx.reviewer3).submitReview(1, 2, "ipfs://r3");
      // Move to rebuttal
      await ctx.reviewManager.connect(ctx.owner).setRebuttalPhase(
        1, ethers.encodeBytes32String("split")
      );
      // Rebuttal vote once
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://reb1");
      // Rebuttal vote again → reverts
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 2, "ipfs://reb1-dup")
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadySubmitted");
    });

    it("C4: joinReview on a finalized session (AlreadyFinalized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C4-paper");
      // Self-select session
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "C4", "CS", "", "");
      await ctx.reviewManager.connect(ctx.owner).createSession(paperId, [], [], 1_900_000_000, 1);
      // Finalize it immediately (no reviews needed for this test)
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 4, ethers.encodeBytes32String("abandoned")
      );
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).joinReview(1, false)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyFinalized");
    });

    it("C5: joinReview during Rebuttal phase (SlotNotAvailable)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C5-paper");
      // Self-select session with one open slot remaining
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "C5", "CS", "", "");
      await ctx.reviewManager.connect(ctx.owner).createSession(paperId, [], [], 1_900_000_000, 1);
      // Move to rebuttal phase
      await ctx.reviewManager.connect(ctx.owner).setRebuttalPhase(
        1, ethers.encodeBytes32String("trigger")
      );
      // Reviewer tries to join during rebuttal
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).joinReview(1, false)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "SlotNotAvailable");
    });

    it("C6: ejected reviewer cannot rejoin after clearReviewerSlot (ReviewerEjected)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C6-paper");
      // Self-select session
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "C6", "CS", "", "");
      await ctx.reviewManager.connect(ctx.owner).createSession(paperId, [], [], 1_900_000_000, 1);
      await ctx.reviewManager.connect(ctx.reviewer1).joinReview(1, false);
      // Coordinator clears the slot (no-show) — this ejects the reviewer
      await ctx.reviewManager.connect(ctx.owner).clearReviewerSlot(1, 0);
      // Reviewer tries to rejoin the same session
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).joinReview(1, false)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "ReviewerEjected");
    });

    it("C7: reviewer already in session cannot joinReview again (AlreadyJoined)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C7-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "C7", "CS", "", "");
      await ctx.reviewManager.connect(ctx.owner).createSession(paperId, [], [], 1_900_000_000, 1);
      await ctx.reviewManager.connect(ctx.reviewer1).joinReview(1, false);
      await expect(
        ctx.reviewManager.connect(ctx.reviewer1).joinReview(1, true)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyJoined");
    });

    it("C8: finalizeSession with Decision.Pending (InvalidDecision)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C8-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await expect(
        ctx.reviewManager.connect(ctx.owner).finalizeSession(
          1, 0, ethers.encodeBytes32String("pending")
        )
      ).to.be.revertedWithCustomError(ctx.reviewManager, "InvalidDecision");
    });

    it("C9: requestReplacementReview with deadline=0 (InvalidDecision)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C9-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await expect(
        ctx.reviewManager.connect(ctx.owner).requestReplacementReview(
          1, 0, false, ethers.encodeBytes32String("bad")
        )
      ).to.be.revertedWithCustomError(ctx.reviewManager, "InvalidDecision");
    });

    it("C10: setRebuttalPhase / setHighPriority / extendDeadline blocked after finalization", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C10-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 4, ethers.encodeBytes32String("abandoned")
      );
      await expect(
        ctx.reviewManager.connect(ctx.owner).setRebuttalPhase(1, ethers.encodeBytes32String("x"))
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyFinalized");

      await expect(
        ctx.reviewManager.connect(ctx.owner).setHighPriority(1, true, ethers.encodeBytes32String("x"))
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyFinalized");

      await expect(
        ctx.reviewManager.connect(ctx.owner).extendDeadline(1, 1_999_999_999, ethers.encodeBytes32String("x"))
      ).to.be.revertedWithCustomError(ctx.reviewManager, "AlreadyFinalized");
    });

    it("C11: all slots full — fifth joinReview reverts (SlotNotAvailable)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C11-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "C11", "CS", "", "");
      // Default self-select session has exactly 3 slots
      await ctx.reviewManager.connect(ctx.owner).createSession(paperId, [], [], 1_900_000_000, 1);
      const reviewers = [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3];
      for (const r of reviewers) {
        await ctx.reviewManager.connect(r).joinReview(1, false);
      }
      // All 3 slots occupied — stranger tries to join a 4th slot
      await expect(
        ctx.reviewManager.connect(ctx.stranger).joinReview(1, false)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "SlotNotAvailable");
    });

    it("C12: paper author cannot joinReview their own paper's session (NotEligible)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("C12-paper");
      // author submits, coordinator creates a self-select session
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "C12 Self-Review Attempt", "CS", "", "");
      await ctx.reviewManager.connect(ctx.owner).createSession(paperId, [], [], 1_900_000_000, 1);
      // author tries to join the open slot of their own paper's session
      await expect(
        ctx.reviewManager.connect(ctx.author).joinReview(1, false)
      ).to.be.revertedWithCustomError(ctx.reviewManager, "NotEligible");
    });
  });

  // =========================================================================
  // D: PAPER REGISTRY GUARDS
  // =========================================================================
  describe("D – Paper registry guards", function () {

    it("D1: submitting the same paperId twice (PaperAlreadyExists)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("D1-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "D1 First", "CS", "", "");
      await expect(
        ctx.registry.connect(ctx.author).submitPaper(paperId, "D1 Duplicate", "CS", "", "")
      ).to.be.revertedWithCustomError(ctx.registry, "PaperAlreadyExists");
    });

    it("D2: submitPaper with empty title or category (EmptyString)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("D2-paper");
      await expect(
        ctx.registry.connect(ctx.author).submitPaper(paperId, "", "CS", "", "")
      ).to.be.revertedWithCustomError(ctx.registry, "EmptyString");

      const paperId2 = ethers.id("D2-paper-b");
      await expect(
        ctx.registry.connect(ctx.author).submitPaper(paperId2, "Title", "", "", "")
      ).to.be.revertedWithCustomError(ctx.registry, "EmptyString");
    });

    it("D3: submitPaper with zero paperId (EmptyString)", async function () {
      const ctx = await deployAll();
      await expect(
        ctx.registry.connect(ctx.author).submitPaper(
          ethers.ZeroHash, "Title", "CS", "", ""
        )
      ).to.be.revertedWithCustomError(ctx.registry, "EmptyString");
    });

    it("D4: publishPaper on a paper still under review (InvalidStatus)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("D4-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      // Paper is now UnderReview — publishing must fail
      await expect(
        ctx.registry.connect(ctx.author).publishPaper(paperId, "10.x/d4", "ipfs://pub")
      ).to.be.revertedWithCustomError(ctx.registry, "InvalidStatus");
    });

    it("D5: stranger cannot publishPaper even if paper is accepted (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("D5-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://rev");
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 1, ethers.encodeBytes32String("accept")
      );
      // stranger (not author / owner / editor) tries to publish
      await expect(
        ctx.registry.connect(ctx.stranger).publishPaper(paperId, "10.x/d5", "ipfs://pub")
      ).to.be.revertedWithCustomError(ctx.registry, "Unauthorized");
    });

    it("D6: non-author cannot acknowledgeDecision (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("D6-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://rev");
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 1, ethers.encodeBytes32String("accept")
      );
      await expect(
        ctx.registry.connect(ctx.stranger).acknowledgeDecision(paperId)
      ).to.be.revertedWithCustomError(ctx.registry, "Unauthorized");
    });

    it("D7: non-author cannot updateSubmission (Unauthorized)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("D7-paper");
      await ctx.registry.connect(ctx.author).submitPaper(paperId, "D7", "CS", "", "");
      await expect(
        ctx.registry.connect(ctx.stranger).updateSubmission(paperId, "ipfs://new-abs", "ipfs://new-sub")
      ).to.be.revertedWithCustomError(ctx.registry, "Unauthorized");
    });
  });

  // =========================================================================
  // E: FINANCIAL GUARDS
  // =========================================================================
  describe("E – Financial guards", function () {

    it("E1: locking reviewer stake twice (StakeAlreadyLocked)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("E1-paper");
      const stakeAmount = ethers.parseEther("10");

      await buyDst(ctx.dstTreasury, ctx.reviewer1, stakeAmount * 2n, ctx.weiPerDst);
      await ctx.dstToken.connect(ctx.reviewer1).approve(
        await ctx.dstProtocolVault.getAddress(), stakeAmount * 2n
      );
      await ctx.dstProtocolVault.connect(ctx.reviewer1).lockReviewerStake(paperId, stakeAmount);

      await expect(
        ctx.dstProtocolVault.connect(ctx.reviewer1).lockReviewerStake(paperId, stakeAmount)
      ).to.be.revertedWithCustomError(ctx.dstProtocolVault, "StakeAlreadyLocked");
    });

    it("E2: settling a reviewer who never locked a stake (StakeMissing)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("E2-paper");
      // reviewer2 never locked a stake
      await expect(
        ctx.dstProtocolVault.connect(ctx.owner).settleReviewer(
          paperId, ctx.reviewer2.address, 0n, 0n
        )
      ).to.be.revertedWithCustomError(ctx.dstProtocolVault, "StakeMissing");
    });

    it("E3: locking zero amount (InvalidAmount)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("E3-paper");
      await expect(
        ctx.dstProtocolVault.connect(ctx.reviewer1).lockReviewerStake(paperId, 0n)
      ).to.be.revertedWithCustomError(ctx.dstProtocolVault, "InvalidAmount");
    });

    it("E4: reserveSubmissionFee with zero amount (InvalidAmount)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("E4-paper");
      await expect(
        ctx.dstProtocolVault.connect(ctx.author).reserveSubmissionFee(paperId, 0n)
      ).to.be.revertedWithCustomError(ctx.dstProtocolVault, "InvalidAmount");
    });

    it("E5: paying insufficient ETH when buying DST reverts", async function () {
      const ctx = await deployAll();
      const tokenAmount = ethers.parseEther("10");
      const tooLittleEth = ethers.parseEther("0.001"); // needs 0.01 ETH
      await expect(
        ctx.dstTreasury.connect(ctx.reader).buy(tokenAmount, { value: tooLittleEth })
      ).to.be.revertedWithCustomError(ctx.dstTreasury, "InvalidPayment");
    });

    it("E6: reward payout cannot exceed the paper's remaining reward pool (InsufficientRewardPool)", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("E6-paper");
      const submissionFee = ethers.parseEther("100"); // reward pool = 75 DST
      const stakeAmount  = ethers.parseEther("10");
      const hugePayout   = ethers.parseEther("200"); // far exceeds pool

      await buyDst(ctx.dstTreasury, ctx.author, submissionFee, ctx.weiPerDst);
      await ctx.dstToken.connect(ctx.author).approve(
        await ctx.dstProtocolVault.getAddress(), submissionFee
      );
      await ctx.dstProtocolVault.connect(ctx.author).reserveSubmissionFee(paperId, submissionFee);

      await buyDst(ctx.dstTreasury, ctx.reviewer1, stakeAmount, ctx.weiPerDst);
      await ctx.dstToken.connect(ctx.reviewer1).approve(
        await ctx.dstProtocolVault.getAddress(), stakeAmount
      );
      await ctx.dstProtocolVault.connect(ctx.reviewer1).lockReviewerStake(paperId, stakeAmount);

      await expect(
        ctx.dstProtocolVault.connect(ctx.owner).settleReviewer(
          paperId, ctx.reviewer1.address, hugePayout, 0n
        )
      ).to.be.revertedWithCustomError(ctx.dstProtocolVault, "InsufficientRewardPool");
    });
  });

  // =========================================================================
  // F: READER INTERACTION GUARDS
  // =========================================================================
  describe("F – Reader interaction guards", function () {

    // Helper: publish a paper all the way
    async function publishedPaper(ctx: Awaited<ReturnType<typeof deployAll>>, id: string) {
      const paperId = ethers.id(id);
      await setupSession(ctx, paperId, [ctx.reviewer1]);
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://rev");
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 1, ethers.encodeBytes32String("accept")
      );
      await ctx.registry.connect(ctx.author).publishPaper(paperId, `10.x/${id}`, "ipfs://pub");
      return paperId;
    }

    it("F1: rating below 1 (zero) reverts (InvalidRating)", async function () {
      const ctx = await deployAll();
      const paperId = await publishedPaper(ctx, "F1-paper");
      await expect(
        ctx.interactions.connect(ctx.reader).submitRating(paperId, 0)
      ).to.be.revertedWithCustomError(ctx.interactions, "InvalidRating");
    });

    it("F2: rating above 10 (11 half-steps) reverts (InvalidRating)", async function () {
      const ctx = await deployAll();
      const paperId = await publishedPaper(ctx, "F2-paper");
      await expect(
        ctx.interactions.connect(ctx.reader).submitRating(paperId, 11)
      ).to.be.revertedWithCustomError(ctx.interactions, "InvalidRating");
    });

    it("F3: boundary ratings 1 and 10 are accepted", async function () {
      const ctx = await deployAll();
      const paperId = await publishedPaper(ctx, "F3-paper");
      await ctx.interactions.connect(ctx.reader).submitRating(paperId, 1);
      let stats = await ctx.interactions.getPaperStats(paperId);
      expect(stats.ratingCount).to.equal(1n);

      // reader2 rates at maximum
      await ctx.interactions.connect(ctx.reviewer2).submitRating(paperId, 10);
      stats = await ctx.interactions.getPaperStats(paperId);
      expect(stats.ratingCount).to.equal(2n);
      // average = (1+10)/2 = 5.5 half-steps → 5 (integer div in contract)
      expect(await ctx.interactions.getAverageRatingHalfSteps(paperId)).to.equal(5n);
    });

    it("F4: fourth download within the window reverts (DownloadLimitReached)", async function () {
      const ctx = await deployAll();
      const paperId = await publishedPaper(ctx, "F4-paper");
      // 3 allowed
      for (let i = 0; i < 3; i++) {
        await ctx.interactions.connect(ctx.reader).registerDownload(paperId);
      }
      const policy = await ctx.interactions.getDownloadPolicy(paperId, ctx.reader.address);
      expect(policy.allowed).to.equal(false);
      expect(policy.remaining).to.equal(0n);

      // 4th download reverts
      await expect(
        ctx.interactions.connect(ctx.reader).registerDownload(paperId)
      ).to.be.revertedWithCustomError(ctx.interactions, "DownloadLimitReached");
    });

    it("F5: different readers each have their own independent download quota", async function () {
      const ctx = await deployAll();
      const paperId = await publishedPaper(ctx, "F5-paper");

      // reader exhausts their quota
      for (let i = 0; i < 3; i++) {
        await ctx.interactions.connect(ctx.reader).registerDownload(paperId);
      }
      await expect(
        ctx.interactions.connect(ctx.reader).registerDownload(paperId)
      ).to.be.revertedWithCustomError(ctx.interactions, "DownloadLimitReached");

      // reviewer2 (different reader) still has a full quota
      await ctx.interactions.connect(ctx.reviewer2).registerDownload(paperId);
      const policy2 = await ctx.interactions.getDownloadPolicy(paperId, ctx.reviewer2.address);
      expect(policy2.remaining).to.equal(2n);
    });
  });

  // =========================================================================
  // G: FULL REJECTION & ABANDONMENT LIFECYCLE
  // =========================================================================
  describe("G – Full rejection & abandonment lifecycle", function () {

    it("G1: three unanimous rejects → paper status = Rejected; publishPaper then reverts", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("G1-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]);

      // All three vote Reject (2)
      for (const rev of [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]) {
        await ctx.reviewManager.connect(rev).submitReview(1, 2, "ipfs://reject");
      }

      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 2, ethers.encodeBytes32String("unanimous_reject")
      );

      const paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(5n); // Rejected
      expect(await ctx.registry.isPublished(paperId)).to.equal(false);
      console.log(`  [G1] Paper status after unanimous reject: ${paper.status} (5=Rejected) ✓`);

      // Author tries to publish a rejected paper
      await expect(
        ctx.registry.connect(ctx.author).publishPaper(paperId, "10.x/g1", "ipfs://pub")
      ).to.be.revertedWithCustomError(ctx.registry, "InvalidStatus");
      console.log("  [G1] publishPaper on rejected paper reverts InvalidStatus ✓");
    });

    it("G2: majority reject (2R+1A) → Rejected", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("G2-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]);

      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 2, "ipfs://r1"); // Reject
      await ctx.reviewManager.connect(ctx.reviewer2).submitReview(1, 2, "ipfs://r2"); // Reject
      await ctx.reviewManager.connect(ctx.reviewer3).submitReview(1, 1, "ipfs://r3"); // Accept

      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 2, ethers.encodeBytes32String("majority_reject")
      );

      const paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(5n); // Rejected
      console.log(`  [G2] Paper status after 2R+1A: ${paper.status} (5=Rejected) ✓`);
    });

    it("G3: abandoned paper path → paper status = Abandoned", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("G3-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);

      // Coordinator abandons without any reviews (deadline expired scenario)
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 4, ethers.encodeBytes32String("deadline_expired")
      );

      const paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(7n); // Abandoned
      const session = await ctx.reviewManager.getSession(1);
      expect(session.finalized).to.equal(true);
      expect(session.decision).to.equal(4n); // Abandoned
      console.log(`  [G3] Paper status: ${paper.status} (7=Abandoned), session.decision: ${session.decision} ✓`);
    });

    it("G4: rebuttal deadlock (1A+1R) → finalized Rejected by tiebreaker", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("G4-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1, ctx.reviewer2, ctx.reviewer3]);

      // Blind votes: 1A+1N+1R → move to rebuttal
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://r1");
      await ctx.reviewManager.connect(ctx.reviewer2).submitReview(1, 3, "ipfs://r2");
      await ctx.reviewManager.connect(ctx.reviewer3).submitReview(1, 2, "ipfs://r3");
      await ctx.reviewManager.connect(ctx.owner).setRebuttalPhase(
        1, ethers.encodeBytes32String("mixed")
      );

      // Rebuttal: reviewer1=Accept, reviewer2=Reject → deadlock (1A+1R, reviewer3 no-show)
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 1, "ipfs://reb1");
      await ctx.reviewManager.connect(ctx.reviewer2).submitReview(1, 2, "ipfs://reb2");

      // Coordinator assigns tiebreaker (reviewer3 already in session but pretend stranger is tiebreaker)
      await ctx.reviewManager.connect(ctx.owner).assignTiebreaker(paperId, ctx.stranger.address);
      expect(await ctx.reviewManager.hasTiebreaker(paperId)).to.equal(true);

      // For the on-chain test we just verify the coordinator can finalize as they see fit
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 2, ethers.encodeBytes32String("tiebreaker_reject")
      );

      const paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(5n); // Rejected
      console.log(`  [G4] Tiebreaker deadlock finalized as Rejected ✓`);
    });

    it("G5: revision-requested paper re-enters review in a second session", async function () {
      const ctx = await deployAll();
      const paperId = ethers.id("G5-paper");
      await setupSession(ctx, paperId, [ctx.reviewer1]);

      // Session 1: revision requested
      await ctx.reviewManager.connect(ctx.reviewer1).submitReview(1, 2, "ipfs://rev1");
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        1, 3, ethers.encodeBytes32String("needs_revision")
      );

      let paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(3n); // RevisionRequested
      console.log(`  [G5] After session 1: status=${paper.status} (3=RevisionRequested) ✓`);

      // Session 2: creates a new session (cycle 2), re-enters under review
      await ctx.reviewManager.connect(ctx.owner).createSession(
        paperId, [ctx.reviewer2.address], [false], 1_900_000_001, 2
      );
      await ctx.reviewManager.connect(ctx.owner).assignReviewers(paperId, [ctx.reviewer2.address]);

      paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(2n); // UnderReview again
      console.log(`  [G5] After session 2: status=${paper.status} (2=UnderReview) ✓`);

      // Session 2: accepted
      await ctx.reviewManager.connect(ctx.reviewer2).submitReview(2, 1, "ipfs://rev2");
      await ctx.reviewManager.connect(ctx.owner).finalizeSession(
        2, 1, ethers.encodeBytes32String("accept_after_revision")
      );

      paper = await ctx.registry.getPaper(paperId);
      expect(paper.status).to.equal(4n); // Accepted
      console.log(`  [G5] After session 2 finalization: status=${paper.status} (4=Accepted) ✓`);
    });
  });

});
