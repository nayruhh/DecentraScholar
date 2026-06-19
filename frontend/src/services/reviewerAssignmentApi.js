const API_BASE = import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

/**
 * Returns pending and accepted reviewer assignments for a wallet.
 * Each item: { paperId, assignedAt, expiresAt, status, isTiebreaker }
 */
export async function getMyAssignments(wallet) {
  const res = await fetch(
    `${API_BASE}/api/assignments/my-papers?wallet=${encodeURIComponent(wallet)}`
  );
  if (!res.ok) throw new Error(`Failed to fetch assignments: ${res.status}`);
  return res.json();
}

/**
 * Accept a reviewer assignment.
 * Returns { ok, paperId, reviewerWallet } on success.
 * On cooldown: throws an error with { error: "cooldown", retryAfterSeconds }
 */
export async function acceptAssignment(paperId, reviewerWallet) {
  const res = await fetch(`${API_BASE}/api/assignments/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, reviewerWallet }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || "Failed to accept assignment.");
    err.errorCode = data.error;
    err.retryAfterSeconds = data.retryAfterSeconds;
    throw err;
  }
  return data;
}

/**
 * Decline a reviewer assignment.
 * Returns { ok, paperId, reviewerWallet, replacementAssigned } on success.
 */
export async function declineAssignment(paperId, reviewerWallet) {
  const res = await fetch(`${API_BASE}/api/assignments/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, reviewerWallet }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to decline assignment.");
  }
  return data;
}
