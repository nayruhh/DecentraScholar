const API_BASE_URL =
  import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function fetchReputation(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet) return null;
  const response = await fetch(
    `${API_BASE_URL}/api/reputation?walletAddress=${encodeURIComponent(wallet)}`
  );
  if (!response.ok) return null;
  return parseJson(response);
}

export async function persistReputation(walletAddress, reviewerRep, reviewerStats) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet) return;
  await fetch(`${API_BASE_URL}/api/reputation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: wallet, reviewerRep, reviewerStats }),
  });
}
