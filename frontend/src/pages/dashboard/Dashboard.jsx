import { useEffect, useState } from "react";
import { BookOpen, User } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PageTransition from "../../components/PageTransition";
import AppShell from "./components/AppShell";
import LibraryTab from "./tabs/LibraryTab";
import ProfileTab from "./tabs/ProfileTab";
import { refreshWalletBalanceFromChain } from "./tabs/tokenomicsStore";
import {
  loadPublishedPapers,
  refreshPublishedPapers,
  subscribePaperChanges,
} from "./tabs/paperStore";

const validTabs = new Set(["library", "profile"]);

export default function Dashboard() {
  const [walletBalance, setWalletBalance] = useState(0);
  useEffect(() => {
    refreshWalletBalanceFromChain().then(setWalletBalance).catch(() => {});
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get("tab");
  const tab = validTabs.has(queryTab) ? queryTab : "library";

  const handleTabChange = (nextTab) => {
    setSearchParams({ tab: nextTab });
  };

  const tabClass = (isActive) =>
    [
      "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition shadow-sm",
      isActive
        ? "bg-[#6828ce] text-white hover:bg-[#5a24b4]"
        : "bg-white text-[#6828ce] hover:bg-[#f3ecff]",
    ].join(" ");

  const [savedPapers, setSavedPapers] = useState(() => loadPublishedPapers());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = subscribePaperChanges(setSavedPapers);
    refreshPublishedPapers()
      .then(() => setError(""))
      .catch(() => setError("Could not load library papers from the configured contracts."))
      .finally(() => setIsLoading(false));
    return unsubscribe;
  }, []);

  return (
    <PageTransition>
      <AppShell
        activeNav="dashboard"
        pageTitle="Dashboard"
        pageSubtitle="Access your library and profile."
        tokenBalance={walletBalance}
      >
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => handleTabChange("library")} className={tabClass(tab === "library")}>
            <BookOpen className="h-4 w-4" />
            My library
          </button>
          <button type="button" onClick={() => handleTabChange("profile")} className={tabClass(tab === "profile")}>
            <User className="h-4 w-4" />
            My profile
          </button>
        </div>

        {tab === "library" && (
          <LibraryTab savedPapers={savedPapers} isLoading={isLoading} error={error} />
        )}
        {tab === "profile" && <ProfileTab />}
      </AppShell>
    </PageTransition>
  );
}
