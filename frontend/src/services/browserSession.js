import { fetchProfile, persistProfile } from "./profileApi";

const WALLET_ADDRESS_KEY = "walletAddress";
const BROWSER_SESSION_CHANGED_EVENT = "browser-session:changed";

// In-memory display name cache keyed by lowercase wallet
const profileNameCache = {};

function emitBrowserSessionChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BROWSER_SESSION_CHANGED_EVENT));
  }
}

export function loadWalletAddress() {
  try {
    return localStorage.getItem(WALLET_ADDRESS_KEY) || "";
  } catch {
    return "";
  }
}

export function saveWalletAddress(walletAddress) {
  try {
    const nextValue = String(walletAddress || "");
    if (localStorage.getItem(WALLET_ADDRESS_KEY) === nextValue) return;
    localStorage.setItem(WALLET_ADDRESS_KEY, nextValue);
    emitBrowserSessionChanged();
  } catch {
    // ignore storage failures in restricted environments
  }
}

export function clearWalletAddress() {
  try {
    localStorage.removeItem(WALLET_ADDRESS_KEY);
    emitBrowserSessionChanged();
  } catch {
    // ignore storage failures in restricted environments
  }
}

export function loadProfileDisplayName() {
  const wallet = loadWalletAddress().toLowerCase();
  if (wallet && profileNameCache[wallet] !== undefined) {
    return profileNameCache[wallet];
  }
  return "";
}

export function saveProfileDisplayName(name) {
  const wallet = loadWalletAddress().toLowerCase();
  const nextValue = String(name || "").trim();
  if (!wallet) return;
  profileNameCache[wallet] = nextValue;
  emitBrowserSessionChanged();
  persistProfile(wallet, nextValue).catch(() => {});
}

export async function syncProfileFromBackend(walletAddress) {
  const wallet = String(walletAddress || "").trim().toLowerCase();
  if (!wallet) return;
  try {
    const data = await fetchProfile(wallet);
    if (!data) return;
    const name = String(data.displayName || "").trim();
    if (name && profileNameCache[wallet] === undefined) {
      profileNameCache[wallet] = name;
      emitBrowserSessionChanged();
    }
  } catch {
    // ignore
  }
}

export function subscribeBrowserSession(listener) {
  if (typeof window === "undefined" || typeof listener !== "function") {
    return () => {};
  }

  const emit = () =>
    listener({
      walletAddress: loadWalletAddress(),
      profileDisplayName: loadProfileDisplayName(),
    });

  const onStorage = (event) => {
    if (event.key === WALLET_ADDRESS_KEY) emit();
  };

  window.addEventListener(BROWSER_SESSION_CHANGED_EVENT, emit);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(BROWSER_SESSION_CHANGED_EVENT, emit);
    window.removeEventListener("storage", onStorage);
  };
}
