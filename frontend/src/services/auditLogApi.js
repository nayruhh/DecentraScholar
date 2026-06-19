const API_BASE_URL =
  import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function fetchAuditEvents(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet) return [];
  const response = await fetch(
    `${API_BASE_URL}/api/audit-log?walletAddress=${encodeURIComponent(wallet)}`
  );
  if (!response.ok) return [];
  const payload = await parseJson(response);
  return Array.isArray(payload?.events) ? payload.events : [];
}

export async function persistAuditEvent(walletAddress, event) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet || !event?.id) return;
  await fetch(`${API_BASE_URL}/api/audit-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: wallet, event }),
  });
}
