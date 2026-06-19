import {
  encodePaperIdForContract,
  getCoordinatorContracts,
  getWritableContracts,
} from "./decentraScholarContracts";

// ---------------------------------------------------------------------------
// Coordinator actions — signed by the coordinator wallet (server-held key)
// ---------------------------------------------------------------------------

/**
 * Create a review session on-chain. Called by coordinator when assigning reviewers.
 * Returns the on-chain sessionId (uint256 as BigInt).
 */
export async function createSessionOnChain({
  paperId,
  reviewerAddresses,
  revealOnPublication,
  deadlineTimestamp,
  revisionCycle = 0,
}) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  if (!Array.isArray(reviewerAddresses) || reviewerAddresses.length === 0) {
    throw new Error("At least one reviewer address is required.");
  }

  const reveal = Array.isArray(revealOnPublication)
    ? revealOnPublication
    : reviewerAddresses.map(() => false);

  const contracts = getCoordinatorContracts();
  if (!contracts?.reviewManager) throw new Error("ReviewManager contract not configured.");

  const tx = await contracts.reviewManager.createSession(
    encodedPaperId,
    reviewerAddresses,
    reveal,
    BigInt(deadlineTimestamp),
    revisionCycle
  );
  const receipt = await tx.wait();

  // Parse sessionId from SessionCreated event
  const iface = contracts.reviewManager.interface;
  let sessionId = null;
  for (const log of receipt.logs || []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "SessionCreated") {
        sessionId = parsed.args.sessionId;
        break;
      }
    } catch {
      // ignore unparseable logs
    }
  }

  return { txHash: tx.hash, receipt, sessionId };
}

export async function setRebuttalPhaseOnChain(sessionId, reason = "") {
  const contracts = getCoordinatorContracts();
  if (!contracts?.reviewManager) throw new Error("ReviewManager contract not configured.");
  const tx = await contracts.reviewManager.setRebuttalPhase(
    BigInt(sessionId),
    encodeReason(reason)
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

export async function finalizeSessionOnChain(sessionId, decision, reason = "") {
  // decision: 1=Accepted, 2=Rejected, 3=RevisionRequested, 4=Abandoned
  const contracts = getCoordinatorContracts();
  if (!contracts?.reviewManager) throw new Error("ReviewManager contract not configured.");
  const tx = await contracts.reviewManager.finalizeSession(
    BigInt(sessionId),
    decision,
    encodeReason(reason)
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

export async function extendDeadlineOnChain(sessionId, newDeadlineTimestamp, reason = "") {
  const contracts = getCoordinatorContracts();
  if (!contracts?.reviewManager) throw new Error("ReviewManager contract not configured.");
  const tx = await contracts.reviewManager.extendDeadline(
    BigInt(sessionId),
    BigInt(newDeadlineTimestamp),
    encodeReason(reason)
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

export async function requestReplacementReviewOnChain(sessionId, nextDeadlineTimestamp, highPriority = false, reason = "") {
  const contracts = getCoordinatorContracts();
  if (!contracts?.reviewManager) throw new Error("ReviewManager contract not configured.");
  const tx = await contracts.reviewManager.requestReplacementReview(
    BigInt(sessionId),
    BigInt(nextDeadlineTimestamp),
    highPriority,
    encodeReason(reason)
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

// ---------------------------------------------------------------------------
// Reviewer actions — signed by the reviewer's own wallet via MetaMask
// ---------------------------------------------------------------------------

/**
 * Reviewer self-selects into an open slot. Signed by msg.sender (the reviewer).
 * Used for the self-select flow where sessions are created with empty slots.
 */
export async function joinReviewOnChain(sessionId, identityMayReveal = false) {
  const contracts = await getWritableContracts();
  const tx = await contracts.reviewManager.joinReview(BigInt(sessionId), identityMayReveal);
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

/** Reviewer accepts their assignment. Signed by msg.sender (the reviewer). */
export async function acceptAssignmentOnChain(sessionId) {
  const contracts = await getWritableContracts();
  const tx = await contracts.reviewManager.acceptAssignment(BigInt(sessionId));
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

/** Reviewer declines their assignment. Signed by msg.sender (the reviewer). */
export async function declineAssignmentOnChain(sessionId) {
  const contracts = await getWritableContracts();
  const tx = await contracts.reviewManager.declineAssignment(BigInt(sessionId));
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

/**
 * Reviewer submits their review on-chain.
 * reviewCid should be the IPFS CID already pinned via pinReviewToIpfs.
 * vote: 1=Accept, 2=Reject, 3=MajorRevision, 4=MinorRevision
 */
export async function submitReviewOnChain(sessionId, vote, reviewCid) {
  if (!reviewCid) throw new Error("reviewCid is required — pin the review to IPFS first.");
  const contracts = await getWritableContracts();
  const tx = await contracts.reviewManager.submitReview(
    BigInt(sessionId),
    vote,
    reviewCid
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

// ---------------------------------------------------------------------------
// Author actions — signed by the author's own wallet via MetaMask
// ---------------------------------------------------------------------------

/**
 * Author submits their rebuttal on-chain during the Rebuttal phase.
 * rebuttalCid should be the IPFS CID of the pinned rebuttal document.
 */
export async function submitRebuttalOnChain(sessionId, rebuttalCid) {
  if (!rebuttalCid) throw new Error("rebuttalCid is required — pin the rebuttal to IPFS first.");
  const contracts = await getWritableContracts();
  const tx = await contracts.reviewManager.submitRebuttal(
    BigInt(sessionId),
    rebuttalCid
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

// ---------------------------------------------------------------------------
// Read-only queries
// ---------------------------------------------------------------------------

export async function fetchSessionOnChain(sessionId) {
  const { getReadOnlyContracts } = await import("./decentraScholarContracts");
  const contracts = getReadOnlyContracts();
  if (!contracts?.reviewManager) return null;
  try {
    const s = await contracts.reviewManager.getSession(BigInt(sessionId));
    return decodeSession(s);
  } catch {
    return null;
  }
}

export async function fetchSessionByPaperIdOnChain(paperId) {
  const { getReadOnlyContracts } = await import("./decentraScholarContracts");
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) return null;
  const contracts = getReadOnlyContracts();
  if (!contracts?.reviewManager) return null;
  try {
    const s = await contracts.reviewManager.getSessionByPaperId(encodedPaperId);
    return decodeSession(s);
  } catch {
    return null;
  }
}

export async function fetchReviewSlotOnChain(sessionId, slotIndex) {
  const { getReadOnlyContracts } = await import("./decentraScholarContracts");
  const contracts = getReadOnlyContracts();
  if (!contracts?.reviewManager) return null;
  try {
    const slot = await contracts.reviewManager.getReviewSlot(BigInt(sessionId), BigInt(slotIndex));
    return {
      reviewer: slot.reviewer,
      identityMayReveal: slot.identityMayReveal,
      accepted: slot.accepted,
      declined: slot.declined,
      submitted: slot.submitted,
      vote: Number(slot.vote),
      reviewCid: slot.reviewCid || "",
      rebuttalSubmitted: slot.rebuttalSubmitted || false,
      rebuttalVote: Number(slot.rebuttalVote),
      rebuttalCid: slot.rebuttalCid || "",
    };
  } catch {
    return null;
  }
}

export async function isEjectedFromSession(sessionId, reviewerAddress) {
  const { getReadOnlyContracts } = await import("./decentraScholarContracts");
  const contracts = getReadOnlyContracts();
  if (!contracts?.reviewManager) return false;
  try {
    return await contracts.reviewManager.isEjectedFromSession(BigInt(sessionId), reviewerAddress);
  } catch {
    return false;
  }
}

export async function fetchAllReviewSlotsOnChain(sessionId) {
  const { getReadOnlyContracts } = await import("./decentraScholarContracts");
  const contracts = getReadOnlyContracts();
  if (!contracts?.reviewManager) return [];
  try {
    const count = Number(await contracts.reviewManager.getReviewerCount(BigInt(sessionId)));
    const slots = await Promise.all(
      Array.from({ length: count }, (_, i) => fetchReviewSlotOnChain(sessionId, i))
    );
    return slots.filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeReason(reason) {
  // Encode a short string reason as bytes32, truncate if needed
  const raw = String(reason || "").trim();
  if (!raw) return "0x" + "0".repeat(64);
  const bytes = new TextEncoder().encode(raw.slice(0, 31));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return "0x" + hex.padEnd(64, "0");
}

function decodeSession(s) {
  return {
    sessionId: Number(s.sessionId),
    paperId: s.paperId,
    deadline: Number(s.deadline),
    revisionCycle: Number(s.revisionCycle),
    decision: Number(s.decision),
    phase: Number(s.phase),
    roundStatus: Number(s.roundStatus),
    highPriority: s.highPriority,
    finalized: s.finalized,
    resolutionReason: s.resolutionReason,
    rebuttalCid: s.rebuttalCid || "",
  };
}
