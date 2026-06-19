import { ExternalLink, Wallet } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../../context/WalletContext";
import PageTransition from "../../components/PageTransition";
import {
  connectWalletAndContinue,
  switchWalletAndContinue,
} from "../../services/onboarding";
import AuthStepShell from "./AuthStepShell";

export default function ConnectWallet() {
  const navigate = useNavigate();
  const { setAddress } = useWallet();
  const [status, setStatus] = useState({ type: "idle", msg: "" });
  const [isConnecting, setIsConnecting] = useState(false);

  const runWalletFlow = async (mode = "connect") => {
    if (isConnecting) return;

    setIsConnecting(true);
    setStatus({
      type: "info",
      msg:
        mode === "switch"
          ? "Waiting for MetaMask. Choose the wallet account you want to use in the extension popup."
          : "Waiting for MetaMask. Approve the connection request in the extension popup.",
    });

    try {
      if (mode === "switch") {
        await switchWalletAndContinue({ navigate, setAddress });
      } else {
        await connectWalletAndContinue({ navigate, setAddress });
      }
    } catch (e) {
      setStatus({
        type: "error",
        msg:
          e?.message ||
          (mode === "switch"
            ? "Failed to switch MetaMask account."
            : "Failed to connect MetaMask."),
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnect = async () => runWalletFlow("connect");
  const handleSwitchWallet = async () => runWalletFlow("switch");

  return (
    <PageTransition>
      <AuthStepShell step={1}>
        <div className="mx-auto max-w-xl rounded-2xl border border-[#d9dbe5] bg-[#f7f7fa] p-7">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-[#e9e2f7]">
            <Wallet className="h-10 w-10 text-[#652ed1]" />
          </div>

          <h1 className="mt-7 text-center text-3xl font-semibold text-[#111322]">
            Connect Your Wallet
          </h1>
          <p className="mx-auto mt-3 max-w-md text-center text-base text-[#5f657d]">
            Connect your MetaMask wallet to get started with DecentraScholar.
          </p>

          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            className="mt-7 w-full rounded-xl bg-[#652ed1] py-3 text-base font-semibold text-white transition hover:bg-[#5928b8] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isConnecting ? "Waiting for MetaMask..." : "Connect MetaMask"}
          </button>
          <button
            type="button"
            onClick={handleSwitchWallet}
            disabled={isConnecting}
            className="mt-3 w-full rounded-xl border border-[#d6d8e3] bg-white py-3 text-base font-semibold text-[#111322] transition hover:bg-[#efeff4] disabled:cursor-not-allowed disabled:opacity-70"
          >
            Switch Wallet
          </button>

          {status.type !== "idle" ? (
            <div
              className={[
                "mt-4 rounded-xl px-4 py-3 text-sm",
                status.type === "error" ? "bg-red-50 text-red-800" : "",
                status.type === "info" ? "bg-purple-50 text-purple-800" : "",
              ].join(" ")}
            >
              {status.msg}
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl bg-[#ececf1] p-5">
            <div className="text-2xl font-semibold text-[#111322]">
              Don't have MetaMask?
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#5f657d]">
              MetaMask is a browser extension that lets you interact with
              decentralised applications.
            </p>
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-base font-medium text-[#652ed1] hover:underline"
            >
              Install MetaMask
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </AuthStepShell>
    </PageTransition>
  );
}
