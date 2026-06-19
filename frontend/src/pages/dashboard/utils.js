import { loadWalletAddress } from "../../services/browserSession";

export function truncateAddress(addr) {
  if (!addr) return "";
  if (addr.includes("...")) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function getWalletAddress() {
  return loadWalletAddress();
}
