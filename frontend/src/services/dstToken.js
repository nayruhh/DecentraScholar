import { formatUnits, parseUnits } from "ethers";
import {
  getConfiguredContractAddresses,
  getCurrentWalletAddress,
  getReadOnlyContracts,
  getWritableContracts,
  hasConfiguredDstContracts,
} from "./decentraScholarContracts";

const DST_BALANCE_CHANGED_EVENT = "dst:balance-changed";

function emitBalanceChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DST_BALANCE_CHANGED_EVENT));
  }
}

export function hasDstBalanceSupport() {
  return hasConfiguredDstContracts();
}

export async function fetchDstBalance(walletAddress = "") {
  if (!hasConfiguredDstContracts()) return 0;
  const resolvedWallet = walletAddress || (await getCurrentWalletAddress());
  if (!resolvedWallet) return 0;
  const contracts = getReadOnlyContracts();
  if (!contracts?.dstToken) return 0;
  const balance = await contracts.dstToken.balanceOf(resolvedWallet);
  return Number(formatUnits(balance, 18));
}

export async function estimateDstPurchase(dstAmount) {
  const safeAmount = Number(dstAmount || 0);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const contracts = getReadOnlyContracts();
  if (!contracts?.dstTreasury) {
    throw new Error("DST treasury is not configured.");
  }
  const tokenAmount = parseUnits(String(safeAmount), 18);
  const ethCost = await getTreasuryEthCost(contracts.dstTreasury, tokenAmount);
  return {
    tokenAmount,
    ethCostWei: ethCost,
  };
}

export async function estimateDstRedemption(dstAmount) {
  return estimateDstPurchase(dstAmount);
}

export async function buyDst(dstAmount) {
  const safeAmount = Number(dstAmount || 0);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const contracts = await getWritableContracts();
  const tokenAmount = parseUnits(String(safeAmount), 18);
  const ethCost = await getTreasuryEthCost(contracts.dstTreasury, tokenAmount);
  const tx = await contracts.dstTreasury.buy(tokenAmount, { value: ethCost });
  const receipt = await tx.wait();
  emitBalanceChanged();
  return {
    txHash: tx.hash,
    receipt,
    tokenAmount,
    ethCostWei: ethCost.toString(),
  };
}

export async function redeemDst(dstAmount) {
  const safeAmount = Number(dstAmount || 0);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const contracts = await getWritableContracts();
  const wallet = await getCurrentWalletAddress();
  if (!wallet) {
    throw new Error("No connected wallet found. Please connect wallet first.");
  }

  const tokenAmount = parseUnits(String(safeAmount), 18);
  const allowance = await contracts.dstToken.allowance(wallet, contracts.addresses.dstTreasury);
  if (allowance < tokenAmount) {
    const approveTx = await contracts.dstToken.approve(contracts.addresses.dstTreasury, tokenAmount);
    await approveTx.wait();
  }

  const redeemTx = await contracts.dstTreasury.redeem(tokenAmount);
  const receipt = await redeemTx.wait();
  emitBalanceChanged();
  return {
    txHash: redeemTx.hash,
    receipt,
    tokenAmount,
  };
}

export function subscribeDstBalanceChange(listener) {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(DST_BALANCE_CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(DST_BALANCE_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function getDstConfiguredAddresses() {
  const addresses = getConfiguredContractAddresses();
  return {
    dstToken: addresses.dstToken,
    dstTreasury: addresses.dstTreasury,
    rpcUrl: addresses.rpcUrl,
  };
}

async function getTreasuryEthCost(dstTreasury, tokenAmount) {
  try {
    return await dstTreasury.getEthCost(tokenAmount);
  } catch (error) {
    const code = String(error?.code || "");
    if (code !== "BAD_DATA") {
      throw error;
    }

    const weiPerToken = await dstTreasury.weiPerToken();
    return (BigInt(tokenAmount) * BigInt(weiPerToken)) / 10n ** 18n;
  }
}
