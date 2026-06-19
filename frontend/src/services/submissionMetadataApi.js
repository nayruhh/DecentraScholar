const API_BASE_URL =
  import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function fetchSubmissionMetadata(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet) return [];
  const response = await fetch(
    `${API_BASE_URL}/api/submission-metadata?walletAddress=${encodeURIComponent(wallet)}`
  );
  if (!response.ok) return [];
  const payload = await parseJson(response);
  return Array.isArray(payload?.items) ? payload.items : [];
}

export async function persistSubmissionMetadataEntry(metadataId, entry) {
  const id = String(metadataId || "").trim();
  if (!id) return;
  await fetch(`${API_BASE_URL}/api/submission-metadata/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export async function deleteSubmissionMetadataEntry(metadataId, walletAddress) {
  const id = String(metadataId || "").trim();
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!id || !wallet) return;
  await fetch(
    `${API_BASE_URL}/api/submission-metadata/${encodeURIComponent(id)}?walletAddress=${encodeURIComponent(wallet)}`,
    { method: "DELETE" }
  );
}
