import { BrowserProvider, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { getMetaMaskProvider } from "./injectedWallet";

function getEip1193Provider() {
  return getMetaMaskProvider();
}

export async function connectWallet() {
  const provider = getEip1193Provider();
  if (!provider) {
    throw new Error("MetaMask not detected. Please install MetaMask.");
  }

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = accounts?.[0];
  if (!address) {
    throw new Error("No accounts returned from wallet.");
  }

  return getAddress(address);
}

export async function switchWallet() {
  const provider = getEip1193Provider();
  if (!provider) {
    throw new Error("MetaMask not detected. Please install MetaMask.");
  }

  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (error) {
    const text = String(error?.message || error || "");
    if (text.toLowerCase().includes("user rejected")) {
      throw new Error("Wallet switch request was rejected.");
    }
    throw new Error("Failed to open the MetaMask account selector.");
  }

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = accounts?.[0];
  if (!address) {
    throw new Error("No accounts returned from wallet.");
  }

  return getAddress(address);
}

export async function requestWalletSignature({ action, message, walletAddress }) {
  const provider = getEip1193Provider();
  if (!provider) {
    throw new Error("MetaMask not detected. Cannot sign this action.");
  }
  if (!walletAddress) {
    throw new Error("No connected wallet found. Please connect wallet first.");
  }
  const normalizedAddress = getAddress(walletAddress || "");
  const challenge = [
    "DecentraScholar Security Challenge",
    `Action: ${String(action || "unknown_action")}`,
    `Wallet: ${normalizedAddress}`,
    `Nonce: ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    `Message: ${String(message || "Authorize this action")}`,
  ].join("\n");

  try {
    const signature = await provider.request({
      method: "personal_sign",
      params: [challenge, normalizedAddress],
    });
    if (!signature) {
      throw new Error("Empty signature returned by wallet.");
    }
    return {
      challenge,
      challengeHash: keccak256(toUtf8Bytes(challenge)),
      signature,
      signer: normalizedAddress,
    };
  } catch (error) {
    const text = String(error?.message || error || "");
    if (text.toLowerCase().includes("user rejected")) {
      throw new Error("Signature request was rejected.");
    }
    throw new Error("Failed to verify wallet signature.");
  }
}

export async function estimateNativeTransferFee({ walletAddress, to, valueWei }) {
  const provider = getEip1193Provider();
  if (!provider) {
    throw new Error("MetaMask not detected. Cannot estimate payment fee.");
  }
  if (!walletAddress) {
    throw new Error("No connected wallet found. Please connect wallet first.");
  }
  if (!to) {
    throw new Error("Treasury wallet is not configured.");
  }

  const normalizedFrom = getAddress(walletAddress);
  const normalizedTo = getAddress(to);
  const safeValueWei = BigInt(valueWei || 0);
  if (safeValueWei <= 0n) {
    throw new Error("Payment amount must be greater than zero.");
  }

  await provider.request({ method: "eth_requestAccounts" });
  const browserProvider = new BrowserProvider(provider);
  const signer = await browserProvider.getSigner();
  const signerAddress = getAddress(await signer.getAddress());

  if (signerAddress !== normalizedFrom) {
    throw new Error("MetaMask is connected to a different wallet than the active profile.");
  }

  const [gasEstimate, feeData] = await Promise.all([
    signer.estimateGas({
      to: normalizedTo,
      value: safeValueWei,
    }),
    browserProvider.getFeeData(),
  ]);

  const gasPriceWei =
    BigInt(feeData.gasPrice || feeData.maxFeePerGas || 0n);

  return {
    gasEstimate: gasEstimate.toString(),
    gasPriceWei: gasPriceWei.toString(),
    estimatedFeeWei: (gasEstimate * gasPriceWei).toString(),
  };
}

export async function sendNativeTransfer({ walletAddress, to, valueWei }) {
  const provider = getEip1193Provider();
  if (!provider) {
    throw new Error("MetaMask not detected. Cannot send payment.");
  }
  if (!walletAddress) {
    throw new Error("No connected wallet found. Please connect wallet first.");
  }
  if (!to) {
    throw new Error("Treasury wallet is not configured.");
  }

  const normalizedFrom = getAddress(walletAddress);
  const normalizedTo = getAddress(to);
  const safeValueWei = BigInt(valueWei || 0);
  if (safeValueWei <= 0n) {
    throw new Error("Payment amount must be greater than zero.");
  }

  await provider.request({ method: "eth_requestAccounts" });
  const browserProvider = new BrowserProvider(provider);
  const signer = await browserProvider.getSigner();
  const signerAddress = getAddress(await signer.getAddress());

  if (signerAddress !== normalizedFrom) {
    throw new Error("MetaMask is connected to a different wallet than the active profile.");
  }

  try {
    const tx = await signer.sendTransaction({
      to: normalizedTo,
      value: safeValueWei,
    });
    const receipt = await tx.wait();
    const gasUsed = BigInt(receipt?.gasUsed || 0n);
    const gasPriceWei = BigInt(
      receipt?.gasPrice || receipt?.effectiveGasPrice || tx.gasPrice || 0n
    );
    return {
      hash: tx.hash,
      receipt,
      from: normalizedFrom,
      to: normalizedTo,
      valueWei: safeValueWei.toString(),
      gasUsed: gasUsed.toString(),
      gasPriceWei: gasPriceWei.toString(),
      gasPaidWei: (gasUsed * gasPriceWei).toString(),
    };
  } catch (error) {
    const text = String(error?.message || error || "");
    if (text.toLowerCase().includes("user rejected")) {
      throw new Error("Payment request was rejected.");
    }
    throw new Error("Failed to send payment from the connected wallet.");
  }
}
