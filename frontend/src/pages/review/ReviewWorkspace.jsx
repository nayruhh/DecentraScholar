import { useEffect, useState } from "react";
import PageTransition from "../../components/PageTransition";
import AppShell from "../dashboard/components/AppShell";
import ReviewWorkspaceTab from "../dashboard/tabs/ReviewWorkspaceTab";
import { refreshWalletBalanceFromChain } from "../dashboard/tabs/tokenomicsStore";

export default function ReviewWorkspace() {
  const [walletBalance, setWalletBalance] = useState(0);

  useEffect(() => {
    refreshWalletBalanceFromChain().then(setWalletBalance).catch(() => {});
  }, []);

  return (
    <PageTransition>
      <AppShell
        activeNav="reviewer"
        pageTitle="Reviewer Workspace"
        pageSubtitle="Manage review requests, complete reviews, and track rewards."
        tokenBalance={walletBalance}
      >
        <ReviewWorkspaceTab onWalletBalanceChange={setWalletBalance} />
      </AppShell>
    </PageTransition>
  );
}
