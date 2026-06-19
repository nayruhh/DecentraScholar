import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Inbox, LayoutGrid, LogOut, Search, Upload } from "lucide-react";
import {
  loadTokenomicsState,
  refreshWalletBalanceFromChain,
  subscribeTokenomicsChange,
} from "../tabs/tokenomicsStore";
import { useWallet } from "../../../context/WalletContext";
import {
  clearWalletAddress,
  loadWalletAddress,
  subscribeBrowserSession,
} from "../../../services/browserSession";
import { getMyAssignments } from "../../../services/reviewerAssignmentApi";

const SEEN_TS_KEY = "reviewerAssignmentsSeenAt";

const navItems = [
  { id: "browse", label: "Browse Papers", to: "/browse-papers", icon: Search },
  { id: "reviewer", label: "Reviewer Workspace", to: "/review-workspace", icon: Inbox },
  { id: "author", label: "Author Workspace", to: "/author-workspace?tab=upload", icon: Upload },
  { id: "dashboard", label: "Dashboard", to: "/dashboard?tab=library", icon: LayoutGrid },
];

export default function AppShell({
  activeNav = "browse",
  pageTitle,
  pageSubtitle,
  tokenBalance = 0,
  walletLabel = "",
  initials = "",
  children,
}) {
  const navigate = useNavigate();
  const { address, setAddress } = useWallet();
  const [sharedWalletBalance, setSharedWalletBalance] = useState(
    () => loadTokenomicsState().walletBalance
  );
  const [sessionWalletAddress, setSessionWalletAddress] = useState(
    () => loadWalletAddress() || address || ""
  );
  const [pendingAssignmentCount, setPendingAssignmentCount] = useState(0);
  const pollingRef = useRef(null);

  useEffect(() => {
    setSharedWalletBalance(loadTokenomicsState().walletBalance);
    refreshWalletBalanceFromChain()
      .then((balance) => setSharedWalletBalance(balance))
      .catch(() => {});
    return subscribeTokenomicsChange((nextState) => {
      setSharedWalletBalance(nextState.walletBalance);
    });
  }, []);

  useEffect(() => {
    return subscribeBrowserSession(({ walletAddress }) => {
      setSessionWalletAddress(walletAddress || "");
    });
  }, []);

  useEffect(() => {
    if (address) {
      setSessionWalletAddress(address);
    }
  }, [address]);

  // Poll for pending assignments and compute unseen count.
  useEffect(() => {
    const wallet = sessionWalletAddress;
    if (!wallet) {
      setPendingAssignmentCount(0);
      return;
    }

    function checkAssignments() {
      const seenAt = Number(localStorage.getItem(SEEN_TS_KEY) || 0);
      getMyAssignments(wallet)
        .then(({ assignments = [] }) => {
          const unseen = assignments.filter(
            (a) => a.status === "pending" && a.assignedAt > seenAt
          ).length;
          setPendingAssignmentCount(unseen);
        })
        .catch(() => {});
    }

    checkAssignments();
    pollingRef.current = setInterval(checkAssignments, 30 * 1000);
    return () => clearInterval(pollingRef.current);
  }, [sessionWalletAddress]);

  // When on the reviewer workspace page, mark all current assignments as seen.
  useEffect(() => {
    if (activeNav === "reviewer") {
      localStorage.setItem(SEEN_TS_KEY, String(Date.now()));
      setPendingAssignmentCount(0);
    }
  }, [activeNav]);

  const displayWalletBalance =
    typeof sharedWalletBalance === "number" ? sharedWalletBalance : tokenBalance;
  const resolvedWalletLabel =
    walletLabel ||
    (sessionWalletAddress
      ? `${sessionWalletAddress.slice(0, 6)}...${sessionWalletAddress.slice(-4)}`
      : "0x0000...0000");
  const resolvedInitials =
    initials ||
    (sessionWalletAddress
      ? sessionWalletAddress.slice(2, 4).toUpperCase()
      : "NA");

  const handleWebsiteLogout = () => {
    clearWalletAddress();
    setAddress(null);
    setSessionWalletAddress("");
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#111322]">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[300px] overflow-y-auto border-r border-[#e5e6ec] bg-[#f7f7fa] p-5 md:block">
          <div className="text-2xl font-extrabold tracking-tight text-[#0f1220]">
            Decentra<span className="text-[#6828ce]">Scholar</span>
          </div>

          <div className="mt-14 text-base font-medium text-[#5f6273]">Navigation</div>
          <nav className="mt-4 space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              const showBadge = item.id === "reviewer" && pendingAssignmentCount > 0;
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  className={[
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-lg transition",
                    active
                      ? "bg-[#ebe7f7] font-medium text-[#5f2acc]"
                      : "text-[#2f3346] hover:bg-[#efeff4]",
                  ].join(" ")}
                >
                  <span className="relative shrink-0">
                    <Icon className="h-4 w-4" />
                    {showBadge ? (
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#dc2626] text-[9px] font-bold text-white leading-none">
                        {pendingAssignmentCount > 9 ? "9+" : pendingAssignmentCount}
                      </span>
                    ) : null}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center justify-end gap-4 border-b border-[#e5e6ec] bg-[#f5f5f7]/95 px-8 py-3 backdrop-blur">
            <button
              type="button"
              onClick={handleWebsiteLogout}
              className="inline-flex items-center gap-2 rounded-full border border-[#d7d9e3] bg-white px-4 py-2 text-sm font-semibold text-[#111322] transition hover:bg-[#f4f4f8]"
            >
              <LogOut className="h-4 w-4" />
              Log Out
            </button>
            <div className="rounded-full bg-[#efedf7] px-3 py-1 text-sm font-semibold text-[#1d2032]">
              {Number(displayWalletBalance || 0).toFixed(2)} DST
            </div>
            <div className="rounded-full bg-[#efeff4] px-4 py-1.5 text-sm text-[#555a73]">
              {resolvedWalletLabel}
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dcd1f9] text-sm font-semibold text-[#5f2acc]">
              {resolvedInitials}
            </div>
          </header>

          <section className="px-6 py-8 md:px-9">
            <h1 className="text-4xl font-extrabold tracking-tight text-[#111322]">{pageTitle}</h1>
            {pageSubtitle ? <p className="mt-2 text-lg text-[#656b84]">{pageSubtitle}</p> : null}
            <div className="mt-7">{children}</div>
          </section>
        </main>
      </div>
    </div>
  );
}
