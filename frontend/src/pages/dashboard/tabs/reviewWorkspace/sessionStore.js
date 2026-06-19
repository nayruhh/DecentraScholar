import {
  deleteReviewSession,
  fetchReviewSessions,
  persistReviewSession,
} from "../../../../services/reviewSessionsApi";
import {
  fetchAllReviewSlotsOnChain,
  fetchSessionByPaperIdOnChain,
  fetchSessionOnChain,
} from "../../../../services/reviewManager";
import { getReadOnlyContracts } from "../../../../services/decentraScholarContracts";
import { fetchReviewFromIpfs } from "../../../../services/publicationArtifactsApi";


const REVIEW_SESSIONS_CHANGED_EVENT = "review-sessions:changed";

const listeners = new Set();

let cachedSessions = [];
let cachedSerialized = JSON.stringify(cachedSessions);
let latestSyncRequestId = 0;

function isRealSession(session) {
  const id = String(session?.id || "").trim().toLowerCase();
  const authorWallet = String(session?.authorWallet || "").trim().toLowerCase();
  return Boolean(
    id &&
      !id.startsWith("mock-") &&
      !authorWallet.includes("authormock")
  );
}

function sanitizeSessions(sessions) {
  return Array.isArray(sessions) ? sessions.filter(isRealSession) : [];
}

function buildSessionKey(session) {
  const sessionId = String(session?.id || "").trim().toLowerCase();
  const authorWallet = String(session?.authorWallet || "").trim().toLowerCase();
  if (!sessionId || !authorWallet) return "";
  return `${authorWallet}::${sessionId}`;
}


function emitReviewSessionsChanged() {
  const snapshot = cachedSessions.slice();
  for (const listener of listeners) {
    listener(snapshot);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(REVIEW_SESSIONS_CHANGED_EVENT));
  }
}

// Decisions are contract-driven. The browser must not finalize from local votes,
// because replacement/decline state can lag behind local session data.
function applyLocalDecisionsToSessions(sessions) {
  return sessions;
}

function replaceCachedSessions(sessions) {
  const sanitized = dedupeSessionList(sanitizeSessions(sessions));
  const withDecisions = applyLocalDecisionsToSessions(sanitized);
  const serialized = JSON.stringify(withDecisions);
  if (serialized === cachedSerialized) {
    return false;
  }
  cachedSessions = withDecisions;
  cachedSerialized = serialized;
  emitReviewSessionsChanged();
  return true;
}

// Phase order — used to ensure phase only ever advances, never regresses.
const PHASE_ORDER = { pending: 0, blind_review: 1, rebuttal: 2, replacement_review: 3, decided: 4 };
function advancedPhase(a, b) {
  const orderA = PHASE_ORDER[a] ?? 0;
  const orderB = PHASE_ORDER[b] ?? 0;
  return orderA >= orderB ? a : b;
}

// Merge two reviewer slot arrays element-wise.
// Scores each slot by data richness (submitted vote > wallet assigned > empty).
// Prefers the richer slot; fills in any missing fields from the other.
function mergeReviewerSlots(local, remote) {
  const maxLen = Math.max(local.length, remote.length);
  if (maxLen === 0) return [];
  const result = [];
  for (let i = 0; i < maxLen; i++) {
    const l = local[i];
    const r = remote[i];
    if (!l) { result.push(r); continue; }
    if (!r) { result.push(l); continue; }
    const score = (slot) =>
      (slot.vote != null && slot.vote !== "" ? 8 : 0) +
      (slot.submitted || slot.submittedDate ? 8 : 0) +
      (slot.reviewCid ? 4 : 0) +
      (slot.reviewerWallet ? 2 : 0) +
      (slot.accepted ? 1 : 0);
    const ls = score(l);
    const rs = score(r);
    // Richer slot wins; other slot fills in any fields that are missing
    result.push(rs > ls ? { ...l, ...r } : { ...r, ...l });
  }
  return result;
}

function reviewTextMissing(reviewer) {
  return !(
    String(reviewer?.summary || "").trim() ||
    String(reviewer?.strengths || "").trim() ||
    String(reviewer?.weaknesses || "").trim() ||
    String(reviewer?.requiredChanges || "").trim()
  );
}

async function hydrateReviewerFromCid(reviewer) {
  if (!reviewer?.reviewCid || !reviewTextMissing(reviewer)) return reviewer;
  const reviewDoc = await fetchReviewFromIpfs(reviewer.reviewCid).catch(() => null);
  if (!reviewDoc) return reviewer;
  return {
    ...reviewer,
    vote: reviewer.vote || reviewDoc.vote || "",
    summary: reviewer.summary || reviewDoc.summary || "",
    strengths: reviewer.strengths || reviewDoc.strengths || "",
    weaknesses: reviewer.weaknesses || reviewDoc.weaknesses || "",
    requiredChanges: reviewer.requiredChanges || reviewDoc.requiredChanges || "",
    submittedDate: reviewer.submittedDate || reviewDoc.submittedDate || "",
    reviewHash: reviewer.reviewHash || reviewDoc.reviewHash || "",
  };
}

async function hydrateReviewersFromCids(reviewers) {
  return Promise.all((reviewers || []).map((reviewer) => hydrateReviewerFromCid(reviewer)));
}

// Merge remote sessions into local cache.
// One-way flags (officiallyPublished, finalized) and more-advanced states
// always win over the remote value — the local state is ground truth for
// anything that has moved forward from the backend's last-known state.
// Also deduplicates by paperId: a chain-discovered session for a paper that
// already has a local session should merge into the existing entry, not create
// a duplicate "chain-<id>" entry that appears as "waiting for reviewer assignment".
function mergeSessions(local, remote) {
  const merged = [...local];
  for (const remoteSession of remote) {
    if (!isRealSession(remoteSession)) continue;
    // Match by id first, then fall back to paperId to collapse duplicates
    let idx = merged.findIndex(
      (s) => String(s?.id || "").toLowerCase() === String(remoteSession?.id || "").toLowerCase()
    );
    if (idx < 0 && remoteSession.paperId) {
      idx = merged.findIndex(
        (s) =>
          s?.paperId &&
          String(s.paperId).toLowerCase() === String(remoteSession.paperId).toLowerCase()
      );
    }
    if (idx >= 0) {
      const localSession = merged[idx];
      merged[idx] = {
        ...localSession,
        ...remoteSession,
        // Keep the local id so the entry doesn't get renamed to "chain-<n>"
        id: localSession.id,
        // One-way flags — once true locally they can never go back
        officiallyPublished: localSession.officiallyPublished || remoteSession.officiallyPublished,
        finalized: localSession.finalized || remoteSession.finalized,
        // Phase only advances — never regress from "decided" back to "blind_review"
        phase: advancedPhase(localSession.phase, remoteSession.phase),
        // Preserve the more advanced decision
        decision: localSession.decision || remoteSession.decision,
        // Prefer the on-chain session id if newly discovered
        onChainSessionId: remoteSession.onChainSessionId || localSession.onChainSessionId,
        // Merge reviewer slots element-wise — richer slot wins per index
        reviewers: mergeReviewerSlots(
          Array.isArray(localSession.reviewers) ? localSession.reviewers : [],
          Array.isArray(remoteSession.reviewers) ? remoteSession.reviewers : []
        ),
      };
    } else {
      merged.push(remoteSession);
    }
  }
  return merged;
}

function sessionDedupeKey(session) {
  const paperId = String(session?.paperId || "").trim().toLowerCase();
  if (paperId) return `paper:${paperId}`;
  const onChainSessionId = Number(session?.onChainSessionId || 0);
  if (onChainSessionId) return `chain:${onChainSessionId}`;
  const id = String(session?.id || "").trim().toLowerCase();
  return id ? `id:${id}` : "";
}

function sessionRichnessScore(session) {
  const reviewers = Array.isArray(session?.reviewers) ? session.reviewers : [];
  return (
    (String(session?.id || "").startsWith("chain-") ? 0 : 8) +
    (session?.title ? 8 : 0) +
    (session?.authorWallet ? 4 : 0) +
    (session?.onChainSessionId ? 4 : 0) +
    reviewers.reduce((total, reviewer) => {
      return total +
        (reviewer?.reviewerWallet ? 1 : 0) +
        (reviewer?.accepted || reviewer?.requestStatus === "accepted" ? 1 : 0) +
        (reviewer?.submitted || reviewer?.submittedDate ? 2 : 0) +
        (reviewer?.summary || reviewer?.strengths || reviewer?.weaknesses || reviewer?.requiredChanges ? 4 : 0);
    }, 0)
  );
}

function dedupeSessionList(sessions) {
  const map = new Map();
  for (const session of sessions || []) {
    const key = sessionDedupeKey(session);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, session);
      continue;
    }
    const existing = map.get(key);
    const existingWins = sessionRichnessScore(existing) >= sessionRichnessScore(session);
    const base = existingWins ? existing : session;
    const incoming = existingWins ? session : existing;
    map.set(key, {
      ...incoming,
      ...base,
      id: String(base?.id || "").startsWith("chain-") && incoming?.id ? incoming.id : base.id,
      phase: advancedPhase(base.phase, incoming.phase),
      decision: base.decision || incoming.decision,
      finalized: base.finalized || incoming.finalized,
      officiallyPublished: base.officiallyPublished || incoming.officiallyPublished,
      onChainSessionId: base.onChainSessionId || incoming.onChainSessionId,
      reviewers: mergeReviewerSlots(
        Array.isArray(incoming.reviewers) ? incoming.reviewers : [],
        Array.isArray(base.reviewers) ? base.reviewers : []
      ),
    });
  }
  return Array.from(map.values());
}

export function loadCanonicalReviewSessions() {
  return cachedSessions.slice();
}

export function saveReviewSessionsToStorage(sessions) {
  const previousSessions = cachedSessions.slice();
  if (!replaceCachedSessions(sessions)) {
    return;
  }

  const nextSessionKeys = new Set(cachedSessions.map(buildSessionKey).filter(Boolean));
  for (const session of cachedSessions) {
    persistReviewSession(session).catch(() => {});
  }
  for (const session of previousSessions) {
    const sessionKey = buildSessionKey(session);
    if (!sessionKey || nextSessionKeys.has(sessionKey)) continue;
    deleteReviewSession(session.id, session.authorWallet).catch(() => {});
  }
}

export function upsertCanonicalReviewSession(session) {
  const nextSession = isRealSession(session) ? session : null;
  if (!nextSession) return;

  const existing = loadCanonicalReviewSessions();
  const next = [...existing];
  const matchIndex = next.findIndex(
    (item) =>
      String(item?.id || "").trim().toLowerCase() === String(nextSession.id || "").trim().toLowerCase() ||
      (String(item?.paperId || "").trim() && String(item?.paperId || "").trim() === String(nextSession.paperId || "").trim())
  );
  if (matchIndex >= 0) {
    next[matchIndex] = { ...next[matchIndex], ...nextSession };
  } else {
    next.unshift(nextSession);
  }
  saveReviewSessionsToStorage(next);
}

export function subscribeReviewSessions(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  listener(loadCanonicalReviewSessions());
  return () => {
    listeners.delete(listener);
  };
}

export function listOfficiallyPublishedSessions() {
  const byPaperId = new Map();
  for (const session of loadCanonicalReviewSessions()) {
    if (!session?.officiallyPublished || !session?.paperId) continue;
    byPaperId.set(String(session.paperId), session);
  }
  return Array.from(byPaperId.values());
}

/**
 * For each locally-known session that has a paperId, queries ReviewManager on-chain
 * to get the authoritative phase, decision, and reviewer slot states.
 * Chain state always wins for finalized/decision — no one can tamper with it.
 */
export async function syncReviewSessionsFromChain() {
  // ── Step 1: Discover sessions on-chain that are not yet in local cache ──
  try {
    const contracts = getReadOnlyContracts();
    if (contracts?.reviewManager) {
      const nextId = Number(await contracts.reviewManager.nextSessionId());
      // nextSessionId starts at 1, so valid IDs are 1..(nextId-1)
      const knownOnChainIds = new Set(
        cachedSessions.map((s) => Number(s?.onChainSessionId || 0)).filter(Boolean)
      );
      const unknownIds = [];
      for (let id = 1; id < nextId; id++) {
        if (!knownOnChainIds.has(id)) unknownIds.push(id);
      }
      if (unknownIds.length > 0) {
        const discovered = await Promise.allSettled(
          unknownIds.map((id) => fetchSessionOnChain(id))
        );
        const phaseMap = { 0: "pending", 1: "blind_review", 2: "rebuttal", 3: "replacement_review", 4: "decided" };
        const decisionMap = { 0: null, 1: "accepted", 2: "rejected", 3: "revision_requested", 4: "abandoned" };
        const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

        const CHAIN_VOTE_MAP = { 1: "accept", 2: "reject", 3: "neutral" };
        const normalizeChainVote = (v) => CHAIN_VOTE_MAP[Number(v)] || null;

        const toAdd = [];
        for (const result of discovered) {
          if (result.status !== "fulfilled" || !result.value || result.value.sessionId === 0) continue;
          const onChain = result.value;
          const slots = await fetchAllReviewSlotsOnChain(onChain.sessionId);

          // Fetch the paper author from PaperRegistry so we can persist the session properly.
          let authorWallet = "";
          try {
            if (contracts.paperRegistry && onChain.paperId) {
              const addr = await contracts.paperRegistry.getPaperAuthor(onChain.paperId);
              if (addr && addr !== NULL_ADDRESS) authorWallet = addr.toLowerCase();
            }
          } catch {
            // author lookup failed — leave empty
          }

          const reviewers = await hydrateReviewersFromCids(slots.map((slot) => ({
            reviewerWallet: slot.reviewer === NULL_ADDRESS ? null : slot.reviewer,
            requestStatus: slot.reviewer === NULL_ADDRESS ? "requested" : (slot.accepted ? "accepted" : "requested"),
            accepted: slot.accepted,
            submitted: slot.submitted,
            vote: slot.submitted ? normalizeChainVote(slot.vote) : null,
            reviewCid: slot.reviewCid || "",
            rebuttalVote: slot.rebuttalSubmitted ? normalizeChainVote(slot.rebuttalVote) : null,
            rebuttalCid: slot.rebuttalCid || "",
          })));

          toAdd.push({
            id: `chain-${onChain.sessionId}`,
            paperId: onChain.paperId,
            authorWallet,
            onChainSessionId: onChain.sessionId,
            phase: onChain.finalized ? "decided" : (phaseMap[onChain.phase] || "blind_review"),
            decision: decisionMap[onChain.decision] || null,
            finalized: onChain.finalized,
            highPriority: onChain.highPriority,
            rebuttalCid: onChain.rebuttalCid || "",
            reviewers,
          });
        }
        if (toAdd.length > 0) {
          replaceCachedSessions(mergeSessions(cachedSessions, toAdd));
        }
      }
    }
  } catch {
    // chain not reachable — continue with known sessions
  }

  // ── Step 2: Update known sessions from chain ─────────────────────────────
  const sessions = cachedSessions.slice();
  const withPaperIds = sessions.filter((s) => s?.paperId);
  if (!withPaperIds.length) return;

  const updated = await Promise.allSettled(
    withPaperIds.map(async (session) => {
      const onChain = await fetchSessionByPaperIdOnChain(session.paperId);
      if (!onChain || onChain.sessionId === 0) return null;

      const slots = await fetchAllReviewSlotsOnChain(onChain.sessionId);

      // Map on-chain phase (enum) → local phase string
      const phaseMap = { 0: "pending", 1: "blind_review", 2: "rebuttal", 3: "replacement_review", 4: "decided" };
      const decisionMap = { 0: null, 1: "accepted", 2: "rejected", 3: "revision_requested", 4: "abandoned" };

      const chainPhase = phaseMap[onChain.phase] || session.phase;
      const chainDecision = decisionMap[onChain.decision] || session.decision;

      // Merge reviewer slot data from chain into local reviewer array.
      // Match by wallet address first; fall back to slot index for cleared slots
      // (coordinator called clearReviewerSlot — reviewer address is now address(0)).
      const localReviewers = Array.isArray(session.reviewers) ? session.reviewers : [];
      const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
      const CHAIN_VOTE_MAP_MERGE = { 1: "accept", 2: "reject", 3: "neutral" };
      const normalizeChainVoteMerge = (v) => {
        if (v === "accept" || v === "reject" || v === "neutral") return v;
        return CHAIN_VOTE_MAP_MERGE[Number(v)] || null;
      };
      const mergedReviewers = localReviewers.map((local, idx) => {
        // Try wallet-address match first
        let chainSlot = slots.find(
          (s) =>
            s.reviewer.toLowerCase() !== NULL_ADDRESS &&
            s.reviewer.toLowerCase() === String(local.reviewerWallet || "").toLowerCase()
        );
        // Local slot has no wallet but chain has a real reviewer at this index — populate from chain.
        // This fixes the case where the backend session has null wallets while the chain already
        // records the reviewer who joined via joinReview.
        if (!chainSlot && !local.reviewerWallet && slots[idx] && slots[idx].reviewer.toLowerCase() !== NULL_ADDRESS) {
          chainSlot = slots[idx];
        }
        // If no wallet match, check if the corresponding index slot was cleared
        if (!chainSlot && slots[idx] && slots[idx].reviewer.toLowerCase() === NULL_ADDRESS) {
          // Only reopen slot if reviewer hasn't submitted locally — preserve submitted reviewer data
          // (reviewer may have submitted locally before onChainSessionId was linked, so on-chain slot is still NULL)
          const hasSubmitted = local.submitted || local.submittedDate || (local.vote != null && local.vote !== "");
          if (hasSubmitted) return local;
          return {
            reviewerWallet: null,
            requestStatus: "requested",
            requestOpenedOn: local.requestOpenedOn || new Date().toISOString().split("T")[0],
            requestExpiresOn: null,
            requestRound: Number(local.requestRound || 1) + 1,
          };
        }
        if (!chainSlot) return local;
        return {
          ...local,
          reviewerWallet: chainSlot.reviewer || local.reviewerWallet,
          accepted: chainSlot.accepted || local.accepted,
          declined: chainSlot.declined || local.declined,
          submitted: chainSlot.submitted || local.submitted,
          vote: chainSlot.submitted ? normalizeChainVoteMerge(chainSlot.vote) : local.vote,
          reviewCid: chainSlot.reviewCid || local.reviewCid || "",
          rebuttalVote: chainSlot.rebuttalSubmitted
            ? normalizeChainVoteMerge(chainSlot.rebuttalVote)
            : local.rebuttalVote,
          rebuttalCid: chainSlot.rebuttalCid || local.rebuttalCid || "",
        };
      });
      const hydratedReviewers = await hydrateReviewersFromCids(mergedReviewers);

      let resolvedPhase = onChain.finalized ? "decided" : chainPhase;
      let resolvedDecision = chainDecision;
      let resolvedFinalized = onChain.finalized;

      return {
        ...session,
        onChainSessionId: onChain.sessionId,
        phase: resolvedPhase,
        decision: resolvedDecision,
        finalized: resolvedFinalized,
        rebuttalCid: onChain.rebuttalCid || session.rebuttalCid || "",
        reviewers: hydratedReviewers,
      };
    })
  );

  let changed = false;
  const next = cachedSessions.slice();
  for (const result of updated) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const merged = result.value;
    const idx = next.findIndex(
      (s) => String(s?.id || "").toLowerCase() === String(merged.id || "").toLowerCase()
    );
    if (idx >= 0) {
      next[idx] = merged;
      changed = true;
    }
  }

  if (changed) {
    replaceCachedSessions(next);
  }
}

/**
 * Loads review sessions from the backend and merges them into the local cache.
 * Local state wins for one-way flags (officiallyPublished, finalized).
 * Remote state fills in anything missing locally.
 */
export async function syncReviewSessionsFromBackend(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  const requestId = ++latestSyncRequestId;

  let ownSessions = [];
  let allSessions = [];
  try {
    // Fetch author's own sessions (by wallet) AND all sessions (for reviewer discovery).
    // Both calls run in parallel.
    [ownSessions, allSessions] = await Promise.all([
      wallet ? fetchReviewSessions(wallet) : Promise.resolve([]),
      fetchReviewSessions(""), // no filter — returns every session in the DB
    ]);
  } catch {
    return;
  }

  if (requestId !== latestSyncRequestId) return;

  // Combine: own sessions first so local state wins on conflicts, then merge in
  // any sessions from the global list. If a session ID already exists (because
  // both the author and a reviewer persisted versions under different wallets),
  // merge reviewer slot data rather than discarding the duplicate — that duplicate
  // may contain the only copy of the reviewer's submitted vote.
  const combined = [...ownSessions];
  for (const s of allSessions) {
    const existingIdx = combined.findIndex(
      (c) => String(c?.id || "").toLowerCase() === String(s?.id || "").toLowerCase()
    );
    if (existingIdx < 0) {
      combined.push(s);
    } else {
      const existing = combined[existingIdx];
      combined[existingIdx] = {
        ...existing,
        reviewers: mergeReviewerSlots(
          Array.isArray(existing.reviewers) ? existing.reviewers : [],
          Array.isArray(s.reviewers) ? s.reviewers : []
        ),
        phase: advancedPhase(existing.phase, s.phase),
        decision: existing.decision || s.decision,
        finalized: existing.finalized || s.finalized,
        onChainSessionId: s.onChainSessionId || existing.onChainSessionId,
      };
    }
  }

  if (combined.length === 0) return;

  const merged = mergeSessions(cachedSessions, combined);
  replaceCachedSessions(merged);
}
