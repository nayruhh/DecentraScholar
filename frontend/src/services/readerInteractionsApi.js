import { loadWalletAddress } from "./browserSession";

const API_BASE_URL =
  import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

function getSessionIdentity() {
  const key = "readerSessionId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  localStorage.setItem(key, created);
  return created;
}

export function getReaderIdentityKey() {
  const wallet = String(loadWalletAddress() || "").trim().toLowerCase();
  return wallet || getSessionIdentity();
}

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function fetchPaperStats(paperIds = [], identityKey = getReaderIdentityKey()) {
  const ids = paperIds.map((paperId) => String(paperId || "").trim()).filter(Boolean);
  if (ids.length === 0) return {};

  const url = new URL("/api/papers/stats", API_BASE_URL);
  url.searchParams.set("ids", ids.join(","));
  if (identityKey) url.searchParams.set("identityKey", identityKey);

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error("Could not load shared reader interaction stats.");
  }
  const payload = await parseJson(response);
  return payload?.stats || {};
}

export async function submitPaperRating(paperId, rating, identityKey = getReaderIdentityKey()) {
  const response = await fetch(
    `${API_BASE_URL}/api/papers/${encodeURIComponent(paperId)}/rating`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityKey, rating }),
    }
  );
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not save your rating.");
  }
  return payload;
}

