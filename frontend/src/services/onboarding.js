import { connectWallet, switchWallet } from "./wallet";
import { refreshWalletBalanceFromChain } from "../pages/dashboard/tabs/tokenomicsStore";
import { loadWalletAddress, saveWalletAddress } from "./browserSession";
import { getWalletIdentity } from "./identityApi";

export async function connectWalletAndContinue({ navigate, setAddress } = {}) {
  return continueAfterWalletSelection({
    address: await connectWallet(),
    navigate,
    setAddress,
  });
}

export async function switchWalletAndContinue({ navigate, setAddress } = {}) {
  const previousAddress = String(loadWalletAddress() || "").trim().toLowerCase();
  const nextAddress = await switchWallet();
  if (previousAddress && previousAddress === String(nextAddress || "").trim().toLowerCase()) {
    throw new Error(
      "MetaMask kept the same account. Import or select a different MetaMask account first, then try Switch Wallet again."
    );
  }
  return continueAfterWalletSelection({
    address: nextAddress,
    navigate,
    setAddress,
  });
}

async function continueAfterWalletSelection({ address, navigate, setAddress } = {}) {
  saveWalletAddress(address);
  setAddress?.(address);
  await refreshWalletBalanceFromChain().catch(() => {});
  const identity = await getWalletIdentity(address).catch(() => ({
    isVerified: false,
  }));
  const isVerified = Boolean(identity?.isVerified);

  if (navigate) {
    navigate(isVerified ? "/dashboard" : "/auth/verify-email");
  }

  return { address, isVerified };
}
