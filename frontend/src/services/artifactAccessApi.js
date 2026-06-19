const API_BASE_URL =
  import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await parseJson(response);
  if (!response.ok) {
    const error = new Error(payload?.error || "Request failed.");
    error.payload = payload;
    throw error;
  }
  return payload;
}

function normalizeWallet(value) {
  return String(value || "").trim().toLowerCase();
}

export async function syncPaperArtifactAccess({ paperId, authorWallet, reviewerWallets = [] }) {
  return requestJson(`${API_BASE_URL}/api/ipfs/access/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId: String(paperId || "").trim(),
      authorWallet: normalizeWallet(authorWallet),
      reviewerWallets: Array.isArray(reviewerWallets)
        ? reviewerWallets.map(normalizeWallet).filter(Boolean)
        : [],
    }),
  });
}

export async function getPaperArtifactsForWallet({ paperId, requesterWallet }) {
  const params = new URLSearchParams();
  if (requesterWallet) {
    params.set("requesterWallet", normalizeWallet(requesterWallet));
  }
  return requestJson(
    `${API_BASE_URL}/api/ipfs/papers/${encodeURIComponent(String(paperId || "").trim())}/artifacts?${params.toString()}`
  );
}
