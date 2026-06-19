import { useEffect, useMemo, useRef, useState } from "react";
import PageTransition from "../../components/PageTransition";
import { ClipboardList, FileSearch, Upload } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import UploadTab from "../dashboard/tabs/UploadTab";
import SubmissionsTab from "../dashboard/tabs/SubmissionsTab";
import RevisionsTab from "../dashboard/tabs/RevisionsTab";
import AppShell from "../dashboard/components/AppShell";
import { getWalletAddress } from "../dashboard/utils";
import {
  refreshWalletBalanceFromChain,
} from "../dashboard/tabs/tokenomicsStore";
import {
  loadCanonicalReviewSessions,
  saveReviewSessionsToStorage,
  subscribeReviewSessions,
  syncReviewSessionsFromBackend,
  syncReviewSessionsFromChain,
} from "../dashboard/tabs/reviewWorkspace/sessionStore";
import {
  getSubmissionMetadataForPaper,
  listSubmissionMetadataByWallet,
  removeSubmissionMetadata,
  saveSubmissionMetadata,
  subscribeSubmissionMetadata,
  syncSubmissionMetadataFromBackend,
  syncSubmissionMetadataFromChain,
} from "../dashboard/tabs/submissionMetadataStore";
import { subscribeBrowserSession, syncProfileFromBackend } from "../../services/browserSession";
import { appendAuditEvent, syncAuditEventsFromBackend } from "../dashboard/tabs/auditLogStore";
import { syncReputationFromBackend } from "../dashboard/tabs/reputationStore";
import { useToast } from "../../components/feedback/ToastProvider";
import { reservePriorityFeeOnChain } from "../../services/protocolVault";
import { acknowledgeDecisionOnChain, publishPaperOnChain } from "../../services/paperRegistry";
import {
  createOfficialPublicationArtifacts,
  scheduleRejectedArtifactCleanup,
} from "../../services/publicationArtifactsApi";
import { syncPaperArtifactAccess } from "../../services/artifactAccessApi";
import { formatWalletActionError } from "../../services/walletError";
import PublishConfirmModal from "./components/PublishConfirmModal";

const validTabs = new Set(["upload", "submissions", "revisions"]);
const AUTHOR_REVIEW_ACK_KEY = "authorReviewedDecisionAcks"; // kept for bootstrap read from localStorage
const PRIORITY_MATCHING_FEE_DST = 20;
const REVIEW_EXTENSION_DAYS = 7;

function normalizeFirstLastName(rawName) {
  const parts = (rawName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function buildDoi(paperId) {
  // Standard format: P001 → 10.5555/fyp.2026.001
  if (/^P\d+$/i.test(String(paperId || ""))) {
    return `10.5555/fyp.2026.${String(paperId).replace(/^P/i, "").padStart(3, "0")}`;
  }
  // Fallback: sanitize and truncate to keep DOI short and valid
  const sanitized = String(paperId || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 12)
    .toLowerCase();
  return `10.5555/fyp.2026.${sanitized || "unknown"}`;
}

function getPublishedReviewerNames(session) {
  return (session?.reviewers || [])
    .filter((reviewer) => reviewer?.revealIdentityAfterPublish && reviewer?.vote)
    .map((reviewer) => {
      const name = normalizeFirstLastName(reviewer?.reviewerPublicName || "");
      if (name) return name;
      return reviewer?.reviewerWallet || null;
    })
    .filter(Boolean);
}

export default function AuthorWorkspace() {
  const { showToast } = useToast();
  const withdrawnSessionIds = useRef(new Set());
  const [currentWallet, setCurrentWallet] = useState(() => getWalletAddress());
  const [walletBalance, setWalletBalance] = useState(0);
  const [actionMessage, setActionMessage] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get("tab");
  const tab = validTabs.has(queryTab) ? queryTab : "upload";

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

  const [submissionMetadataItems, setSubmissionMetadataItems] = useState(() =>
    listSubmissionMetadataByWallet(currentWallet)
  );
  const [reviewDecisionAcks, setReviewDecisionAcks] = useState(() => loadAuthorReviewAcks());

  const [submissions, setSubmissions] = useState(() => []);

  const [revisionItems, setRevisionItems] = useState(() =>
    loadCanonicalReviewSessions()
  );

  const [publishModalSession, setPublishModalSession] = useState(null);

  useEffect(
    () =>
      subscribeSubmissionMetadata(() =>
        setSubmissionMetadataItems(listSubmissionMetadataByWallet(currentWallet))
      ),
    [currentWallet]
  );

  useEffect(
    () =>
      subscribeBrowserSession(({ walletAddress }) => {
        setCurrentWallet(String(walletAddress || ""));
      }),
    []
  );

  useEffect(() => {
    setSubmissionMetadataItems(listSubmissionMetadataByWallet(currentWallet));
  }, [currentWallet]);

  useEffect(() => {
    if (!currentWallet) return;
    syncSubmissionMetadataFromBackend(currentWallet).catch(() => {});
  }, [currentWallet]);

  // Restore all backend-persisted state whenever the wallet changes.
  useEffect(() => {
    if (!currentWallet) return;
    syncReviewSessionsFromBackend(currentWallet).catch(() => {});
    syncReviewSessionsFromChain().catch(() => {});
    syncAuditEventsFromBackend(currentWallet).catch(() => {});
    syncReputationFromBackend(currentWallet).catch(() => {});
    syncProfileFromBackend(currentWallet).catch(() => {});
    refreshWalletBalanceFromChain().then((balance) => {
      setWalletBalance(balance);
    }).catch(() => {});
  }, [currentWallet]);

  useEffect(() =>
    subscribeReviewSessions((sessions) => {
      setRevisionItems(sessions.filter((s) => !withdrawnSessionIds.current.has(s.id)));
    }),
  []);

  useEffect(() => {
    saveReviewSessionsToStorage(revisionItems);
  }, [revisionItems]);

  useEffect(() => {
    const timer = setInterval(() => {
      syncReviewSessionsFromChain().catch(() => {});
    }, 15 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const paperIds = revisionItems.map((s) => s?.paperId).filter(Boolean);
    if (!paperIds.length) return;
    syncSubmissionMetadataFromChain(paperIds).catch(() => {});
  }, [revisionItems]);

  useEffect(() => {
    const sessionsWithPaperIds = revisionItems.filter((session) => session?.paperId);
    if (!sessionsWithPaperIds.length) return;
    sessionsWithPaperIds.forEach((session) => {
      const reviewerWallets = (session.reviewers || [])
        .map((reviewer) => String(reviewer?.reviewerWallet || "").trim().toLowerCase())
        .filter(Boolean);
      syncPaperArtifactAccess({
        paperId: session.paperId,
        authorWallet: session.authorWallet || getWalletAddress(),
        reviewerWallets,
      }).catch(() => {});
    });
  }, [revisionItems]);

  useEffect(() => {
    let cancelled = false;
    const rejectedOrAbandoned = revisionItems.filter(
      (session) =>
        session?.phase === "decided" &&
        (session?.decision === "rejected" || session?.decision === "abandoned")
    );

    (async () => {
      for (const session of rejectedOrAbandoned) {
        const metadata = getSubmissionMetadataForPaper({
          paperId: session.paperId,
          title: session.title,
        });
        if (!metadata?.submissionMetadataCid || metadata?.rejectedCleanupScheduledAt) continue;
        try {
          const cleanupResult = await scheduleRejectedArtifactCleanup(session.paperId);
          if (cancelled) return;
          saveSubmissionMetadata({
            ...metadata,
            paperId: session.paperId,
            title: session.title,
            artifactPinStatus: "eligible_for_cleanup",
            rejectedCleanupAfter: cleanupResult.cleanupAfter,
            rejectedCleanupScheduledAt: new Date().toISOString(),
          });
        } catch {
          // Keep the UI usable if the local artifact service is unavailable.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [revisionItems]);

  useEffect(() => {
    const normalizedWallet = String(currentWallet || "").trim().toLowerCase();
    if (!normalizedWallet || !submissionMetadataItems.length) return;

    submissionMetadataItems.forEach((item) => {
      const paperId = String(item?.paperId || "").trim();
      const title = String(item?.title || "").trim();
      if (!paperId || !title) return;

      const alreadyTracked = revisionItems.some(
        (session) =>
          String(session?.paperId || "").trim() === paperId ||
          normalizeTitleKey(session?.title) === normalizeTitleKey(title)
      );
      if (alreadyTracked) return;

      setRevisionItems((prev) => {
        const exists = prev.some(
          (session) =>
            String(session?.paperId || "").trim() === paperId ||
            normalizeTitleKey(session?.title) === normalizeTitleKey(title)
        );
        if (exists) return prev;
        return [
          {
            id: `session-${paperId.toLowerCase()}`,
            paperId,
            title,
            field: item.researchField || "",
            deadline: item.reviewDeadline || "",
            authorWallet: normalizedWallet,
            phase: "blind_review",
            decision: "",
            officiallyPublished: false,
            revisionCycle: 0,
            reviewRoundStatus: "active",
            highPriority: false,
            finalized: false,
            tokenReward: 22.5,
            reservedRewardPoolDst: 67.5,
            rewardPoolRemainingDst: 67.5,
            rewardPaidDst: 0,
            slashedStakeTreasuryDst: 0,
            resolutionReason: "",
            authorActionRequired: false,
            authorActionOptions: [],
            reviewers: Array.from({ length: 3 }, (_, index) => ({
              id: `${paperId.toLowerCase()}-slot-${index + 1}`,
              reviewerWallet: null,
              requestStatus: "requested",
              requestOpenedOn: new Date().toISOString().slice(0, 10),
              requestExpiresOn: new Date().toISOString().slice(0, 10),
              requestRound: 1,
              revealIdentityAfterPublish: false,
              reviewerPublicName: "",
              stakedTokens: 0,
              stakeStatus: "none",
              stakeJoinedAt: null,
              rewardEarned: 0,
              vote: null,
              summary: "",
              strengths: "",
              weaknesses: "",
              requiredChanges: "",
              submittedDate: null,
              rebuttalComment: "",
              rebuttalVote: null,
            })),
          },
          ...prev,
        ];
      });
    });
  }, [currentWallet, submissionMetadataItems, revisionItems]);

  const acknowledgeCompletedReview = (paperId) => {
    const normalized = String(paperId || "").trim();
    if (!normalized) return;
    setReviewDecisionAcks((prev) => {
      if (prev.includes(normalized)) return prev;
      return [...prev, normalized];
    });
    // Write acknowledgement on-chain — fire and forget, failure is non-blocking
    acknowledgeDecisionOnChain(normalized).catch(() => {});
  };

  const handleRemovePendingSubmission = (entry) => {
    if (!entry) return;
    removeSubmissionMetadata({
      paperId: entry.paperId,
      title: entry.title,
    });
    showToast(`Removed ${entry.paperId || entry.title} from pending submissions.`);
  };

  const handleWithdrawSession = (sessionId) => {
    if (!sessionId) return;
    const rawId = sessionId.startsWith("history-") ? sessionId.slice("history-".length) : sessionId;
    withdrawnSessionIds.current.add(rawId);
    setRevisionItems((prev) => prev.filter((s) => s.id !== rawId));
    const next = loadCanonicalReviewSessions().filter((s) => s.id !== rawId);
    saveReviewSessionsToStorage(next);
    showToast("Submission withdrawn.");
  };

  const handlePayPriorityFee = async (sessionId) => {
    const target = revisionItems.find((session) => session.id === sessionId);
    if (!target?.paperId || !target?.authorActionRequired) return;
    const wallet = getWalletAddress();
    setActionMessage("");
    try {
      const paymentResult = await reservePriorityFeeOnChain(
        target.paperId,
        PRIORITY_MATCHING_FEE_DST
      );
      const nextWalletBalance = await refreshWalletBalanceFromChain();
      setWalletBalance(nextWalletBalance);
      setRevisionItems((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                highPriority: true,
                authorActionRequired: false,
                authorActionResolvedAt: new Date().toISOString().split("T")[0],
                priorityFeePaidAt: new Date().toISOString().split("T")[0],
                priorityFeePaidDst: PRIORITY_MATCHING_FEE_DST,
                resolutionReason: "priority_fee_paid_for_reviewer_matching",
              }
            : session
        )
      );
      appendAuditEvent(wallet, {
        eventType: "review_priority_fee",
        status: "success",
        paperId: target.paperId,
        amountDst: PRIORITY_MATCHING_FEE_DST,
        txHash: paymentResult.txHash,
      });
      showToast(`Priority fee paid for ${target.paperId}. Reviewer matching is now prioritized.`);
    } catch (error) {
      const msg = formatWalletActionError(error, "Priority fee transaction failed.");
      setActionMessage(msg);
      appendAuditEvent(wallet, {
        eventType: "review_priority_fee",
        status: "failed",
        paperId: target.paperId,
        amountDst: PRIORITY_MATCHING_FEE_DST,
      });
    }
  };

  const handleExtendReviewWindow = (sessionId) => {
    const target = revisionItems.find((session) => session.id === sessionId);
    if (!target?.authorActionRequired) return;
    const wallet = getWalletAddress();
    const nextDeadline = addDaysToIsoDate(
      target.deadline,
      REVIEW_EXTENSION_DAYS
    );
    setRevisionItems((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              deadline: nextDeadline,
              authorActionRequired: false,
              authorActionResolvedAt: new Date().toISOString().split("T")[0],
              reviewWindowExtendedAt: new Date().toISOString().split("T")[0],
              reviewWindowExtendedDays: REVIEW_EXTENSION_DAYS,
              resolutionReason: "review_window_extended_for_replacement_matching",
            }
          : session
      )
    );
    appendAuditEvent(wallet, {
      eventType: "review_window_extended",
      status: "success",
      paperId: target.paperId,
      daysExtended: REVIEW_EXTENSION_DAYS,
    });
    showToast(`Review window extended by ${REVIEW_EXTENSION_DAYS} days for ${target.paperId}.`);
  };

  const handleOfficialPublish = (sessionId) => {
    // RevisionsTab entries have id "history-<raw>" while raw revisionItems have id "<raw>"
    const target = revisionItems.find(
      (session) => session.id === sessionId || `history-${session.id}` === sessionId
    );
    if (!target || target.decision !== "accepted" || target.officiallyPublished) return;
    setPublishModalSession(target);
  };

  const handleOfficialPublishConfirmed = async (modalChoices) => {
    const target = publishModalSession;
    setPublishModalSession(null);
    if (!target) return;
    setActionMessage("");
    const wallet = getWalletAddress();

    const today = new Date().toISOString().split("T")[0];
    const submissionMetadata = getSubmissionMetadataForPaper({
      paperId: target.paperId,
      title: target.title,
    });
    const doi = buildDoi(target.paperId);
    const reviewedBy = getPublishedReviewerNames(target);

    let artifactResult;
    try {
      artifactResult = await createOfficialPublicationArtifacts({
        paperId: target.paperId,
        authorWallet: wallet,
        doi,
        submissionMetadataCid: submissionMetadata?.submissionMetadataCid || "",
        publishedAuthorName: modalChoices.publishedAuthorName,
        publishCollaboratorNames: modalChoices.publishCollaboratorNames,
        publishedReviewerNames: reviewedBy,
      });
    } catch (error) {
      const msg = String(error?.message || "Could not create publication artifacts.");
      setActionMessage(msg);
      appendAuditEvent(wallet, {
        eventType: "publish",
        status: "failed_publication_artifacts",
        stage: "official",
        paperId: target.paperId,
        title: target.title,
      });
      return;
    }

    const nextSubmission = {
      id: `s-${target.paperId.toLowerCase()}`,
      title: target.title,
      paperId: target.paperId,
      doi,
      venue: "DecentraScholar Journal",
      version: "v1.0",
      publicationMetadataCid: artifactResult.publicationMetadataCid || "",
      publishedAt: today,
    };

    // Backend artifact saved — commit all UI state now so the paper moves to My Submissions
    // regardless of whether the on-chain transaction succeeds.
    saveSubmissionMetadata({
      ...(submissionMetadata || {}),
      paperId: target.paperId,
      title: target.title,
      publicationMetadataCid: artifactResult.publicationMetadataCid || "",
      manuscriptCid: artifactResult.manuscriptCid || submissionMetadata?.manuscriptCid || "",
      artifactVisibility: "public",
      artifactPinStatus: "long_term",
      publishedIpfsAt: artifactResult.publishedAt || today,
    });

    setRevisionItems((prev) =>
      prev.map((session) =>
        session.id === target.id
          ? {
              ...session,
              officiallyPublished: true,
              publishedAt: today,
              doi: nextSubmission.doi,
              venue: nextSubmission.venue,
              version: nextSubmission.version,
              publicationMetadataCid: artifactResult.publicationMetadataCid || "",
              publishedIpfsAt: artifactResult.publishedAt || null,
              publishedAuthorName: modalChoices.publishedAuthorName,
              publishedReviewerNames: reviewedBy,
            }
          : session
      )
    );
    setSubmissions((prev) =>
      prev.some((item) => item.paperId === target.paperId) ? prev : [nextSubmission, ...prev]
    );

    acknowledgeCompletedReview(target.paperId);
    appendAuditEvent(wallet, {
      eventType: "publish",
      status: "success",
      stage: "official",
      paperId: target.paperId,
      title: target.title,
      publishedAt: today,
    });
    setActionMessage("");
    showToast(`Officially published ${target.paperId}.`);

    // Attempt on-chain publication — non-blocking, failure is logged as a warning.
    publishPaperOnChain({
      paperId: target.paperId,
      doi,
      publicationMetadataCid: artifactResult.publicationMetadataCid || "",
    }).then((publishResult) => {
      appendAuditEvent(wallet, {
        eventType: "publish",
        status: "chain_confirmed",
        stage: "official",
        paperId: target.paperId,
        title: target.title,
        txHash: publishResult.txHash,
      });
    }).catch((error) => {
      console.warn("[AuthorWorkspace] On-chain publish failed (paper already published off-chain):", error?.message);
      appendAuditEvent(wallet, {
        eventType: "publish",
        status: "failed_chain_publish",
        stage: "official",
        paperId: target.paperId,
        title: target.title,
      });
    });
  };

  const allRevisionSessions = useMemo(
    () =>
      revisionItems.filter(
        (session) =>
          String(session?.authorWallet || "").trim().toLowerCase() ===
          String(currentWallet || "").trim().toLowerCase()
      ),
    [revisionItems, currentWallet]
  );

  const metadataOnlyUnderReview = submissionMetadataItems
    .filter(
      (item) =>
        !allRevisionSessions.some(
          (session) =>
            String(session.paperId || "").trim() === String(item.paperId || "").trim() ||
            normalizeTitleKey(session.title) === normalizeTitleKey(item.title)
        )
    )
    .map((item) => ({
      id: `submission-${item.paperId || normalizeTitleKey(item.title)}`,
      title: item.title,
      paperId: item.paperId || "Pending ID",
      field: item.researchField,
      deadline: item.reviewDeadline,
      decision: null,
      phase: "submitted",
      status: "submitted",
      officiallyPublished: false,
      metadata: item,
      reviews: [],
      highPriority: false,
      authorActionRequired: false,
      authorActionOptions: [],
    }));

  const sessionEntries = allRevisionSessions.map((session) => {
    const paperId = String(session.paperId || "").trim();
    const isAcknowledged = paperId ? reviewDecisionAcks.includes(paperId) : false;
    return {
      id: `history-${session.id}`,
      sessionId: session.id,
      title: session.title,
      paperId: session.paperId,
      field: session.field,
      deadline: session.deadline,
      decision: session.decision,
      phase: session.phase,
      publishedAt: session.publishedAt || "",
      doi: session.doi || "",
      venue: session.venue || "",
      version: session.version || "",
      status:
        session.officiallyPublished
          ? "published"
          : session.phase === "blind_review" || session.phase === "rebuttal"
            ? "under_review"
            : session.decision === "accepted"
              ? "accepted"
              : session.decision === "rejected"
                ? "rejected"
                : session.decision === "abandoned"
                  ? "abandoned"
                  : "submitted",
      officiallyPublished: Boolean(session.officiallyPublished),
      metadata: getSubmissionMetadataForPaper({
        paperId: session.paperId,
        title: session.title,
      }),
      assignedReviewerCount: Array.isArray(session.reviewers)
        ? session.reviewers.filter((reviewer) => Boolean(reviewer?.reviewerWallet)).length
        : 0,
      submittedReviewCount: Array.isArray(session.reviewers)
        ? session.reviewers.filter((reviewer) => reviewer?.submittedDate).length
        : 0,
      totalReviewerCount: Array.isArray(session.reviewers) ? session.reviewers.length : 0,
      reviewsHiddenUntilComplete: session.phase !== "decided",
      reviews: buildAuthorVisibleReviews(session),
      reviewCompletePendingAck: session.phase === "decided" && !isAcknowledged,
      highPriority: Boolean(session.highPriority),
      authorActionRequired: Boolean(session.authorActionRequired),
      authorActionOptions: Array.isArray(session.authorActionOptions)
        ? session.authorActionOptions
        : [],
      priorityFeePaidAt: session.priorityFeePaidAt || "",
      priorityFeePaidDst: Number(session.priorityFeePaidDst || 0),
      reviewWindowExtendedAt: session.reviewWindowExtendedAt || "",
      reviewWindowExtendedDays: Number(session.reviewWindowExtendedDays || 0),
      resolutionReason: session.resolutionReason || "",
      reviewRoundStatus: session.reviewRoundStatus || "",
    };
  });

  const underReviewItems = dedupeSubmissionHistory([
    ...metadataOnlyUnderReview,
    ...sessionEntries.filter(
      (session) =>
        session.title &&
        !session.officiallyPublished &&
        (
          session.phase === "blind_review" ||
          session.phase === "rebuttal" ||
          session.phase === "replacement_review"
        )
    ),
  ]).sort(compareUnderReviewPriority);

  const publishedOnlySubmissions = submissions
    .filter((item) => !allRevisionSessions.some((session) => session.paperId === item.paperId))
    .map((item) => ({
      ...item,
      status: "published",
      phase: "decided",
      decision: "accepted",
      sessionId: "",
      officiallyPublished: true,
      metadata: getSubmissionMetadataForPaper({
        paperId: item.paperId,
        title: item.title,
      }),
      reviews: [],
    }));

  const submissionHistory = dedupeSubmissionHistory([
    ...sessionEntries.filter(
      (session) =>
        session.officiallyPublished ||
        session.phase === "decided"
    ),
    ...publishedOnlySubmissions,
  ]);

  return (
    <PageTransition>
      <AppShell
        activeNav="author"
        pageTitle="Author Workspace"
        pageSubtitle="Manage uploads, submissions, and papers under review."
        tokenBalance={walletBalance}
      >
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => handleTabChange("upload")} className={tabClass(tab === "upload")}>
            <Upload className="h-4 w-4" />
            Upload paper
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("submissions")}
            className={tabClass(tab === "submissions")}
          >
            <ClipboardList className="h-4 w-4" />
            My submissions
          </button>
          <button type="button" onClick={() => handleTabChange("revisions")} className={tabClass(tab === "revisions")}>
            <FileSearch className="h-4 w-4" />
            Under Review
          </button>
        </div>
        {publishModalSession ? (
          <PublishConfirmModal
            paper={(() => {
              const meta = getSubmissionMetadataForPaper({
                paperId: publishModalSession.paperId,
                title: publishModalSession.title,
              });
              return {
                title: publishModalSession.title,
                collaborators: meta?.collaborators || [],
                aiGeneratedDisclosure: meta?.aiGeneratedDisclosure || { used: false, details: "" },
              };
            })()}
            onConfirm={handleOfficialPublishConfirmed}
            onCancel={() => setPublishModalSession(null)}
          />
        ) : null}
        {actionMessage ? (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {actionMessage}
          </div>
        ) : null}

        {tab === "upload" && <UploadTab onWalletBalanceChange={setWalletBalance} />}
        {tab === "submissions" && (
          <SubmissionsTab
            submissions={submissionHistory}
            onOfficialPublish={handleOfficialPublish}
          />
        )}
        {tab === "revisions" && (
          <RevisionsTab
            revisionItems={underReviewItems}
            onAcknowledgeCompletedReview={acknowledgeCompletedReview}
            onOfficialPublish={handleOfficialPublish}
            onPayPriorityFee={handlePayPriorityFee}
            onExtendReviewWindow={handleExtendReviewWindow}
            onRemovePendingSubmission={handleRemovePendingSubmission}
            onWithdrawSession={handleWithdrawSession}
            priorityFeeDst={PRIORITY_MATCHING_FEE_DST}
            reviewExtensionDays={REVIEW_EXTENSION_DAYS}
          />
        )}
      </AppShell>
    </PageTransition>
  );
}

function normalizeTitleKey(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildAuthorVisibleReviews(session) {
  // Author only sees reviews + rebuttal comments after the final decision is made
  if (session?.phase !== "decided") {
    return [];
  }
  return Array.isArray(session?.reviewers)
    ? session.reviewers
        .filter(
          (reviewer) =>
            reviewer?.vote ||
            reviewer?.summary ||
            reviewer?.strengths ||
            reviewer?.weaknesses ||
            reviewer?.requiredChanges
        )
        .map((reviewer, index) => ({
          id: reviewer?.id || `${session?.paperId || session?.id}-review-${index + 1}`,
          reviewerLabel: reviewer?.revealIdentityAfterPublish
            ? normalizeFirstLastName(reviewer?.reviewerPublicName || "") || reviewer?.reviewerWallet || `Reviewer ${index + 1}`
            : `Reviewer ${index + 1}`,
          vote: reviewer?.rebuttalVote || reviewer?.vote || "",
          summary: reviewer?.summary || "",
          strengths: reviewer?.strengths || "",
          weaknesses: reviewer?.weaknesses || "",
          requiredChanges: reviewer?.requiredChanges || "",
          submittedDate: reviewer?.submittedDate || "",
        }))
    : [];
}


function dedupeSubmissionHistory(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    const key = String(entry?.paperId || normalizeTitleKey(entry?.title) || entry?.id || "").trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, entry);
      continue;
    }
    const current = map.get(key);
    map.set(key, {
      ...current,
      ...entry,
      sessionId: entry?.sessionId || current?.sessionId || "",
      metadata: entry?.metadata || current?.metadata || null,
      reviews: Array.isArray(entry?.reviews) && entry.reviews.length ? entry.reviews : current?.reviews || [],
      reviewCompletePendingAck:
        Boolean(entry?.reviewCompletePendingAck) || Boolean(current?.reviewCompletePendingAck),
    });
  }
  return Array.from(map.values());
}

function loadAuthorReviewAcks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTHOR_REVIEW_ACK_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map((value) => String(value || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addDaysToIsoDate(isoDate, daysToAdd) {
  const safeDate = String(isoDate || "").trim();
  const parsed = safeDate ? new Date(`${safeDate}T00:00:00Z`) : new Date();
  if (Number.isNaN(parsed.getTime())) return safeDate;
  parsed.setUTCDate(parsed.getUTCDate() + Number(daysToAdd || 0));
  return parsed.toISOString().split("T")[0];
}

function compareUnderReviewPriority(left, right) {
  return getUnderReviewPriorityScore(right) - getUnderReviewPriorityScore(left);
}

function getUnderReviewPriorityScore(item) {
  let score = 0;
  if (needsReviewerIssueResubmission(item)) score += 100;
  if (item?.highPriority) score += 50;
  if (item?.authorActionRequired) score += 30;
  if (item?.reviewCompletePendingAck) score += 10;
  return score;
}

function needsReviewerIssueResubmission(item) {
  const reason = String(item?.resolutionReason || "").toLowerCase();
  return (
    String(item?.decision || "").toLowerCase() === "abandoned" ||
    reason === "replacement_requested_after_single_submission" ||
    reason === "reviewer_requests_exhausted" ||
    reason === "deadline_expired_before_complete_panel_resolution" ||
    reason === "session_reset_after_zero_submissions"
  );
}
