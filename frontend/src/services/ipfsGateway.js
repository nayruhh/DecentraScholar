const GATEWAY = import.meta.env.VITE_IPFS_GATEWAY_URL || "https://dweb.link/ipfs";

/**
 * Convert an IPFS CID (with or without ipfs:// prefix) to a full gateway URL.
 * Returns empty string if cid is blank.
 */
export function resolveIpfsUrl(cid) {
  const raw = String(cid || "").trim();
  if (!raw) return "";
  const bare = raw.startsWith("ipfs://") ? raw.slice(7) : raw;
  if (!bare) return "";
  return `${GATEWAY}/${bare}`;
}
