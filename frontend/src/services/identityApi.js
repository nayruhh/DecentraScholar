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

export async function getWalletIdentity(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet) {
    return { walletAddress: "", email: "", verifiedAt: null, isVerified: false };
  }
  return requestJson(`${API_BASE_URL}/api/auth/wallets/${encodeURIComponent(wallet)}`);
}

export async function getOtpSession(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet) return null;
  const payload = await requestJson(
    `${API_BASE_URL}/api/auth/otp/session/${encodeURIComponent(wallet)}`
  );
  return payload?.session || null;
}

export async function requestEmailOtp({ walletAddress, email }) {
  return requestJson(`${API_BASE_URL}/api/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: String(walletAddress || "").trim().toLowerCase(),
      email: String(email || "").trim(),
    }),
  });
}

export async function verifyEmailOtp({ walletAddress, code }) {
  return requestJson(`${API_BASE_URL}/api/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: String(walletAddress || "").trim().toLowerCase(),
      code: String(code || "").trim(),
    }),
  });
}

export async function resetOtpSession(walletAddress) {
  return requestJson(`${API_BASE_URL}/api/auth/otp/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: String(walletAddress || "").trim().toLowerCase(),
    }),
  });
}

export async function resetWalletIdentity(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  return requestJson(`${API_BASE_URL}/api/auth/wallets/${encodeURIComponent(wallet)}/reset-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}
