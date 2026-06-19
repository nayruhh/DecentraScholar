import { useEffect, useState } from "react";
import PageTransition from "../../components/PageTransition";
import BrowseTab from "../dashboard/tabs/BrowseTab";
import AppShell from "../dashboard/components/AppShell";
import { loadTokenomicsState } from "../dashboard/tabs/tokenomicsStore";
import {
  loadPublishedPapers,
  refreshPublishedPapers,
  subscribePaperChanges,
} from "../dashboard/tabs/paperStore";

export default function BrowsePapers() {
  const [walletBalance] = useState(() => loadTokenomicsState().walletBalance);
  const [papers, setPapers] = useState(() => loadPublishedPapers());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = subscribePaperChanges(setPapers);
    refreshPublishedPapers()
      .then(() => setError(""))
      .catch(() => setError("Could not load published papers from the configured contracts."))
      .finally(() => setIsLoading(false));
    return unsubscribe;
  }, []);

  return (
    <PageTransition>
      <AppShell
        activeNav="browse"
        pageTitle="Browse Papers"
        pageSubtitle="Discover and explore research from the community."
        tokenBalance={walletBalance}
      >
        <BrowseTab papers={papers} isLoading={isLoading} error={error} />
      </AppShell>
    </PageTransition>
  );
}
