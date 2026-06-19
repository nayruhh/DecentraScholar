import { fetchAuditEvents, persistAuditEvent } from "../../../services/auditLogApi";

const AUDIT_LOG_CHANGED_EVENT = "auditlog:changed";
const MAX_AUDIT_EVENTS = 500;

// In-memory cache keyed by lowercase wallet
const cache = {};

function emitChanged(wallet) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AUDIT_LOG_CHANGED_EVENT, { detail: { wallet: wallet.toLowerCase() } })
    );
  }
}

export function loadAuditEvents(wallet) {
  if (!wallet) return [];
  const key = wallet.toLowerCase();
  return Array.isArray(cache[key]) ? [...cache[key]] : [];
}

export function appendAuditEvent(wallet, entry) {
  if (!wallet) return null;
  const key = wallet.toLowerCase();
  const nextEntry = {
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    timestamp: new Date().toISOString(),
    status: "success",
    eventType: "unknown",
    actorWallet: wallet,
    ...entry,
  };

  const current = Array.isArray(cache[key]) ? cache[key] : [];
  cache[key] = [nextEntry, ...current].slice(0, MAX_AUDIT_EVENTS);
  emitChanged(wallet);

  persistAuditEvent(wallet, nextEntry).catch(() => {});
  return nextEntry;
}

export function clearAuditEvents(wallet) {
  if (!wallet) return;
  const key = wallet.toLowerCase();
  cache[key] = [];
  emitChanged(wallet);
}

export async function syncAuditEventsFromBackend(wallet) {
  if (!wallet) return;
  const key = wallet.toLowerCase();
  try {
    const events = await fetchAuditEvents(wallet);
    if (!Array.isArray(events) || events.length === 0) return;
    // Merge: backend events fill in anything not already in cache
    const existing = new Set((cache[key] || []).map((e) => e.id));
    const merged = [...(cache[key] || [])];
    for (const e of events) {
      if (!existing.has(e.id)) merged.push(e);
    }
    merged.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    cache[key] = merged.slice(0, MAX_AUDIT_EVENTS);
    emitChanged(wallet);
  } catch {
    // ignore
  }
}

export function subscribeAuditLog(wallet, listener) {
  if (typeof window === "undefined" || !wallet) return () => {};
  const normalizedWallet = wallet.toLowerCase();

  const handler = (e) => {
    if (e.detail?.wallet === normalizedWallet) {
      listener(loadAuditEvents(wallet));
    }
  };
  window.addEventListener(AUDIT_LOG_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(AUDIT_LOG_CHANGED_EVENT, handler);
  };
}
