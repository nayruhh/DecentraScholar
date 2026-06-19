import {
  getReadOnlyContracts,
  getCoordinatorContracts,
} from "../../../services/decentraScholarContracts";

export const HIGH_PRIORITY_MIN_REPUTATION = 60;
export const REVIEW_RESTRICTION_THRESHOLD = 20;
export const ACCEPTED_NO_SHOW_MIN_SLASH_RATE = 0.5;

const DEFAULT_REPUTATION = {
  reviewerRep: 50,
  reviewerStats: { total: 0, onTime: 0, late: 0, missed: 0 },
};

// In-memory cache — populated by syncReputationFromBackend
const cache = {};

function roundTo2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeWallet(wallet) {
  return String(wallet || "").trim().toLowerCase();
}

function clampRep(value) {
  const num = Number(value ?? 50);
  if (!Number.isFinite(num)) return 50;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function getWalletReputation(wallet) {
  const key = normalizeWallet(wallet);
  const entry = cache[key] || DEFAULT_REPUTATION;
  return {
    reviewerRep: entry.reviewerRep,
    trustScore: entry.reviewerRep,
    reviewerStats: entry.reviewerStats,
  };
}

export async function syncReputationFromBackend(wallet) {
  const key = normalizeWallet(wallet);
  if (!key) return;
  try {
    const contracts = getReadOnlyContracts();
    if (!contracts?.reviewerReputation) return;
    const result = await contracts.reviewerReputation.getReputation(wallet);
    cache[key] = {
      reviewerRep: clampRep(Number(result.reviewerRep)),
      reviewerStats: {
        total:  Number(result.total),
        onTime: Number(result.onTime),
        late:   Number(result.late),
        missed: Number(result.missed),
      },
    };
  } catch {
    // contract not deployed yet (Hardhat reset) — keep default
  }
}

// Called after review settlement — writes to chain via coordinator key
export async function recordReviewerSubmission(wallet, { onTime }) {
  const key = normalizeWallet(wallet);
  const entry = cache[key] || { ...DEFAULT_REPUTATION };
  const wasOnTime = Boolean(onTime);

  // Optimistic local update
  cache[key] = {
    reviewerRep: clampRep(entry.reviewerRep + (wasOnTime ? 2 : -4)),
    reviewerStats: {
      total:  Number(entry.reviewerStats.total || 0) + 1,
      onTime: Number(entry.reviewerStats.onTime || 0) + (wasOnTime ? 1 : 0),
      late:   Number(entry.reviewerStats.late || 0)  + (wasOnTime ? 0 : 1),
      missed: Number(entry.reviewerStats.missed || 0),
    },
  };

  // Write on-chain asynchronously — don't block the caller
  try {
    const coordinatorContracts = getCoordinatorContracts();
    if (coordinatorContracts?.reviewerReputation) {
      const tx = await coordinatorContracts.reviewerReputation.recordSubmission(wallet, wasOnTime);
      await tx.wait();
    }
  } catch {
    // Chain write failed (e.g. Hardhat reset) — local cache still updated
  }

  return getWalletReputation(wallet);
}

export async function recordReviewerNoShow(wallet) {
  const key = normalizeWallet(wallet);
  const entry = cache[key] || { ...DEFAULT_REPUTATION };

  // Optimistic local update
  cache[key] = {
    reviewerRep: clampRep(entry.reviewerRep - 10),
    reviewerStats: {
      total:  Number(entry.reviewerStats.total || 0),
      onTime: Number(entry.reviewerStats.onTime || 0),
      late:   Number(entry.reviewerStats.late || 0),
      missed: Number(entry.reviewerStats.missed || 0) + 1,
    },
  };

  try {
    const coordinatorContracts = getCoordinatorContracts();
    if (coordinatorContracts?.reviewerReputation) {
      const tx = await coordinatorContracts.reviewerReputation.recordNoShow(wallet);
      await tx.wait();
    }
  } catch {
    // Chain write failed — local cache still updated
  }

  return getWalletReputation(wallet);
}

export function getReviewerEligibility(reviewerRep, options = {}) {
  const rep = clampRep(reviewerRep);
  const isHighPriority = Boolean(options.highPriority);
  if (rep < REVIEW_RESTRICTION_THRESHOLD) {
    return {
      allowed: false,
      reason: `Reviewer reputation is ${rep}. Review access is temporarily restricted below ${REVIEW_RESTRICTION_THRESHOLD}.`,
    };
  }
  if (isHighPriority && rep < HIGH_PRIORITY_MIN_REPUTATION) {
    return {
      allowed: false,
      reason: `High-priority papers require reviewer reputation ${HIGH_PRIORITY_MIN_REPUTATION}+; current reputation is ${rep}.`,
    };
  }
  return { allowed: true, reason: "" };
}

export function computeReviewerMinStake(baseStake, reviewerRep, options = {}) {
  const base = Number(baseStake || 0);
  const rep = clampRep(reviewerRep);
  const isHighPriority = Boolean(options.highPriority);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const reputationPenalty = roundTo2(((100 - rep) / 100) * 10);
  const lowRepPenalty = rep < 40 ? roundTo2(((40 - rep) / 40) * 10) : 0;
  const highPriorityPremium = isHighPriority ? 5 : 0;
  return roundTo2(base + reputationPenalty + lowRepPenalty + highPriorityPremium);
}
