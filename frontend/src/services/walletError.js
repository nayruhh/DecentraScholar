export function formatWalletActionError(error, fallbackMessage = "Transaction failed.") {
  const message = String(error?.message || error || "").trim();
  const code = String(error?.code || "");

  if (
    code === "ACTION_REJECTED" ||
    code === "4001" ||
    message.includes("User denied transaction signature") ||
    message.includes("ethers-user-denied") ||
    message.includes('reason="rejected"')
  ) {
    return "Transaction cancelled in MetaMask.";
  }

  if (message.includes("wallet_requestPermissions")) {
    return "Wallet selection was cancelled in MetaMask.";
  }

  if (message.includes("not enough ETH in your account to pay for network fees")) {
    return "The connected wallet does not have enough ETH to pay for network fees.";
  }

  if (message.includes("insufficient funds")) {
    return "The connected wallet does not have enough funds to complete this transaction.";
  }

  if (
    code === "CALL_EXCEPTION" ||
    message.includes("missing revert data") ||
    message.includes("CALL_EXCEPTION")
  ) {
    return "The smart contract rejected this transaction. The review session may not exist on-chain (this can happen after a local network reset). Please restart the node without --reset and try again.";
  }

  return message || fallbackMessage;
}
