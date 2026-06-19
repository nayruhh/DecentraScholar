/**
 * chainListener.js
 *
 * Runs inside the backend server. Holds the coordinator private key and listens
 * to on-chain events to automatically drive the review lifecycle:
 *
 *   PaperSubmitted    → assignReviewers (backend DB) → createSession (pre-assigned)
 *   ReviewSubmitted   → tally votes → finalizeSession | setRebuttalPhase
 *   Rebuttal deadlock → assignTiebreaker
 */

import { Contract, JsonRpcProvider, Wallet } from "ethers";

// ---------------------------------------------------------------------------
// Config — all values come from environment variables set by run-local.ps1
// ---------------------------------------------------------------------------
const RPC_URL = process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545";
const COORDINATOR_PRIVATE_KEY =
  process.env.COORDINATOR_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat account 0

const PAPER_REGISTRY_ADDRESS = process.env.PAPER_REGISTRY_ADDRESS || "";
const REVIEW_MANAGER_ADDRESS = process.env.REVIEW_MANAGER_ADDRESS || "";
const REVIEWER_REPUTATION_ADDRESS = process.env.REVIEWER_REPUTATION_ADDRESS || "";
const DST_PROTOCOL_VAULT_ADDRESS = process.env.DST_PROTOCOL_VAULT_ADDRESS || "";

const REVIEW_DEADLINE_DAYS = Number(process.env.REVIEW_DEADLINE_DAYS || 14);
const NO_SHOW_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const ASSIGNED_MAPPING_CHECK_INTERVAL_MS = 30 * 1000;
const DECLINED_SLOT_CHECK_INTERVAL_MS = 10 * 1000;
const EXPECTED_BLIND_REVIEWER_COUNT = 3;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// Minimal ABIs — only what the listener needs
// ---------------------------------------------------------------------------
const PAPER_REGISTRY_ABI = [
  "event PaperSubmitted(bytes32 indexed paperId, address indexed author, string title)",
];

const REVIEW_MANAGER_ABI = [
  // Coordinator writes
  "function createSession(bytes32 paperId, address[] reviewers, bool[] revealOnPublication, uint64 deadline, uint8 revisionCycle) returns (uint256)",
  "function assignReviewers(bytes32 paperId, address[] reviewers)",
  "function assignTiebreaker(bytes32 paperId, address reviewer)",
  "function setRebuttalPhase(uint256 sessionId, bytes32 reason)",
  "function requestReplacementReview(uint256 sessionId, uint64 nextDeadline, bool highPriority, bytes32 reason)",
  "function finalizeSession(uint256 sessionId, uint8 decision, bytes32 reason)",
  // Events
  "event SessionCreated(uint256 indexed sessionId, bytes32 indexed paperId, uint8 revisionCycle)",
  "event ReviewerJoined(uint256 indexed sessionId, address indexed reviewer, uint256 slotIndex)",
  "event AssignmentDeclined(uint256 indexed sessionId, address indexed reviewer)",
  "event ReviewSubmitted(uint256 indexed sessionId, address indexed reviewer, uint8 vote, string reviewCid)",
  // Views
  "function nextSessionId() view returns (uint256)",
  "function getSession(uint256 sessionId) view returns ((uint256 sessionId,bytes32 paperId,uint64 deadline,uint8 revisionCycle,uint8 decision,uint8 phase,uint8 roundStatus,bool highPriority,bool finalized,bytes32 resolutionReason,string rebuttalCid))",
  "function getReviewerCount(uint256 sessionId) view returns (uint256)",
  "function getReviewSlot(uint256 sessionId, uint256 slotIndex) view returns ((address reviewer,bool identityMayReveal,bool accepted,bool declined,bool submitted,uint8 vote,string reviewCid,bool rebuttalSubmitted,uint8 rebuttalVote,string rebuttalCid))",
  "function assignedReviewers(bytes32 paperId, address reviewer) view returns (bool)",
  "function clearReviewerSlot(uint256 sessionId, uint256 slotIndex)",
  "function paperIdToSessionId(bytes32 paperId) view returns (uint256)",
];

const REVIEWER_REPUTATION_ABI = [
  "function recordNoShow(address reviewer)",
];

const DST_PROTOCOL_VAULT_ABI = [
  "function getReviewerStake(bytes32 paperId, address reviewer) view returns ((uint256 amount, bool active))",
  "function settleReviewer(bytes32 paperId, address reviewer, uint256 rewardAmount, uint256 slashAmount)",
  "function getPaperFunding(bytes32 paperId) view returns ((uint256 submissionFee, uint256 priorityFee, uint256 rewardPoolRemaining, uint256 feeVaultAccrued))",
];

// Decision enum matches ReviewManager.sol
const Decision = { Pending: 0, Accepted: 1, Rejected: 2, RevisionRequested: 3, Abandoned: 4 };
// Phase enum
const Phase = { Pending: 0, BlindReview: 1, Rebuttal: 2, ReplacementReview: 3, Decided: 4 };

const VOTE_ACCEPT = 1;
const VOTE_REJECT = 2;
const VOTE_NEUTRAL = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deadlineTimestamp(days) {
  return BigInt(Math.floor(Date.now() / 1000) + days * 24 * 60 * 60);
}

function encodeReason(str) {
  const bytes = Buffer.from(str.slice(0, 31), "utf8");
  const padded = Buffer.alloc(32);
  bytes.copy(padded);
  return "0x" + padded.toString("hex");
}

function isEmptySlot(slot) {
  return !slot || slot.reviewer === ZERO_ADDRESS;
}

/**
 * Count votes from submitted slots (ignoring empty/cleared slots).
 * Returns { accept, reject, neutral, total, activeCount }
 *   activeCount = slots that have a real reviewer (not address(0)) and not declined
 */
function tallyVotes(slots) {
  const counts = { accept: 0, reject: 0, neutral: 0, total: 0, activeCount: 0 };
  for (const slot of slots) {
    if (isEmptySlot(slot) || slot.declined) continue;
    counts.activeCount++;
    if (!slot.submitted) continue;
    counts.total++;
    const vote = Number(slot.vote);
    if (vote === VOTE_ACCEPT) counts.accept++;
    else if (vote === VOTE_REJECT) counts.reject++;
    else if (vote === VOTE_NEUTRAL) counts.neutral++;
  }
  return counts;
}

function panelNeedsReplacement(slots) {
  const activeCount = slots.filter((slot) => !isEmptySlot(slot) && !slot.declined).length;
  return (
    activeCount < EXPECTED_BLIND_REVIEWER_COUNT ||
    slots.some((slot) => isEmptySlot(slot) || slot.declined)
  );
}

/**
 * Complete decision table — handles both 3-panel and 2-panel (incomplete) cases.
 *
 * Round 1 — 3-reviewer complete panel:
 *   ≥2 accept                     → accepted
 *   ≥2 reject                     → rejected
 *   2 neutral + 1 accept          → accepted  (decisive wins)
 *   2 neutral + 1 reject          → rejected  (decisive wins)
 *   1A + 1N + 1R  or  3 neutral   → rebuttal
 *
 * Round 1 — 2-reviewer incomplete panel (third dropped, no replacement):
 *   2 accept                      → accepted
 *   1 accept + 1 neutral          → accepted  (decisive wins)
 *   1 reject + 1 neutral          → rejected  (decisive wins)
 *   2 reject                      → rejected
 *   1 accept + 1 reject           → rebuttal
 *   2 neutral                     → rebuttal
 *
 * The unified rule:
 *   ≥2 accept                             → accepted
 *   ≥2 reject                             → rejected
 *   neutral(s) + only accept (no reject)  → accepted
 *   neutral(s) + only reject (no accept)  → rejected
 *   else if total ≥ 2                     → rebuttal
 *
 * Returns "accepted" | "rejected" | "rebuttal" | "undecided"
 */
function computeOutcome(counts) {
  const { accept, reject, neutral, total } = counts;
  if (accept >= 2) return "accepted";
  if (reject >= 2) return "rejected";
  if (neutral >= 1 && accept >= 1 && reject === 0) return "accepted";
  if (neutral >= 1 && reject >= 1 && accept === 0) return "rejected";
  if (total >= 2) return "rebuttal";
  return "undecided";
}

/**
 * Tally rebuttal votes (accept/reject only, from rebuttalVote fields).
 * Returns "accepted" | "rejected" | "deadlock" | "undecided"
 */
function computeRebuttalOutcome(slots) {
  const rebuttalVotes = slots.filter((s) => !isEmptySlot(s) && s.rebuttalSubmitted);
  if (rebuttalVotes.length < 2) return "undecided";
  const accept = rebuttalVotes.filter((s) => Number(s.rebuttalVote) === VOTE_ACCEPT).length;
  const reject = rebuttalVotes.filter((s) => Number(s.rebuttalVote) === VOTE_REJECT).length;
  if (accept >= 2) return "accepted";
  if (reject >= 2) return "rejected";
  if (accept === 1 && reject === 1) return "deadlock";
  return "undecided";
}

// ---------------------------------------------------------------------------
// Main listener
// ---------------------------------------------------------------------------
export async function startChainListener({ assignReviewers, checkExpiredAssignments, db } = {}) {
  if (!PAPER_REGISTRY_ADDRESS || !REVIEW_MANAGER_ADDRESS) {
    console.warn("[ChainListener] Contract addresses not set — chain listener disabled.");
    return;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const coordinatorWallet = new Wallet(COORDINATOR_PRIVATE_KEY, provider);

  const paperRegistry = new Contract(PAPER_REGISTRY_ADDRESS, PAPER_REGISTRY_ABI, provider);
  const reviewManager = new Contract(REVIEW_MANAGER_ADDRESS, REVIEW_MANAGER_ABI, coordinatorWallet);
  const reviewManagerReadOnly = new Contract(REVIEW_MANAGER_ADDRESS, REVIEW_MANAGER_ABI, provider);

  const reviewerReputation = REVIEWER_REPUTATION_ADDRESS
    ? new Contract(REVIEWER_REPUTATION_ADDRESS, REVIEWER_REPUTATION_ABI, coordinatorWallet)
    : null;
  const protocolVault = DST_PROTOCOL_VAULT_ADDRESS
    ? new Contract(DST_PROTOCOL_VAULT_ADDRESS, DST_PROTOCOL_VAULT_ABI, coordinatorWallet)
    : null;

  console.log(`[ChainListener] Coordinator: ${coordinatorWallet.address}`);
  console.log(`[ChainListener] PaperRegistry: ${PAPER_REGISTRY_ADDRESS}`);
  console.log(`[ChainListener] ReviewManager: ${REVIEW_MANAGER_ADDRESS}`);

  // -------------------------------------------------------------------------
  // Startup catch-up — finalize any sessions whose votes already determine
  // a majority but whose finalizeSession was never called.
  // -------------------------------------------------------------------------
  async function catchUpSessions() {
    try {
      const nextId = Number(await reviewManagerReadOnly.nextSessionId());
      if (nextId <= 1) return;
      console.log(`[ChainListener] Catch-up: scanning ${nextId - 1} session(s)...`);

      for (let sid = 1; sid < nextId; sid++) {
        try {
          const session = await reviewManagerReadOnly.getSession(sid);
          if (session.finalized || Number(session.phase) === Phase.Decided) continue;

          const reviewerCount = Number(await reviewManagerReadOnly.getReviewerCount(sid));
          if (reviewerCount === 0) continue;

          const slots = await Promise.all(
            Array.from({ length: reviewerCount }, (_, i) =>
              reviewManagerReadOnly.getReviewSlot(sid, i)
            )
          );

          if (Number(session.phase) === Phase.BlindReview) {
            const counts = tallyVotes(slots);
            if (panelNeedsReplacement(slots)) {
              console.log(`[ChainListener] Catch-up: session ${sid} has an incomplete reviewer panel; waiting for replacement.`);
              continue;
            }
            if (counts.total >= counts.activeCount && counts.activeCount >= EXPECTED_BLIND_REVIEWER_COUNT) {
              const outcome = computeOutcome(counts);
              if (outcome === "rebuttal") {
                const tx = await reviewManager.setRebuttalPhase(sid, encodeReason("catchup_rebuttal"));
                await tx.wait();
                console.log(`[ChainListener] Catch-up: session ${sid} moved to REBUTTAL`);
              } else if (outcome === "accepted") {
                const tx = await reviewManager.finalizeSession(sid, Decision.Accepted, encodeReason("catchup_accept"));
                await tx.wait();
              } else if (outcome === "rejected") {
                const tx = await reviewManager.finalizeSession(sid, Decision.Rejected, encodeReason("catchup_reject"));
                await tx.wait();
              }
            }
          } else if (Number(session.phase) === Phase.Rebuttal) {
            const outcome = computeRebuttalOutcome(slots);
            if (outcome === "accepted") {
              const tx = await reviewManager.finalizeSession(sid, Decision.Accepted, encodeReason("catchup_rebuttal_accept"));
              await tx.wait();
              console.log(`[ChainListener] Catch-up: session ${sid} finalized ACCEPTED after rebuttal`);
            } else if (outcome === "rejected") {
              const tx = await reviewManager.finalizeSession(sid, Decision.Rejected, encodeReason("catchup_rebuttal_reject"));
              await tx.wait();
              console.log(`[ChainListener] Catch-up: session ${sid} finalized REJECTED after rebuttal`);
            }
          }
        } catch (err) {
          console.error(`[ChainListener] Catch-up error for session ${sid}:`, err?.message);
        }
      }
      console.log(`[ChainListener] Catch-up complete.`);
    } catch (err) {
      console.error(`[ChainListener] Catch-up scan failed:`, err?.message);
    }
  }

  // Ensure all reviewers currently in slots have assignedReviewers[paperId][reviewer] = true.
  // joinReview (self-select) fills the slot but does not set this mapping, so submitReview
  // would revert for any reviewer who joined without going through assignReviewers().
  async function catchUpAssignedReviewersMappings() {
    try {
      const nextId = Number(await reviewManagerReadOnly.nextSessionId());
      if (nextId <= 1) return;
      for (let sid = 1; sid < nextId; sid++) {
        try {
          const session = await reviewManagerReadOnly.getSession(sid);
          if (session.finalized) continue;
          const reviewerCount = Number(await reviewManagerReadOnly.getReviewerCount(sid));
          if (reviewerCount === 0) continue;
          const slots = await Promise.all(
            Array.from({ length: reviewerCount }, (_, i) =>
              reviewManagerReadOnly.getReviewSlot(sid, i)
            )
          );
          const ZERO = "0x0000000000000000000000000000000000000000";
          const reviewers = slots
            .map((s) => s.reviewer)
            .filter((addr) => addr && addr.toLowerCase() !== ZERO);
          if (reviewers.length === 0) continue;

          const mappingStates = await Promise.all(
            reviewers.map((reviewer) =>
              reviewManagerReadOnly.assignedReviewers(session.paperId, reviewer)
            )
          );
          const missingReviewers = reviewers.filter((_, index) => !mappingStates[index]);
          if (missingReviewers.length === 0) continue;

          const tx = await reviewManager.assignReviewers(session.paperId, missingReviewers);
          await tx.wait();
          console.log(`[ChainListener] Catch-up: registered ${missingReviewers.length} missing reviewer mapping(s) for session ${sid}`);
        } catch (err) {
          console.warn(`[ChainListener] catchUpAssignedReviewersMappings: session ${sid}:`, err?.message);
        }
      }
    } catch (err) {
      console.error(`[ChainListener] catchUpAssignedReviewersMappings failed:`, err?.message);
    }
  }

  let assignedMappingSyncRunning = false;
  async function runAssignedMappingSync() {
    if (assignedMappingSyncRunning) return;
    assignedMappingSyncRunning = true;
    try {
      await catchUpAssignedReviewersMappings();
    } finally {
      assignedMappingSyncRunning = false;
    }
  }

  catchUpSessions();
  runAssignedMappingSync();
  setInterval(runAssignedMappingSync, ASSIGNED_MAPPING_CHECK_INTERVAL_MS);
  console.log(`[ChainListener] Assigned-reviewer mapping sync active (interval: ${ASSIGNED_MAPPING_CHECK_INTERVAL_MS / 1000}s).`);

  // -------------------------------------------------------------------------
  // Catch-up for papers that have no review session yet — handles the case
  // where the listener missed a PaperSubmitted event (e.g. node restart race).
  // -------------------------------------------------------------------------
  async function catchUpMissedPapers() {
    try {
      const filter = paperRegistry.filters.PaperSubmitted();
      const events = await paperRegistry.queryFilter(filter, 0, "latest");
      if (events.length === 0) return;
      console.log(`[ChainListener] Catch-up: found ${events.length} PaperSubmitted event(s) — checking for missing sessions...`);
      for (const event of events) {
        const paperId = event.args[0];
        const author  = event.args[1];
        const title   = event.args[2];
        try {
          const existingSessionId = await reviewManagerReadOnly.paperIdToSessionId(paperId);
          if (Number(existingSessionId) !== 0) continue; // Session already exists
          console.log(`[ChainListener] Catch-up: paper ${paperId} ("${title}") has no session — creating now`);

          const deadline = deadlineTimestamp(REVIEW_DEADLINE_DAYS);
          let reviewerAddresses = [];
          if (typeof assignReviewers === "function") {
            try {
              const result = await assignReviewers(paperId, author, 3, false, title);
              reviewerAddresses = result.assigned.map((r) => r.wallet);
            } catch (err) {
              console.error(`[ChainListener] Catch-up: assignReviewers failed for ${paperId}:`, err?.message);
            }
          }

          if (reviewerAddresses.length === 0) {
            const tx = await reviewManager.createSession(paperId, [], [], deadline, 0);
            await tx.wait();
            console.log(`[ChainListener] Catch-up: created empty session for paper ${paperId}`);
          } else {
            const tx = await reviewManager.createSession(paperId, reviewerAddresses, new Array(reviewerAddresses.length).fill(false), deadline, 0);
            await tx.wait();
            const newSessionId = await reviewManagerReadOnly.paperIdToSessionId(paperId);
            console.log(`[ChainListener] Catch-up: created session ${Number(newSessionId)} for paper ${paperId} with ${reviewerAddresses.length} reviewer(s)`);
            try {
              const assignTx = await reviewManager.assignReviewers(paperId, reviewerAddresses);
              await assignTx.wait();
            } catch (err) {
              console.warn(`[ChainListener] Catch-up: assignReviewers on-chain failed for ${paperId}:`, err?.message);
            }
          }
        } catch (err) {
          console.error(`[ChainListener] Catch-up: failed to process paper ${paperId}:`, err?.message);
        }
      }
    } catch (err) {
      console.error(`[ChainListener] catchUpMissedPapers failed:`, err?.message);
    }
  }

  catchUpMissedPapers();

  // -------------------------------------------------------------------------
  // PaperSubmitted → system-assign 3 reviewers → createSession (pre-assigned)
  // -------------------------------------------------------------------------
  // ReviewerJoined → register the self-select reviewer in assignedReviewers so they
  // can call submitReview. joinReview fills the slot but does not set this mapping.
  reviewManager.on("ReviewerJoined", async (sessionId, reviewer) => {
    try {
      const session = await reviewManagerReadOnly.getSession(sessionId);
      const tx = await reviewManager.assignReviewers(session.paperId, [reviewer]);
      await tx.wait();
      console.log(`[ChainListener] ReviewerJoined: registered ${reviewer} in assignedReviewers for session ${Number(sessionId)}`);
    } catch (err) {
      console.warn(`[ChainListener] ReviewerJoined: failed to register ${reviewer}:`, err?.message);
    }
  });

  paperRegistry.on("PaperSubmitted", async (paperId, author, title) => {
    console.log(`[ChainListener] PaperSubmitted: ${paperId} by ${author} — "${title}"`);
    try {
      const existingSessionId = await reviewManagerReadOnly.paperIdToSessionId(paperId);
      if (Number(existingSessionId) !== 0) {
        console.log(`[ChainListener] Session already exists for ${paperId} — skipping.`);
        return;
      }

      const deadline = deadlineTimestamp(REVIEW_DEADLINE_DAYS);
      let reviewerAddresses = [];

      // System-assign reviewers from the DB
      if (typeof assignReviewers === "function") {
        try {
          const result = await assignReviewers(paperId, author, 3, false, title);
          reviewerAddresses = result.assigned.map((r) => r.wallet);
          console.log(`[ChainListener] Assigned ${reviewerAddresses.length} reviewer(s) for paper ${paperId}`);
        } catch (err) {
          console.error(`[ChainListener] assignReviewers failed for ${paperId}:`, err?.message);
        }
      }

      if (reviewerAddresses.length === 0) {
        // No eligible reviewers — create session with empty slots (waiting state)
        const tx = await reviewManager.createSession(paperId, [], [], deadline, 0);
        await tx.wait();
        console.log(`[ChainListener] Session created (waiting for reviewers) for paper ${paperId}`);
        return;
      }

      const revealOnPublication = reviewerAddresses.map(() => false);
      const tx = await reviewManager.createSession(
        paperId,
        reviewerAddresses,
        revealOnPublication,
        deadline,
        0
      );
      await tx.wait();
      console.log(`[ChainListener] Session created with ${reviewerAddresses.length} pre-assigned reviewer(s) for paper ${paperId}`);

      // Record assignment on-chain
      try {
        const assignTx = await reviewManager.assignReviewers(paperId, reviewerAddresses);
        await assignTx.wait();
        console.log(`[ChainListener] On-chain assignment recorded for paper ${paperId}`);
      } catch (err) {
        console.warn(`[ChainListener] assignReviewers on-chain call failed (non-fatal):`, err?.message);
      }
    } catch (error) {
      console.error(`[ChainListener] Failed to create session for ${paperId}:`, error?.message);
    }
  });

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Settle all submitted reviewers after a session is finalized.
  // Called by the ReviewSubmitted handler after finalizeSession succeeds.
  // -------------------------------------------------------------------------
  async function settleAllReviewers(sessionId, paperId, slots) {
    // Mark any remaining pending assignments for this paper as superseded so they
    // no longer appear in the Assignments panel of reviewers who never accepted.
    if (db) {
      try {
        await db.execute({
          sql: `UPDATE reviewer_assignments SET status = 'superseded'
                WHERE paper_id = ? AND status = 'pending'`,
          args: [paperId],
        });
      } catch (err) {
        console.warn(`[ChainListener] Failed to supersede pending assignments for ${paperId}:`, err?.message);
      }
    }

    if (!protocolVault) return;
    const submittedSlots = slots.filter((s) => !isEmptySlot(s) && s.submitted && !s.declined);
    if (submittedSlots.length === 0) return;

    let rewardPoolRemaining = 0n;
    try {
      const funding = await protocolVault.getPaperFunding(paperId);
      rewardPoolRemaining = funding.rewardPoolRemaining ?? 0n;
    } catch (err) {
      console.warn(`[ChainListener] Could not fetch reward pool for ${paperId}:`, err?.message);
    }

    const rewardPerReviewer = submittedSlots.length > 0
      ? rewardPoolRemaining / BigInt(submittedSlots.length)
      : 0n;

    for (const slot of submittedSlots) {
      try {
        const stake = await protocolVault.getReviewerStake(paperId, slot.reviewer);
        if (!stake.active) continue;
        const tx = await protocolVault.settleReviewer(paperId, slot.reviewer, rewardPerReviewer, 0n);
        await tx.wait();
        console.log(`[ChainListener] Settled reviewer ${slot.reviewer} for session ${sessionId}: reward ${rewardPerReviewer}, slash 0`);
      } catch (err) {
        console.warn(`[ChainListener] Failed to settle ${slot.reviewer}:`, err?.message);
      }
    }
  }

  // ReviewSubmitted → handles both BlindReview and Rebuttal phases.
  //
  // BlindReview: tally with full decision table (3-panel + 2-panel rules)
  // Rebuttal:    binary accept/reject → finalize or trigger tie-breaker
  // -------------------------------------------------------------------------
  reviewManager.on("ReviewSubmitted", async (sessionId, reviewer, vote, reviewCid) => {
    console.log(`[ChainListener] ReviewSubmitted: session ${sessionId}, reviewer ${reviewer}, vote ${vote}`);
    try {
      const session = await reviewManagerReadOnly.getSession(sessionId);
      if (session.finalized || Number(session.phase) === Phase.Decided) return;
      await clearDeclinedSlotsForPaper(session.paperId);

      const reviewerCount = Number(await reviewManagerReadOnly.getReviewerCount(sessionId));
      if (reviewerCount === 0) return;

      const slots = await Promise.all(
        Array.from({ length: reviewerCount }, (_, i) =>
          reviewManagerReadOnly.getReviewSlot(sessionId, i)
        )
      );

      const counts = tallyVotes(slots);

      // ── Blind review phase ──────────────────────────────────────────────
      if (Number(session.phase) === Phase.BlindReview) {
        if (panelNeedsReplacement(slots)) {
          console.log(`[ChainListener] Session ${sessionId}: incomplete reviewer panel — waiting for replacement before finalizing.`);
          return;
        }

        // Wait until all active reviewers have submitted
        if (counts.total < counts.activeCount) {
          console.log(`[ChainListener] Session ${sessionId}: ${counts.total}/${counts.activeCount} blind votes — waiting.`);
          return;
        }

        const outcome = computeOutcome(counts);
        console.log(`[ChainListener] Session ${sessionId} blind votes — accept:${counts.accept} reject:${counts.reject} neutral:${counts.neutral} (panel:${counts.activeCount}) → ${outcome}`);

        if (outcome === "accepted") {
          const tx = await reviewManager.finalizeSession(sessionId, Decision.Accepted, encodeReason("majority_accept"));
          await tx.wait();
          console.log(`[ChainListener] Session ${sessionId} finalized: ACCEPTED`);
          await settleAllReviewers(sessionId, session.paperId, slots);
        } else if (outcome === "rejected") {
          const tx = await reviewManager.finalizeSession(sessionId, Decision.Rejected, encodeReason("majority_reject"));
          await tx.wait();
          console.log(`[ChainListener] Session ${sessionId} finalized: REJECTED`);
          await settleAllReviewers(sessionId, session.paperId, slots);
        } else if (outcome === "rebuttal") {
          const tx = await reviewManager.setRebuttalPhase(sessionId, encodeReason("conflicting_votes_rebuttal"));
          await tx.wait();
          console.log(`[ChainListener] Session ${sessionId} moved to REBUTTAL`);
        }
        return;
      }

      // ── Rebuttal phase ──────────────────────────────────────────────────
      if (Number(session.phase) === Phase.Rebuttal) {
        const rebuttalVotes = slots.filter((s) => !isEmptySlot(s) && s.rebuttalSubmitted);
        const rebuttalActiveCount = slots.filter((s) => !isEmptySlot(s) && !s.declined).length;
        const rebuttalAccept = rebuttalVotes.filter((s) => Number(s.rebuttalVote) === VOTE_ACCEPT).length;
        const rebuttalReject = rebuttalVotes.filter((s) => Number(s.rebuttalVote) === VOTE_REJECT).length;

        // Early finalization
        if (rebuttalAccept >= 2) {
          const tx = await reviewManager.finalizeSession(sessionId, Decision.Accepted, encodeReason("rebuttal_majority_accept"));
          await tx.wait();
          console.log(`[ChainListener] Session ${sessionId} finalized after rebuttal: ACCEPTED (early)`);
          await settleAllReviewers(sessionId, session.paperId, slots);
          return;
        }
        if (rebuttalReject >= 2) {
          const tx = await reviewManager.finalizeSession(sessionId, Decision.Rejected, encodeReason("rebuttal_majority_reject"));
          await tx.wait();
          console.log(`[ChainListener] Session ${sessionId} finalized after rebuttal: REJECTED (early)`);
          await settleAllReviewers(sessionId, session.paperId, slots);
          return;
        }

        // Wait until all active rebuttal voters have submitted
        if (rebuttalVotes.length < rebuttalActiveCount) {
          console.log(`[ChainListener] Session ${sessionId}: ${rebuttalVotes.length}/${rebuttalActiveCount} rebuttal votes — waiting.`);
          return;
        }

        const outcome = computeRebuttalOutcome(slots);
        console.log(`[ChainListener] Session ${sessionId} rebuttal outcome: ${outcome} (panel:${rebuttalActiveCount})`);

        if (outcome === "accepted") {
          const tx = await reviewManager.finalizeSession(sessionId, Decision.Accepted, encodeReason("rebuttal_majority_accept"));
          await tx.wait();
          console.log(`[ChainListener] Session ${sessionId} finalized after rebuttal: ACCEPTED`);
          await settleAllReviewers(sessionId, session.paperId, slots);
        } else if (outcome === "rejected") {
          const tx = await reviewManager.finalizeSession(sessionId, Decision.Rejected, encodeReason("rebuttal_majority_reject"));
          await tx.wait();
          console.log(`[ChainListener] Session ${sessionId} finalized after rebuttal: REJECTED`);
          await settleAllReviewers(sessionId, session.paperId, slots);
        } else if (outcome === "deadlock") {
          // 2-panel rebuttal deadlock (1A + 1R) → assign tie-breaker
          await handleRebuttalDeadlock(session, sessionId, slots);
        }
      }
    } catch (error) {
      console.error(`[ChainListener] Error processing ReviewSubmitted for session ${sessionId}:`, error?.message);
    }
  });

  // -------------------------------------------------------------------------
  // Tie-breaker assignment for 2-panel rebuttal deadlock
  // -------------------------------------------------------------------------
  async function handleRebuttalDeadlock(session, sessionId, slots) {
    console.log(`[ChainListener] Session ${sessionId} deadlocked — assigning tie-breaker`);
    const paperId = session.paperId;
    const tieDeadline = deadlineTimestamp(REVIEW_DEADLINE_DAYS);

    let tiebreakerWallet = null;

    if (typeof assignReviewers === "function") {
      try {
        // Get the author wallet from the DB by looking up existing assignments
        let authorWallet = "";
        if (db) {
          const assignmentResult = await db.execute({
            sql: `SELECT author_wallet FROM reviewer_assignments WHERE paper_id = ? LIMIT 1`,
            args: [paperId],
          });
          authorWallet = assignmentResult.rows[0]?.author_wallet || "";
        }

        const result = await assignReviewers(paperId, authorWallet, 1, true);
        if (result.assigned.length > 0) {
          tiebreakerWallet = result.assigned[0].wallet;
          console.log(`[ChainListener] Tie-breaker assigned: ${tiebreakerWallet} for session ${sessionId}`);
        }
      } catch (err) {
        console.error(`[ChainListener] Tie-breaker assignReviewers failed:`, err?.message);
      }
    }

    if (!tiebreakerWallet) {
      console.warn(`[ChainListener] No tie-breaker available for session ${sessionId} — marking high priority`);
      try {
        const tx = await reviewManager.requestReplacementReview(
          sessionId,
          tieDeadline,
          true,
          encodeReason("tie_breaker_required")
        );
        await tx.wait();
      } catch (err) {
        console.error(`[ChainListener] requestReplacementReview failed for session ${sessionId}:`, err?.message);
      }
      return;
    }

    // Add tie-breaker slot on-chain (add a new empty slot, then set the reviewer)
    // We use assignTiebreaker on the contract to record in the mapping.
    try {
      const assignTx = await reviewManager.assignTiebreaker(paperId, tiebreakerWallet);
      await assignTx.wait();
      console.log(`[ChainListener] On-chain tie-breaker assignment recorded for paper ${paperId}`);
    } catch (err) {
      console.warn(`[ChainListener] assignTiebreaker on-chain failed (non-fatal):`, err?.message);
    }

    // Move session to ReplacementReview with high priority for the tie-breaker
    try {
      const tx = await reviewManager.requestReplacementReview(
        sessionId,
        tieDeadline,
        true,
        encodeReason("tie_breaker_required")
      );
      await tx.wait();
      console.log(`[ChainListener] Session ${sessionId} set to ReplacementReview for tie-breaker`);
    } catch (err) {
      console.error(`[ChainListener] Failed to set tie-breaker phase for session ${sessionId}:`, err?.message);
    }
  }

  // -------------------------------------------------------------------------
  // Track active session IDs so the no-show cron knows what to check.
  // -------------------------------------------------------------------------
  const activeSessionIds = new Set();

  reviewManagerReadOnly.on("SessionCreated", (sessionId) => {
    activeSessionIds.add(Number(sessionId));
  });

  // -------------------------------------------------------------------------
  // No-show slashing cron — runs every hour.
  // -------------------------------------------------------------------------
  async function checkNoShows() {
    if (activeSessionIds.size === 0) return;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));

    for (const sessionId of [...activeSessionIds]) {
      try {
        const session = await reviewManagerReadOnly.getSession(sessionId);
        if (session.finalized || Number(session.phase) === Phase.Decided) {
          activeSessionIds.delete(sessionId);
          continue;
        }
        if (session.deadline > nowSec) continue;
        if (Number(session.phase) !== Phase.BlindReview && Number(session.phase) !== Phase.ReplacementReview) continue;

        const reviewerCount = Number(await reviewManagerReadOnly.getReviewerCount(sessionId));
        if (reviewerCount === 0) continue;

        const slots = await Promise.all(
          Array.from({ length: reviewerCount }, (_, i) =>
            reviewManagerReadOnly.getReviewSlot(sessionId, i)
          )
        );

        const noShowIndices = [];
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (isEmptySlot(slot) || !slot.accepted || slot.submitted || slot.declined) continue;

          const reviewer = slot.reviewer;
          console.log(`[ChainListener] No-show detected: session ${sessionId}, reviewer ${reviewer}`);

          if (reviewerReputation) {
            try {
              const tx = await reviewerReputation.recordNoShow(reviewer);
              await tx.wait();
            } catch (err) {
              console.error(`[ChainListener] Failed to record no-show rep for ${reviewer}:`, err?.message);
            }
          }

          if (protocolVault) {
            try {
              const stake = await protocolVault.getReviewerStake(session.paperId, reviewer);
              if (stake.active) {
                const tx = await protocolVault.settleReviewer(session.paperId, reviewer, 0n, stake.amount);
                await tx.wait();
                console.log(`[ChainListener] Stake slashed for no-show: ${reviewer}`);
              }
            } catch (err) {
              console.error(`[ChainListener] Failed to slash stake for ${reviewer}:`, err?.message);
            }
          }

          try {
            const tx = await reviewManager.clearReviewerSlot(sessionId, i);
            await tx.wait();
            console.log(`[ChainListener] Slot ${i} cleared for session ${sessionId}`);
          } catch (err) {
            console.error(`[ChainListener] Failed to clear slot ${i}:`, err?.message);
          }

          noShowIndices.push(i);

          // Mark the assignment as slashed in the DB
          if (db) {
            try {
              await db.execute({
                sql: `UPDATE reviewer_assignments SET status = 'slashed'
                      WHERE paper_id = ? AND reviewer_wallet = ?`,
                args: [session.paperId, reviewer.toLowerCase()],
              });
            } catch (err) {
              console.warn(`[ChainListener] DB update failed for no-show:`, err?.message);
            }
          }
        }

        if (noShowIndices.length === 0) continue;

        if (typeof assignReviewers === "function") {
          let authorWallet = "";
          if (db) {
            try {
              const r = await db.execute({
                sql: `SELECT author_wallet FROM reviewer_assignments WHERE paper_id = ? LIMIT 1`,
                args: [session.paperId],
              });
              authorWallet = r.rows[0]?.author_wallet || "";
            } catch {}
          }
          try {
            const result = await assignReviewers(session.paperId, authorWallet, noShowIndices.length);
            console.log(`[ChainListener] Replacement reviewer(s) assigned after no-show: ${result.assigned.length}`);
          } catch (err) {
            console.warn(`[ChainListener] Replacement assignment failed:`, err?.message);
          }
        }
      } catch (err) {
        console.error(`[ChainListener] Error checking no-shows for session ${sessionId}:`, err?.message);
      }
    }
  }

  setInterval(checkNoShows, NO_SHOW_CHECK_INTERVAL_MS);
  console.log(`[ChainListener] No-show cron active (interval: ${NO_SHOW_CHECK_INTERVAL_MS / 60000}min).`);

  // -------------------------------------------------------------------------
  // Declined-slot cron — clears on-chain slots for reviewers who declined
  // via the backend API (declined in DB but slot not yet cleared on-chain).
  // Runs every 2 minutes so replacements can join quickly.
  // -------------------------------------------------------------------------
  async function clearDeclinedSlotsForPaper(onlyPaperId = "") {
    if (!db) return;
    try {
      const result = await db.execute({
        sql: `SELECT DISTINCT paper_id, reviewer_wallet FROM reviewer_assignments
              WHERE status = 'declined'
                ${onlyPaperId ? "AND paper_id = ?" : ""}`,
        args: onlyPaperId ? [onlyPaperId] : [],
      });
      for (const row of result.rows) {
        const paperId = row.paper_id;
        const reviewerWallet = String(row.reviewer_wallet || "").toLowerCase();
        try {
          const sessionId = await reviewManagerReadOnly.paperIdToSessionId(paperId);
          if (!sessionId || Number(sessionId) === 0) continue;

          const reviewerCount = Number(await reviewManagerReadOnly.getReviewerCount(sessionId));
          if (reviewerCount === 0) continue;

          const slots = await Promise.all(
            Array.from({ length: reviewerCount }, (_, i) =>
              reviewManagerReadOnly.getReviewSlot(sessionId, i)
            )
          );

          for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (isEmptySlot(slot)) continue;
            if (slot.reviewer.toLowerCase() !== reviewerWallet) continue;
            if (slot.accepted) continue; // Accepted on-chain — leave it alone
            try {
              const tx = await reviewManager.clearReviewerSlot(Number(sessionId), i);
              await tx.wait();
              console.log(`[ChainListener] Cleared declined slot ${i} for session ${Number(sessionId)}, reviewer ${reviewerWallet}`);
            } catch (err) {
              console.warn(`[ChainListener] Failed to clear declined slot ${i}:`, err?.message);
            }
          }
        } catch (err) {
          console.warn(`[ChainListener] checkDeclinedSlots: error for paper ${paperId}:`, err?.message);
        }
      }
    } catch (err) {
      console.error(`[ChainListener] clearDeclinedSlotsForPaper failed:`, err?.message);
    }
  }

  reviewManager.on("AssignmentDeclined", async (sessionId, reviewer) => {
    try {
      const session = await reviewManagerReadOnly.getSession(sessionId);
      await clearDeclinedSlotsForPaper(session.paperId);
      console.log(`[ChainListener] AssignmentDeclined: cleared declined slot for ${reviewer} in session ${Number(sessionId)}`);
    } catch (err) {
      console.warn(`[ChainListener] AssignmentDeclined handler failed:`, err?.message);
    }
  });

  setInterval(clearDeclinedSlotsForPaper, DECLINED_SLOT_CHECK_INTERVAL_MS);
  clearDeclinedSlotsForPaper().catch(() => {});
  console.log(`[ChainListener] Declined-slot cron active (interval: ${DECLINED_SLOT_CHECK_INTERVAL_MS / 1000}s).`);

  console.log("[ChainListener] Listening for on-chain events...");
}
