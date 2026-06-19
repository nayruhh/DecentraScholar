import { formatUnits, parseUnits } from "ethers";
import {
  encodePaperIdForContract,
  getCurrentWalletAddress,
  getCoordinatorContracts,
  getReadOnlyContracts,
  getWritableContracts,
  hasConfiguredDstContracts,
} from "./decentraScholarContracts";
import { subscribeDstBalanceChange } from "./dstToken";

export function hasProtocolVaultSupport() {
  return hasConfiguredDstContracts();
}

export async function fetchPaperFunding(paperId) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) {
    return { totalSubmitted: 0, priorityFeesSubmitted: 0, rewardPoolRemaining: 0, feeVaultAccrued: 0 };
  }
  const contracts = getReadOnlyContracts();
  if (!contracts?.dstProtocolVault) {
    return { totalSubmitted: 0, priorityFeesSubmitted: 0, rewardPoolRemaining: 0, feeVaultAccrued: 0 };
  }
  const funding = await contracts.dstProtocolVault.getPaperFunding(encodedPaperId);
  return {
    totalSubmitted: Number(formatUnits(funding.totalSubmitted, 18)),
    priorityFeesSubmitted: Number(formatUnits(funding.priorityFeesSubmitted, 18)),
    rewardPoolRemaining: Number(formatUnits(funding.rewardPoolRemaining, 18)),
    feeVaultAccrued: Number(formatUnits(funding.feeVaultAccrued, 18)),
  };
}

export async function fetchReviewerStake(paperId, reviewerAddress = "") {
  const encodedPaperId = encodePaperIdForContract(paperId);
  const reviewer = reviewerAddress || (await getCurrentWalletAddress());
  if (!encodedPaperId || !reviewer) return { amount: 0, active: false };
  const contracts = getReadOnlyContracts();
  if (!contracts?.dstProtocolVault) return { amount: 0, active: false };
  const stake = await contracts.dstProtocolVault.getReviewerStake(encodedPaperId, reviewer);
  return {
    amount: Number(formatUnits(stake.amount, 18)),
    active: Boolean(stake.active),
  };
}

async function approveIfNeeded(contracts, dstAmount, spenderAddress) {
  const wallet = await getCurrentWalletAddress();
  if (!wallet) {
    throw new Error("No connected wallet found. Please connect wallet first.");
  }
  const tokenAmount = parseUnits(String(dstAmount), 18);
  const balance = await contracts.dstToken.balanceOf(wallet);
  if (balance < tokenAmount) {
    throw new Error(
      `This action requires ${Number(dstAmount).toFixed(2)} DST, but the connected wallet only has ${Number(formatUnits(balance, 18)).toFixed(2)} DST.`
    );
  }
  const allowance = await contracts.dstToken.allowance(wallet, spenderAddress);
  if (allowance < tokenAmount) {
    const approveTx = await contracts.dstToken.approve(spenderAddress, tokenAmount);
    await approveTx.wait();
  }
  return { contracts, tokenAmount };
}

export async function reserveSubmissionFeeOnChain(paperId, dstAmount) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  const safeAmount = Number(dstAmount || 0);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error("Submission fee amount must be greater than zero.");
  }
  const contracts = await getWritableContracts();
  const { tokenAmount } = await approveIfNeeded(
    contracts,
    safeAmount,
    contracts.addresses.dstProtocolVault
  );
  const tx = await contracts.dstProtocolVault.reserveSubmissionFee(encodedPaperId, tokenAmount);
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    receipt,
    tokenAmount,
  };
}

export async function reservePriorityFeeOnChain(paperId, dstAmount) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  const safeAmount = Number(dstAmount || 0);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error("Priority fee amount must be greater than zero.");
  }
  const contracts = await getWritableContracts();
  const { tokenAmount } = await approveIfNeeded(
    contracts,
    safeAmount,
    contracts.addresses.dstProtocolVault
  );
  const tx = await contracts.dstProtocolVault.reservePriorityFee(encodedPaperId, tokenAmount);
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    receipt,
    tokenAmount,
  };
}

export async function lockReviewerStakeOnChain(paperId, dstAmount) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  const safeAmount = Number(dstAmount || 0);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error("Stake amount must be greater than zero.");
  }
  const contracts = await getWritableContracts();
  const { tokenAmount } = await approveIfNeeded(
    contracts,
    safeAmount,
    contracts.addresses.dstProtocolVault
  );
  const tx = await contracts.dstProtocolVault.lockReviewerStake(encodedPaperId, tokenAmount);
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    receipt,
    tokenAmount,
  };
}

export async function settleReviewerOnChain(paperId, reviewerAddress, rewardAmount, slashedAmount) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  if (!reviewerAddress) throw new Error("Reviewer address is required.");

  // settleReviewer is onlyCoordinator — use the dev coordinator wallet, not MetaMask.
  const { dstProtocolVault } = getCoordinatorContracts();

  // Check whether this reviewer actually has an on-chain stake. If not (e.g. the
  // staking step was skipped or failed), skip settlement rather than reverting.
  const stake = await dstProtocolVault.getReviewerStake(encodedPaperId, reviewerAddress);
  if (!stake.active) {
    return { txHash: null, receipt: null, skipped: true };
  }

  const reward = parseUnits(String(Number(rewardAmount || 0)), 18);
  const slash = parseUnits(String(Number(slashedAmount || 0)), 18);
  const tx = await dstProtocolVault.settleReviewer(
    encodedPaperId,
    reviewerAddress,
    reward,
    slash
  );
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    receipt,
  };
}

export async function isConnectedWalletProtocolCoordinator() {
  const contracts = await getWritableContracts();
  const wallet = await getCurrentWalletAddress();
  if (!wallet) return false;
  const owner = String(await contracts.dstProtocolVault.owner()).toLowerCase();
  if (owner === wallet.toLowerCase()) return true;
  return Boolean(await contracts.dstProtocolVault.coordinators(wallet));
}
export function subscribeProtocolBalanceRefresh(listener) {
  return subscribeDstBalanceChange(listener);
}
