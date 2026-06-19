import { fetchDstBalance, hasDstBalanceSupport } from "../../../services/dstToken";
import { getReadOnlyContracts } from "../../../services/decentraScholarContracts";
import { formatUnits } from "ethers";

const TOKENOMICS_CHANGED_EVENT = "tokenomics:changed";

export const SUBMISSION_FEE_DST = 90;

// In-memory cache — populated from chain, never persisted to localStorage
let cachedChainBalance = 0;
let cachedWebsiteGasTreasury = 0;

export function loadTokenomicsState() {
  return {
    walletBalance: cachedChainBalance,
    // reviewerRewardPool is always 0 — settleReviewer pays out directly on-chain
    reviewerRewardPool: 0,
    websiteGasTreasury: cachedWebsiteGasTreasury,
  };
}

export async function refreshWalletBalanceFromChain() {
  if (!hasDstBalanceSupport()) return 0;
  const balance = await fetchDstBalance();
  cachedChainBalance = balance;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TOKENOMICS_CHANGED_EVENT));
  }
  return balance;
}

export async function refreshVaultStateFromChain() {
  try {
    const contracts = getReadOnlyContracts();
    if (!contracts?.dstProtocolVault) return;
    const raw = await contracts.dstProtocolVault.feeVaultBalance();
    cachedWebsiteGasTreasury = roundTo2(Number(formatUnits(raw, 18)));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(TOKENOMICS_CHANGED_EVENT));
    }
  } catch {
    // ignore — vault may not be deployed yet
  }
}

export function roundTo2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function subscribeTokenomicsChange(listener) {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadTokenomicsState());
  const onStorage = (event) => {
    if (event.key === "walletAddress") handler();
  };
  window.addEventListener(TOKENOMICS_CHANGED_EVENT, handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(TOKENOMICS_CHANGED_EVENT, handler);
    window.removeEventListener("storage", onStorage);
  };
}
