import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Clock3, Coins, Copy, FileText, Mail, TrendingUp } from "lucide-react";
import { getWalletAddress, truncateAddress } from "../utils";
import { useWallet } from "../../../context/WalletContext";
import {
  loadTokenomicsState,
  refreshVaultStateFromChain,
  refreshWalletBalanceFromChain,
  subscribeTokenomicsChange,
} from "./tokenomicsStore";
import { getWalletReputation } from "./reputationStore";
import {
  buyDst,
  estimateDstPurchase,
  redeemDst,
} from "../../../services/dstToken";
import { formatWalletActionError } from "../../../services/walletError";
import {
  appendAuditEvent,
  clearAuditEvents,
  loadAuditEvents,
  subscribeAuditLog,
} from "./auditLogStore";
import { switchWalletAndContinue } from "../../../services/onboarding";
import {
  getWalletIdentity,
  resetOtpSession,
  resetWalletIdentity,
} from "../../../services/identityApi";
import TabHeader from "../../../components/feedback/TabHeader";
import TabState from "../../../components/feedback/TabState";
import { useToast } from "../../../components/feedback/ToastProvider";

export default function ProfileTab({ isLoading = false, error = "" }) {
  const navigate = useNavigate();
  const { setAddress } = useWallet();
  const { showToast } = useToast();
  const wallet = getWalletAddress();
  const isWalletVerified = Boolean(wallet);
  const [walletIdentity, setWalletIdentity] = useState({
    walletAddress: "",
    email: "",
    verifiedAt: null,
    isVerified: false,
  });
  const isEmailVerified = Boolean(walletIdentity?.isVerified);
  const [tokenomicsState, setTokenomicsState] = useState(() => loadTokenomicsState());
  const [amountInput, setAmountInput] = useState("25");
  const [walletActionMessage, setWalletActionMessage] = useState("");
  const [walletActionType, setWalletActionType] = useState("idle");
  const [topUpFeeEstimate, setTopUpFeeEstimate] = useState(null);
  const [topUpFeeEstimateError, setTopUpFeeEstimateError] = useState("");
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [auditEvents, setAuditEvents] = useState(() => loadAuditEvents(wallet));
  const [showAllAuditEvents, setShowAllAuditEvents] = useState(false);
  const walletBalance = tokenomicsState.walletBalance;
  const reputation = getWalletReputation(wallet);
  const activityReviews = reputation.reviewerStats.total;
  const onTimeRate =
    reputation.reviewerStats.total > 0
      ? Math.round((reputation.reviewerStats.onTime / reputation.reviewerStats.total) * 100)
      : 0;
  const reputationScore = reputation.trustScore;
  const reputationTrend = Math.max(-20, Math.min(20, Math.round((reputation.reviewerRep - 50) / 4)));

  useEffect(() => subscribeTokenomicsChange(setTokenomicsState), []);
  useEffect(() => {
    if (!wallet) return;
    refreshWalletBalanceFromChain().then((balance) => {
      setTokenomicsState((prev) => ({ ...prev, walletBalance: balance }));
    }).catch(() => {});
    refreshVaultStateFromChain().catch(() => {});
  }, [wallet]);
  useEffect(() => {
    setAuditEvents(loadAuditEvents(wallet));
    return subscribeAuditLog(wallet, setAuditEvents);
  }, [wallet]);
  useEffect(() => {
    let cancelled = false;
    async function loadIdentity() {
      if (!wallet) {
        if (!cancelled) {
          setWalletIdentity({
            walletAddress: "",
            email: "",
            verifiedAt: null,
            isVerified: false,
          });
        }
        return;
      }
      try {
        const identity = await getWalletIdentity(wallet);
        if (!cancelled) setWalletIdentity(identity);
      } catch {
        if (!cancelled) {
          setWalletIdentity({
            walletAddress: wallet,
            email: "",
            verifiedAt: null,
            isVerified: false,
          });
        }
      }
    }
    loadIdentity();
    return () => {
      cancelled = true;
    };
  }, [wallet]);
  useEffect(() => {
    let cancelled = false;

    async function loadFeeEstimate() {
      if (!wallet) {
        if (!cancelled) {
          setTopUpFeeEstimate(null);
          setTopUpFeeEstimateError("");
        }
        return;
      }

      const dstAmount = Number(amountInput);
      if (!Number.isFinite(dstAmount) || dstAmount <= 0) {
        if (!cancelled) {
          setTopUpFeeEstimate(null);
          setTopUpFeeEstimateError("");
        }
        return;
      }

      try {
        const estimate = await estimateDstPurchase(dstAmount);
        if (!cancelled) {
          setTopUpFeeEstimate(estimate);
          setTopUpFeeEstimateError("");
        }
      } catch (error) {
        if (!cancelled) {
          setTopUpFeeEstimate(null);
          setTopUpFeeEstimateError(String(error?.message || "Unable to estimate network fee."));
        }
      }
    }

    loadFeeEstimate();
    return () => {
      cancelled = true;
    };
  }, [amountInput, wallet]);

  const parseAmount = () => Number(amountInput);

  const handleTopUp = async () => {
    if (!wallet) {
      setWalletActionType("error");
      setWalletActionMessage("Connect a wallet before topping up.");
      return;
    }

    const dstAmount = parseAmount();
    if (!Number.isFinite(dstAmount) || dstAmount <= 0) {
      setWalletActionType("error");
      setWalletActionMessage("Enter a valid top-up amount greater than 0.");
      return;
    }

    try {
      appendAuditEvent(wallet, {
        eventType: "topup",
        status: "pending_payment",
        amountDst: roundTo2(dstAmount),
      });
      const payment = await buyDst(dstAmount);
      const nextBalance = await refreshWalletBalanceFromChain();
      setTokenomicsState((prev) => ({ ...prev, walletBalance: nextBalance }));
      appendAuditEvent(wallet, {
        eventType: "topup",
        status: "payment_confirmed",
        amountDst: roundTo2(dstAmount),
        nativeValueWei: payment.ethCostWei,
        txHash: payment.txHash,
      });
      setWalletActionType("idle");
      setWalletActionMessage("");
      showToast(
        `Wallet topped up by ${Number(amountInput).toFixed(2)} DST. ETH paid to treasury: ${formatNativeAmount(payment.ethCostWei)} ETH.`
      );
    } catch (error) {
      setWalletActionType("error");
      setWalletActionMessage(formatWalletActionError(error, "Top-up payment failed."));
      appendAuditEvent(wallet, {
        eventType: "topup",
        status: "failed_payment",
        amountDst: roundTo2(dstAmount),
      });
    }
  };

  const handleWithdraw = async () => {
    const amount = parseAmount();
    if (!Number.isFinite(amount) || amount <= 0) {
      setWalletActionType("error");
      setWalletActionMessage("Enter a valid withdrawal amount greater than 0.");
      appendAuditEvent(wallet, {
        eventType: "withdraw",
        status: "failed_validation",
        amountDst: roundTo2(amount),
        reason: "invalid_amount",
      });
      return;
    }
    if (amount > walletBalance) {
      setWalletActionType("error");
      setWalletActionMessage("Insufficient wallet balance for this withdrawal.");
      appendAuditEvent(wallet, {
        eventType: "withdraw",
        status: "failed_validation",
        amountDst: roundTo2(amount),
        reason: "insufficient_funds",
      });
      return;
    }

    try {
      const result = await redeemDst(amount);
      const nextBalance = await refreshWalletBalanceFromChain();
      setTokenomicsState((prev) => ({ ...prev, walletBalance: nextBalance }));
      appendAuditEvent(wallet, {
        eventType: "withdraw",
        status: "success",
        amountDst: roundTo2(amount),
        txHash: result.txHash,
        balanceAfterDst: roundTo2(nextBalance),
      });
      setWalletActionType("idle");
      setWalletActionMessage("");
      showToast(`Redeemed ${Number(amountInput).toFixed(2)} DST back to ETH.`);
    } catch (error) {
      setWalletActionType("error");
      setWalletActionMessage(formatWalletActionError(error, "Redeem transaction failed."));
      appendAuditEvent(wallet, {
        eventType: "withdraw",
        status: "failed_transaction",
        amountDst: roundTo2(amount),
      });
    }
  };

  const visibleAuditEvents = showAllAuditEvents ? auditEvents : auditEvents.slice(0, 3);

  const handleCopyWallet = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 1200);
    } catch {
      // no-op for browsers that block clipboard in demo mode
    }
  };

  const handleChangeEmail = async () => {
    if (!wallet) return;
    try {
      await resetOtpSession(wallet);
      await resetWalletIdentity(wallet);
      setWalletIdentity({
        walletAddress: wallet,
        email: "",
        verifiedAt: null,
        isVerified: false,
      });
      navigate("/auth/verify-email", {
        state: {
          resetVerificationFlow: true,
        },
      });
    } catch (error) {
      showToast(formatWalletActionError(error, "Could not reset email verification."));
    }
  };

  const handleSwitchWallet = async () => {
    setWalletActionType("idle");
    setWalletActionMessage("");
    try {
      await switchWalletAndContinue({ navigate, setAddress });
    } catch (error) {
      setWalletActionType("error");
      setWalletActionMessage(formatWalletActionError(error, "Failed to switch MetaMask account."));
    }
  };

  const handleClearAuditLog = () => {
    clearAuditEvents(wallet);
    setShowAllAuditEvents(false);
    showToast("Security audit log cleared.");
  };

  if (isLoading) {
    return <TabState type="loading" title="Loading profile" description="Fetching wallet and activity details." />;
  }

  if (error) {
    return <TabState type="error" title="Could not load profile" description={error} />;
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Profile" subtitle="Wallet, activity, and token balance" />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="rounded-2xl border border-[#dcdfea] bg-white p-6 md:col-span-6">
            <div className="text-lg font-semibold text-[#111322]">Wallet Address</div>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ece7f8] text-base font-bold text-[#6828ce]">
                {wallet ? wallet.slice(2, 4).toUpperCase() : "NA"}
              </div>
              <div className="font-mono text-sm text-[#111322]">
                {wallet ? truncateAddress(wallet) : "(not connected)"}
              </div>
              <button
                type="button"
                onClick={handleCopyWallet}
                className="rounded-lg p-2 text-[#6b7189] hover:bg-[#f2f3f8]"
                aria-label="Copy wallet address"
              >
                <Copy className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 flex items-center gap-3 text-sm">
              <span className="font-mono text-[#6b7189]">{wallet ? wallet.slice(2, 8) : "000000"}</span>
              <span className="rounded-full bg-[#e5f6e9] px-3 py-1 font-semibold text-[#10a452]">
                {isWalletVerified ? "Verified" : "Not verified"}
              </span>
              {copiedWallet ? <span className="text-[#6828ce]">Copied</span> : null}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-[#6b5d78]">
              <Mail className="h-4 w-4 text-[#6828ce]" />
              <span>Email verification: {isEmailVerified ? "Verified" : "Not verified"}</span>
              <button
                type="button"
                onClick={handleSwitchWallet}
                className="ml-2 rounded-md border border-[#d7d9e3] bg-white px-2 py-1 text-xs font-semibold text-[#111322] hover:bg-[#f4f4f8]"
              >
                Switch Wallet
              </button>
              <button
                type="button"
                onClick={handleChangeEmail}
                className="rounded-md border border-[#d7d9e3] bg-white px-2 py-1 text-xs font-semibold text-[#111322] hover:bg-[#f4f4f8]"
              >
                Change Email
              </button>
            </div>
            <div className="mt-2 text-xs text-[#6b7189]">
              <span>
                Current email: {walletIdentity?.email || "No email linked yet"}
              </span>
              <span className="ml-2">
                Change is allowed only if the new email is not already linked to another wallet.
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#dcdfea] bg-white p-6 md:col-span-6">
            <div className="text-lg font-semibold text-[#111322]">Token Balance</div>
            <div className="mt-4 flex items-center gap-3">
              <Coins className="h-8 w-8 text-[#6828ce]" />
              <div className="text-4xl font-bold leading-none text-[#111322]">
                {Math.floor(Number(walletBalance || 0))}
              </div>
              <div className="mt-2 text-lg text-[#6b7189]">DST</div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_140px_140px]">
              <input
                type="number"
                min="0"
                step="0.5"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setWalletActionType("idle");
                  setWalletActionMessage("");
                }}
                className="min-w-0 rounded-lg border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none sm:col-span-2 lg:col-span-1"
                placeholder="Amount in DST"
              />
              <button
                type="button"
                onClick={handleTopUp}
                className="w-full whitespace-nowrap rounded-lg border border-[#d7d9e3] bg-white px-5 py-3 text-sm font-semibold text-[#111322] hover:bg-[#f4f4f8]"
              >
                Top Up
              </button>
              <button
                type="button"
                onClick={handleWithdraw}
                className="w-full whitespace-nowrap rounded-lg bg-[#6828ce] px-5 py-3 text-sm font-semibold text-white hover:bg-[#5a24b4]"
              >
                Withdraw
              </button>
            </div>
            <div className="mt-3 text-xs text-[#6b7189]">
              DST balance is now read from the on-chain DST token contract on the connected network.
            </div>
            <div className="mt-2 rounded-lg border border-[#e7e8ef] bg-[#fafafe] px-4 py-3 text-xs text-[#5f657d]">
              <div className="font-semibold text-[#111322]">Network fee disclosure</div>
              <div className="mt-1">
                Top-up buys DST from the treasury contract with ETH. MetaMask will charge native ETH for both the treasury payment and the network gas.
              </div>
              {topUpFeeEstimate ? (
                <div className="mt-1">
                  Treasury payment for this top-up: <span className="font-semibold text-[#111322]">{formatNativeAmount(topUpFeeEstimate.ethCostWei)} ETH</span>
                </div>
              ) : null}
              {topUpFeeEstimateError ? (
                <div className="mt-1 text-[#8a3d3d]">
                  Fee estimate unavailable: {topUpFeeEstimateError}
                </div>
              ) : null}
              <div className="mt-1">
                Redeem sends a real on-chain transaction too. MetaMask will ask you to approve DST spending if needed, and gas is charged for the approval/redeem transactions.
              </div>
            </div>
            {walletActionType !== "idle" ? (
              <div
                className={[
                  "mt-3 rounded-lg px-4 py-3 text-sm",
                  walletActionType === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800",
                ].join(" ")}
              >
                {walletActionMessage}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[#dcdfea] bg-white p-6 md:col-span-4">
            <div className="text-base text-[#5f657d]">Reputation</div>
            <div className="mt-4 flex items-center justify-center">
              <div
                className="flex h-28 w-28 items-center justify-center rounded-full text-2xl font-bold text-[#111322]"
                style={{
                  background: `conic-gradient(#6828ce ${reputationScore}%, #ececf1 0)`,
                }}
              >
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white text-3xl font-bold text-[#111322]">
                  {reputationScore}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#dcdfea] bg-white p-6 md:col-span-4">
            <div className="text-base text-[#5f657d]">Activity</div>
            <div className="mt-5 grid gap-4 text-base text-[#111322]">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="h-6 w-6 text-[#6828ce]" />
                <span className="text-[#5f657d]">Reviews:</span>
                <span className="font-semibold">{activityReviews}</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock3 className="h-6 w-6 text-[#6828ce]" />
                <span className="text-[#5f657d]">On-time:</span>
                <span className="font-semibold">{onTimeRate}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="h-6 w-6 rounded-full bg-[#ece7f8] text-center text-xs font-bold leading-6 text-[#6828ce]">
                  R
                </span>
                <span className="text-[#5f657d]">Reviewer Reputation:</span>
                <span className="font-semibold">{reputation.reviewerRep}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#dcdfea] bg-white p-6 md:col-span-4">
            <div className="text-base text-[#5f657d]">Trends</div>
            <div className="mt-6 inline-flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-[#6828ce]" />
              <span className="text-3xl font-bold text-[#111322]">
                {reputationTrend >= 0 ? "+" : ""}
                {reputationTrend}%
              </span>
            </div>
            <div className="mt-2 text-base text-[#5f657d]">reputation this month</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-[#dcdfea] bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold text-[#111322]">Security Audit Log</div>
              <div className="mt-2 text-sm text-[#6b7189]">
                Tracks critical actions: stake, vote, publish, and withdraw.
              </div>
            </div>
            <button
              type="button"
              onClick={handleClearAuditLog}
              disabled={auditEvents.length === 0}
              className="rounded-lg border border-[#d7d9e3] bg-white px-4 py-2 text-sm font-semibold text-[#111322] hover:bg-[#f4f4f8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Audit Log
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {visibleAuditEvents.map((event) => (
              <div
                key={event.id}
                className="flex flex-col gap-2 rounded-lg border border-[#ececf1] bg-[#fafafe] px-3 py-3 text-sm md:flex-row md:flex-wrap md:items-center md:gap-3"
              >
                <span className="min-w-[130px] font-semibold text-[#111322]">
                  {String(event.eventType || "unknown").toUpperCase()}
                </span>
                <span className="min-w-[150px] break-words text-[#5f657d]">
                  {String(event.status || "unknown")}
                </span>
                <span className="text-[#5f657d] md:ml-auto">
                  {formatAuditTimestamp(event.timestamp)}
                </span>
              </div>
            ))}
            {auditEvents.length === 0 ? <TabState type="empty" title="No audit entries yet" className="rounded-lg p-6" /> : null}
            {auditEvents.length > 3 ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAllAuditEvents((prev) => !prev)}
                  className="text-sm font-semibold text-[#6828ce] hover:text-[#5a24b4]"
                >
                  {showAllAuditEvents ? "View less" : `View more (${auditEvents.length - 3} older logs)`}
                </button>
              </div>
            ) : null}
          </div>
        </div>
 
    </div>
  );
}

function normalizeFirstLastName(rawName) {
  const parts = (rawName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function roundTo2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatNativeAmount(valueWei) {
  const safe = Number(valueWei || 0) / 1e18;
  if (!Number.isFinite(safe)) return "0.000000";
  return safe.toFixed(6);
}

function formatAuditTimestamp(value) {
  const ts = new Date(value);
  if (!Number.isFinite(ts.getTime())) return "-";
  return ts.toLocaleString();
}
