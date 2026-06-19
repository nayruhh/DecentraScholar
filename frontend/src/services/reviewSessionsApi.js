const API_BASE_URL =
  import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function fetchReviewSessions(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  const query = wallet ? `?walletAddress=${encodeURIComponent(wallet)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/review-sessions${query}`);
  if (!response.ok) return [];
  const payload = await parseJson(response);
  return Array.isArray(payload?.sessions) ? payload.sessions : [];
}

export async function persistReviewSession(session) {
  const sessionId = String(session?.id || "").trim();
  if (!sessionId) return;
  await fetch(`${API_BASE_URL}/api/review-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
}

export async function deleteReviewSession(sessionId, walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!sessionId || !wallet) return;
  await fetch(
    `${API_BASE_URL}/api/review-sessions/${encodeURIComponent(sessionId)}?walletAddress=${encodeURIComponent(wallet)}`,
    { method: "DELETE" }
  );
}
