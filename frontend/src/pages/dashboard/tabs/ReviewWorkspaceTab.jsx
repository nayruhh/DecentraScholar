import { useEffect, useMemo, useState } from "react";
import CardShell from "../components/CardShell";
import {
  Clock,
  FileText,
  Users,
  Clock3,
  Coins,
  ArrowRight,
  ArrowLeft,
  EyeOff,
  Eye,
  MessageSquare,
  CircleCheck,
  MinusCircle,
  Star,
  XCircle,
  AlertTriangle,
  Send,
} from "lucide-react";
import {
  loadTokenomicsState,
  refreshWalletBalanceFromChain,
  subscribeTokenomicsChange,
} from "./tokenomicsStore";
import { MIN_STAKE_TOKENS } from "./reviewWorkspace/config";
import { formatRating, formatTokenAmount, getLateDays, roundTo2 } from "./reviewWorkspace/format";
import {
  loadCanonicalReviewSessions,
  saveReviewSessionsToStorage,
  subscribeReviewSessions,
  syncReviewSessionsFromBackend,
  syncReviewSessionsFromChain,
} from "./reviewWorkspace/sessionStore";
import { SubNav, StatusPill, VotePill } from "./reviewWorkspace/ui";
import { getWalletAddress } from "../utils";
import { requestWalletSignature } from "../../../services/wallet";
import { fetchPaperFunding, fetchReviewerStake, lockReviewerStakeOnChain, settleReviewerOnChain } from "../../../services/protocolVault";
import { acceptAssignmentOnChain, fetchAllReviewSlotsOnChain, fetchSessionByPaperIdOnChain, isEjectedFromSession, joinReviewOnChain, submitReviewOnChain } from "../../../services/reviewManager";
import { getMyAssignments, acceptAssignment as acceptAssignmentApi, declineAssignment as declineAssignmentApi } from "../../../services/reviewerAssignmentApi";
import { syncPaperArtifactAccess, getPaperArtifactsForWallet } from "../../../services/artifactAccessApi";
import { pinReviewToIpfs, pinRebuttalToIpfs } from "../../../services/publicationArtifactsApi";
import { resolveIpfsUrl } from "../../../services/ipfsGateway";
import { formatWalletActionError } from "../../../services/walletError";
import {
  loadProfileDisplayName,
  subscribeBrowserSession,
  syncProfileFromBackend,
} from "../../../services/browserSession";
import { appendAuditEvent, syncAuditEventsFromBackend } from "./auditLogStore";
import { syncReputationFromBackend } from "./reputationStore";
import TabState from "../../../components/feedback/TabState";
import { useToast } from "../../../components/feedback/ToastProvider";
import {
  getReviewerEligibility,
  HIGH_PRIORITY_MIN_REPUTATION,
  computeReviewerMinStake,
  getWalletReputation,
  recordReviewerNoShow,
  recordReviewerSubmission,
  REVIEW_RESTRICTION_THRESHOLD,
  ACCEPTED_NO_SHOW_MIN_SLASH_RATE,
} from "./reputationStore";

const REVIEW_REQUEST_WINDOW_DAYS = 2;
const REPLACEMENT_REVIEW_WINDOW_DAYS = 5;
const MAX_REPLACEMENT_ROUNDS = 2;
const REVIEW_DRAFT_STORAGE_KEY = "reviewWorkspaceDrafts";

export default function ReviewWorkspaceTab({ onWalletBalanceChange, isLoading = false, error = "" }) {
  const { showToast } = useToast();
  const [reviewerWalletAddress, setReviewerWalletAddress] = useState(() => getWalletAddress() || "");
  const [subTab, setSubTab] = useState("incoming");
  const [incomingView, setIncomingView] = useState("available");
  const [selectedActiveReviewId, setSelectedActiveReviewId] = useState(null);
  const [reviewSessions, setReviewSessions] = useState(() =>
    applyDeadlineAutomation(loadCanonicalReviewSessions())
  );
  const [summary, setSummary] = useState("");
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [requiredChanges, setRequiredChanges] = useState("");
  const [vote, setVote] = useState("");
  const [rebuttalComment, setRebuttalComment] = useState("");
  const [rebuttalVote, setRebuttalVote] = useState("");
  const [revealIdentityAfterPublish, setRevealIdentityAfterPublish] = useState(false);
  const [reviewerPublicName, setReviewerPublicName] = useState(
    () => normalizeFirstLastName(loadProfileDisplayName())
  );
  const [reviewValidationError, setReviewValidationError] = useState("");
  const [joinStakeSessionId, setJoinStakeSessionId] = useState(null);
  const [joinStakeAssignmentPaperId, setJoinStakeAssignmentPaperId] = useState(null);
  const [stakeError, setStakeError] = useState("");
  const [openCompletedReviewId, setOpenCompletedReviewId] = useState(null);
  const [tokenomicsState, setTokenomicsState] = useState(() => loadTokenomicsState());
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [repTick, setRepTick] = useState(0);
  const [viewingPaperSessionId, setViewingPaperSessionId] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [acceptCooldowns, setAcceptCooldowns] = useState({});
  const reviewerReputation = useMemo(
    () => {
      void repTick;
      return getWalletReputation(reviewerWalletAddress);
    },
    [reviewerWalletAddress, repTick]
  );
  const requiredStakeAmount = useMemo(
    () => computeReviewerMinStake(MIN_STAKE_TOKENS, reviewerReputation.reviewerRep),
    [reviewerReputation.reviewerRep]
  );
  const getRequiredStakeAmount = (session) =>
    computeReviewerMinStake(MIN_STAKE_TOKENS, reviewerReputation.reviewerRep, {
      highPriority: isExplicitHighPriority(session),
    });
  const selectedStakeSession = useMemo(
    () => reviewSessions.find((session) => session.id === joinStakeSessionId) || null,
    [reviewSessions, joinStakeSessionId]
  );
  const selectedRequiredStakeAmount = useMemo(
    () => (selectedStakeSession ? getRequiredStakeAmount(selectedStakeSession) : requiredStakeAmount),
    [selectedStakeSession, requiredStakeAmount]
  );

  useEffect(() => {
    return subscribeTokenomicsChange(setTokenomicsState);
  }, []);

  useEffect(
    () =>
      subscribeBrowserSession(({ walletAddress }) => {
        const w = String(walletAddress || "");
        setReviewerWalletAddress(w);
      }),
    []
  );

  useEffect(() => subscribeReviewSessions((sessions) => {
    setReviewSessions(applyDeadlineAutomation(sessions));
  }), []);

  useEffect(() => {
    if (!reviewerWalletAddress) return;
    syncReviewSessionsFromBackend(reviewerWalletAddress).catch(() => {});
    syncReviewSessionsFromChain().catch(() => {});
    syncAuditEventsFromBackend(reviewerWalletAddress).catch(() => {});
    syncReputationFromBackend(reviewerWalletAddress).catch(() => {});
    syncProfileFromBackend(reviewerWalletAddress).catch(() => {});
    refreshWalletBalanceFromChain().then((balance) => {
      setTokenomicsState((prev) => ({ ...prev, walletBalance: balance }));
      setBalanceLoaded(true);
    }).catch(() => { setBalanceLoaded(true); });
  }, [reviewerWalletAddress]);

  useEffect(() => {
    if (!reviewerWalletAddress) return;
    getMyAssignments(reviewerWalletAddress)
      .then((data) => setAssignments(data.assignments || []))
      .catch(() => {});
    const timer = setInterval(() => {
      getMyAssignments(reviewerWalletAddress)
        .then((data) => setAssignments(data.assignments || []))
        .catch(() => {});
    }, 30 * 1000);
    return () => clearInterval(timer);
  }, [reviewerWalletAddress]);

  useEffect(() => {
    if (typeof onWalletBalanceChange === "function") {
      onWalletBalanceChange(tokenomicsState.walletBalance);
    }
  }, [onWalletBalanceChange, tokenomicsState.walletBalance]);

  useEffect(() => {
    saveReviewSessionsToStorage(reviewSessions);
  }, [reviewSessions]);

  useEffect(() => {
    const sessionsWithPaperIds = reviewSessions.filter((session) => session?.paperId);
    if (!sessionsWithPaperIds.length) return;
    sessionsWithPaperIds.forEach((session) => {
      const reviewerWallets = (session.reviewers || [])
        .map((reviewer) => String(reviewer?.reviewerWallet || "").trim().toLowerCase())
        .filter(Boolean);
      syncPaperArtifactAccess({
        paperId: session.paperId,
        authorWallet: session.authorWallet,
        reviewerWallets,
      }).catch(() => {});
    });
  }, [reviewSessions]);

  useEffect(() => {
    const timer = setInterval(() => {
      setReviewSessions((prev) => applyDeadlineAutomation(prev));
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      syncReviewSessionsFromChain().catch(() => {});
    }, 15 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedActiveReviewId) return;
    const stillVisible = reviewSessions
      .filter((session) => !isOwnAuthorSession(session, reviewerWalletAddress))
      .some((session) => session.id === selectedActiveReviewId);
    if (!stillVisible) {
      setSelectedActiveReviewId(null);
    }
  }, [selectedActiveReviewId, reviewSessions, reviewerWalletAddress]);

  const visibleReviewSessions = useMemo(
    () => reviewSessions.filter((session) => !isOwnAuthorSession(session, reviewerWalletAddress)),
    [reviewSessions, reviewerWalletAddress]
  );

  const availableSessions = useMemo(
    () =>
      visibleReviewSessions
        .filter(
          (s) =>
            s.title &&
            s.phase !== "decided" &&
            !isPastDeadline(s.deadline, nowTs) &&
            s.reviewers.some((r) => isOpenReviewRequest(r)) &&
            !s.reviewers.some(
              (r) => normalizeWallet(r.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
            )
        )
        .sort((left, right) => Number(isExplicitHighPriority(right)) - Number(isExplicitHighPriority(left))),
    [visibleReviewSessions, reviewerWalletAddress, nowTs]
  );

  const activeSessions = useMemo(
    () => {
      const seen = new Set();
      return reviewSessions
        .filter((session) =>
          session.title &&
          !isOwnAuthorSession(session, reviewerWalletAddress) &&
          session.phase !== "decided" &&
          !allInitialBlindReviewsSubmitted(session) &&
          session.reviewers.some(
            (reviewer) =>
              normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWalletAddress) &&
              (reviewer.accepted === true || reviewer.requestStatus === "accepted")
          ) &&
          !session.reviewers.some(
            (reviewer) =>
              normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWalletAddress) &&
              isSubmittedBlindVote(reviewer)
          )
        )
        .filter((session) => {
          const key = String(session.paperId || session.onChainSessionId || session.id || "").toLowerCase();
          if (!key) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((left, right) => Number(isExplicitHighPriority(right)) - Number(isExplicitHighPriority(left)));
    },
    [reviewSessions, reviewerWalletAddress]
  );
  const selectedActiveReview = useMemo(
    () => reviewSessions.find((r) => r.id === selectedActiveReviewId) || null,
    [reviewSessions, selectedActiveReviewId]
  );
  const isSelectedRebuttal = selectedActiveReview?.phase === "rebuttal";
  const isSelectedDecided = selectedActiveReview?.phase === "decided";
  const myReviewerIndex = selectedActiveReview?.reviewers?.findIndex(
    (reviewer) => normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
  );
  const mySlot = myReviewerIndex >= 0 ? selectedActiveReview?.reviewers?.[myReviewerIndex] || null : null;
  const hasSubmitted = Boolean(mySlot?.vote);
  const submittedCount = selectedActiveReview
    ? selectedActiveReview.reviewers.filter((r) => r.vote).length
    : 0;
  const phaseLabel = (phase) => {
    const map = {
      blind_review: "Blind Review",
      rebuttal: "Rebuttal",
      decided: "Decided",
      escalated: "Escalated",
    };
    return map[phase] || phase;
  };
  const selectedReviewView = selectedActiveReview
    ? {
        ...selectedActiveReview,
        phaseLabel: phaseLabel(selectedActiveReview.phase),
        panelLabel: "up to 3-reviewer panel",
        votedLabel: `${submittedCount}/3 voted`,
        rewardLabel: formatReviewerRewardLabel(selectedActiveReview),
        decisionLabel: selectedActiveReview.decision ? toDisplayDecision(selectedActiveReview.decision) : "",
        protocolStatusLabel: getResolutionReasonLabel(selectedActiveReview.resolutionReason),
        panel: selectedActiveReview.reviewers.map((row, index) => ({
          slot: index + 1,
          reviewer: row.reviewerWallet || "Unassigned",
          vote: row.rebuttalVote || row.vote,
          status: formatReviewerSlotStatus(row),
          stakeAmount: Number(row.stakedTokens || 0),
          stakeStatus: row.stakeStatus || "none",
        })),
        revealedReviews: selectedActiveReview.reviewers
          .filter((r) => r.vote)
          .map((r, index) => ({
            reviewer: `Reviewer ${index + 1}`,
            // During rebuttal: show round-1 vote/comments to peers, but only show
            // a reviewer's rebuttal comment after they have submitted their rebuttal vote.
            // The author never sees any of this — only the final state after "decided".
            vote: isSelectedRebuttal ? r.vote : (r.rebuttalVote || r.vote),
            summary: r.summary,
            strengths: r.strengths,
            weaknesses: r.weaknesses,
            changes: r.requiredChanges,
            rebuttalComment: r.rebuttalVote ? r.rebuttalComment : null,
          })),
      }
    : null;

  useEffect(() => {
    if (!selectedActiveReviewId || !selectedActiveReview) {
      resetReviewForms();
      return;
    }
    const draft = loadReviewDraft({
      reviewerWalletAddress,
      sessionId: selectedActiveReviewId,
    });
    setSummary(draft.summary || "");
    setStrengths(draft.strengths || "");
    setWeaknesses(draft.weaknesses || "");
    setRequiredChanges(draft.requiredChanges || "");
    setVote(draft.vote || "");
    setRebuttalComment(draft.rebuttalComment || "");
    setRebuttalVote(draft.rebuttalVote || "");
    setRevealIdentityAfterPublish(Boolean(draft.revealIdentityAfterPublish));
    setReviewerPublicName(
      normalizeFirstLastName(draft.reviewerPublicName || loadProfileDisplayName())
    );
    setReviewValidationError("");
  }, [selectedActiveReviewId, selectedActiveReview, reviewerWalletAddress]);

  useEffect(() => {
    if (!selectedActiveReviewId) return;
    saveReviewDraft(
      {
        reviewerWalletAddress,
        sessionId: selectedActiveReviewId,
      },
      {
        summary,
        strengths,
        weaknesses,
        requiredChanges,
        vote,
        rebuttalComment,
        rebuttalVote,
        revealIdentityAfterPublish,
        reviewerPublicName,
      }
    );
  }, [
    selectedActiveReviewId,
    reviewerWalletAddress,
    summary,
    strengths,
    weaknesses,
    requiredChanges,
    vote,
    rebuttalComment,
    rebuttalVote,
    revealIdentityAfterPublish,
    reviewerPublicName,
  ]);

  const completed = useMemo(
    () =>
      reviewSessions
        .filter((session) => {
          const mySlot = session.reviewers.find(
            (r) => normalizeWallet(r.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
          );
          return mySlot && isSubmittedBlindVote(mySlot);
        })
        .map((session) => {
          const mySlotInSession = session.reviewers.find(
            (reviewer) => normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
          );
          if (!mySlotInSession || !isSubmittedBlindVote(mySlotInSession)) return null;
          return {
            id: `c-${session.id}`,
            sessionId: session.id,
            paperId: session.paperId,
            title: session.title,
            author: session.authorWallet || "Unknown",
            date: mySlotInSession.submittedDate || session.deadline,
            rating: voteToRating(mySlotInSession.rebuttalVote || mySlotInSession.vote),
            tokens: Number(mySlotInSession.rewardEarned || 0),
            vote: mySlotInSession.rebuttalVote || mySlotInSession.vote || "",
            summary: mySlotInSession.summary || "",
            strengths: mySlotInSession.strengths || "",
            weaknesses: mySlotInSession.weaknesses || "",
            requiredChanges: mySlotInSession.requiredChanges || "",
            rebuttalComment: mySlotInSession.rebuttalComment || "",
            phase: session.phase,
            decision: session.decision || "",
            resolutionReason: session.resolutionReason || "",
            allReviewersSubmitted: allInitialBlindReviewsSubmitted(session),
          };
        })
        .filter(Boolean),
    [reviewSessions, reviewerWalletAddress]
  );

  const handleAcceptAssignment = async (paperId, paperTitle = "") => {
    try {
      // Sync from chain so slot data is fresh before opening the stake dialog.
      await syncReviewSessionsFromChain().catch(() => {});

      // Match by keccak256 paperId (chain-discovered sessions) first.
      let sessions = loadCanonicalReviewSessions();
      const requestedPaperId = String(paperId || "").toLowerCase();
      let matchingSession = sessions.find(
        (s) => String(s.paperId || "").toLowerCase() === requestedPaperId
      );

      // Fallback: ask the chain for the session ID. After local node resets,
      // stale cached sessions can reuse the same numeric on-chain ID, so only
      // trust an ID match if the paperId also matches the requested assignment.
      if (!matchingSession) {
        try {
          const onChain = await fetchSessionByPaperIdOnChain(paperId);
          if (onChain?.sessionId && String(onChain.paperId || "").toLowerCase() === requestedPaperId) {
            matchingSession = sessions.find(
              (s) =>
                Number(s.onChainSessionId) === Number(onChain.sessionId) &&
                String(s.paperId || "").toLowerCase() === requestedPaperId
            );
            if (!matchingSession) {
              const slots = await fetchAllReviewSlotsOnChain(onChain.sessionId);
              matchingSession = buildLiveChainSession(onChain, slots, paperTitle);
              saveReviewSessionsToStorage([matchingSession, ...sessions]);
              sessions = loadCanonicalReviewSessions();
              matchingSession = sessions.find((s) => s.id === matchingSession.id) || matchingSession;
            }
          }
        } catch {}
      }

      if (matchingSession) {
        openStakeDialog(matchingSession.id, paperId);
      } else {
        showToast("The on-chain review session for this paper is not available yet. Please restart the node without --reset so the chain listener can recreate the session.");
      }
    } catch (err) {
      showToast(err.message || "Failed to open review session.");
    }
  };

  const handleDeclineAssignment = async (paperId) => {
    try {
      await declineAssignmentApi(paperId, reviewerWalletAddress);
      setAssignments((prev) => prev.filter((a) => a.paperId !== paperId));
      showToast("Assignment declined.");
    } catch (err) {
      showToast(err.message || "Failed to decline assignment.");
    }
  };

  const openStakeDialog = (sessionId, assignmentPaperId = null) => {
    setJoinStakeSessionId(sessionId);
    setJoinStakeAssignmentPaperId(assignmentPaperId);
    setStakeError("");
  };

  const closeStakeDialog = () => {
    setJoinStakeSessionId(null);
    setJoinStakeAssignmentPaperId(null);
    setStakeError("");
  };

  const confirmStakeAndJoin = async () => {
    if (!joinStakeSessionId) return;
    const selectedSession = reviewSessions.find((session) => session.id === joinStakeSessionId);

    if (selectedSession?.onChainSessionId) {
      const ejected = await isEjectedFromSession(selectedSession.onChainSessionId, reviewerWalletAddress);
      if (ejected) {
        setStakeError("You were removed from this review session for a no-show and cannot rejoin it.");
        return;
      }
    }

    const amount = getRequiredStakeAmount(selectedSession);
    const acceptanceError = validateReviewAcceptance(
      selectedSession,
      reviewerWalletAddress,
      tokenomicsState.walletBalance,
      amount,
      reviewerReputation.reviewerRep
    );
    if (acceptanceError) {
      setStakeError(acceptanceError);
      return;
    }

    try {
      const stakeResult = await lockReviewerStakeOnChain(
        selectedSession.paperId || selectedSession.id,
        amount
      );
      const nextWalletBalance = await refreshWalletBalanceFromChain();
      setTokenomicsState((prev) => ({ ...prev, walletBalance: nextWalletBalance }));
      appendAuditEvent(reviewerWalletAddress, {
        eventType: "stake",
        status: "success",
        paperId: selectedSession.paperId || selectedSession.id,
        amountDst: roundTo2(amount),
        txHash: stakeResult.txHash,
      });
    } catch (error) {
      const code = String(error?.code || "");
      const msg = String(error?.message || "");
      const isUserRejection =
        code === "ACTION_REJECTED" ||
        code === "4001" ||
        msg.includes("User denied") ||
        msg.includes("user rejected");

      if (isUserRejection) {
        setStakeError("Transaction cancelled in MetaMask.");
      } else {
        setStakeError(formatWalletActionError(error, "Stake transaction failed. Please check your token balance and try again."));
        appendAuditEvent(reviewerWalletAddress, {
          eventType: "stake",
          status: "failed_transaction",
          paperId: selectedSession.paperId || selectedSession.id,
          amountDst: roundTo2(amount),
        });
      }
      return;
    }

    // Join the review session on-chain.
    // Pre-assigned flow: reviewer already has a slot filled with their wallet —
    //   call acceptAssignment to mark that slot as accepted.
    // Self-select flow: no slot yet — call joinReview to claim the first open slot.
    // Read from the store (not React state) to get the freshest slot data after
    // the syncReviewSessionsFromChain call in handleAcceptAssignment.
    if (selectedSession.onChainSessionId) {
      const freshSlotSession = loadCanonicalReviewSessions().find((s) => s.id === joinStakeSessionId);
      const slotsToCheck = freshSlotSession?.reviewers ?? selectedSession.reviewers ?? [];
      const alreadyInSlot = slotsToCheck.some(
        (r) => normalizeWallet(r.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
      );
      try {
        if (alreadyInSlot) {
          await acceptAssignmentOnChain(selectedSession.onChainSessionId);
        } else {
          await joinReviewOnChain(selectedSession.onChainSessionId, revealIdentityAfterPublish);
        }
      } catch (error) {
        const msg = String(error?.message || "");
        const alreadyDone =
          msg.includes("AlreadyAccepted") ||
          msg.includes("already accepted") ||
          msg.includes("AlreadyJoined") ||
          msg.includes("already joined");
        if (!alreadyDone) {
          setStakeError(formatWalletActionError(error, "Could not join review session on-chain."));
          return;
        }
      }
    }

    // Mark the assignment as accepted in the backend now that stake is confirmed.
    if (joinStakeAssignmentPaperId) {
      try {
        await acceptAssignmentApi(joinStakeAssignmentPaperId, reviewerWalletAddress);
        setAssignments((prev) =>
          prev.map((a) => a.paperId === joinStakeAssignmentPaperId ? { ...a, status: "accepted" } : a)
        );
      } catch {}
    }

    setReviewSessions((prev) =>
      prev.map((session) => {
        if (session.id !== joinStakeSessionId) return session;
        const reviewers = [...session.reviewers];
        let slotIdx = reviewers.findIndex(
          (r) => normalizeWallet(r.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
        );
        if (slotIdx < 0) slotIdx = reviewers.findIndex((r) => isOpenReviewRequest(r));
        if (slotIdx < 0) return session;
        reviewers[slotIdx] = {
          ...reviewers[slotIdx],
          reviewerWallet: reviewerWalletAddress,
          stakedTokens: amount,
          stakeStatus: "locked",
          stakeJoinedAt: new Date().toISOString().split("T")[0],
          requestStatus: "accepted",
          acceptedAt: new Date().toISOString().split("T")[0],
          requestExpiresOn: null,
        };
        return { ...session, reviewers };
      })
    );
    appendAuditEvent(reviewerWalletAddress, {
      eventType: "review_accepted",
      status: "success",
      paperId: selectedSession.paperId || selectedSession.id,
      amountDst: roundTo2(amount),
      sessionId: selectedSession.id,
    });
    showToast(`Joined review with ${formatTokenAmount(amount)} DST stake.`);
    closeStakeDialog();
  };

  const daysLeft = (deadline) =>
    Math.max(0, daysToDeadline(deadline, nowTs));

  const deadlineColor = (days) => {
    if (days <= 3) return "text-[#dc2626]";
    if (days <= 7) return "text-[#d68000]";
    return "text-[#14a452]";
  };

  const phaseBadgeClass = (phase) => {
    const map = {
      blind_review: "bg-[#ece7f8] text-[#6828ce]",
      rebuttal: "bg-[#fff2df] text-[#d68000]",
      decided: "bg-[#def4e8] text-[#10a452]",
      escalated: "bg-[#fff2df] text-[#d68000]",
    };
    return map[phase] || "bg-[#ececf1] text-[#6f748e]";
  };

  const resetReviewForms = () => {
    setSummary("");
    setStrengths("");
    setWeaknesses("");
    setRequiredChanges("");
    setVote("");
    setRebuttalComment("");
    setRebuttalVote("");
    setRevealIdentityAfterPublish(false);
    setReviewerPublicName(normalizeFirstLastName(loadProfileDisplayName()));
    setReviewValidationError("");
  };

  const handleViewPaper = async (session) => {
    setViewingPaperSessionId(session.id);
    try {
      const artifacts = await getPaperArtifactsForWallet({
        paperId: session.paperId,
        requesterWallet: reviewerWalletAddress,
      });
      const cid = artifacts?.submission?.manuscriptCid;
      const url = resolveIpfsUrl(cid);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        showToast("PDF not available yet for this paper.");
      }
    } catch {
      showToast("Could not load the paper. You may not have access yet.");
    } finally {
      setViewingPaperSessionId(null);
    }
  };

  const handleSubmitBlindReview = async () => {
    if (!selectedActiveReviewId || !summary || !vote) return;
    setReviewValidationError("");
    const submissionDate = new Date().toISOString().split("T")[0];
    const targetSession = reviewSessions.find((session) => session.id === selectedActiveReviewId);
    const blindReviewGuardError = validateBlindReviewSubmission(targetSession, reviewerWalletAddress);
    if (blindReviewGuardError) {
      setReviewValidationError(blindReviewGuardError);
      return;
    }
    const myIndex =
      targetSession?.reviewers?.findIndex(
        (reviewer) => normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
      ) ?? -1;
    if (myIndex < 0) {
      setReviewValidationError("You are not assigned as a reviewer for this paper.");
      return;
    }
    const reviewHash = buildReviewHash({
      paperId: targetSession?.paperId || selectedActiveReviewId,
      reviewerWallet: reviewerWalletAddress,
      vote,
      summary,
      strengths,
      weaknesses,
      requiredChanges,
      submissionDate,
    });
    if (!reviewHash) {
      setReviewValidationError("Review hash cannot be empty.");
      return;
    }
    try {
      const signatureResult = await requestWalletSignature({
        action: "vote",
        walletAddress: reviewerWalletAddress,
        message: `Submit ${vote} vote for review ${targetSession?.paperId || selectedActiveReviewId}.`,
      });
      appendAuditEvent(reviewerWalletAddress, {
        eventType: "vote",
        status: "signed",
        paperId: targetSession?.paperId || selectedActiveReviewId,
        vote,
        phase: "blind_review",
        challengeHash: signatureResult.challengeHash,
        reviewHash,
      });
    } catch (error) {
      setReviewValidationError(formatWalletActionError(error, "Wallet signature is required to submit vote."));
      appendAuditEvent(reviewerWalletAddress, {
        eventType: "vote",
        status: "failed_signature",
        paperId: targetSession?.paperId || selectedActiveReviewId,
        vote,
        phase: "blind_review",
      });
      return;
    }
    // Pin review content to IPFS — CID is required before submitting on-chain.
    // If pinning fails we block the submission so we never write a garbage CID permanently.
    let reviewCid = "";
    try {
      reviewCid = await pinReviewToIpfs({
        paperId: targetSession?.paperId || selectedActiveReviewId,
        reviewerWallet: reviewerWalletAddress,
        vote,
        summary,
        strengths,
        weaknesses,
        requiredChanges,
        submittedDate: submissionDate,
        reviewHash,
      });
    } catch (err) {
      setReviewValidationError(err?.message || "Failed to pin review to IPFS.");
      return;
    }
    if (!reviewCid) {
      setReviewValidationError("IPFS returned an empty CID. Please try again.");
      return;
    }

    // Submit review on-chain — reviewer signs this themselves via MetaMask.
    // Re-read onChainSessionId from the latest canonical session state (not the
    // stale targetSession captured before the async IPFS/wallet operations above).
    // If still missing, fetch it live from the chain so we never silently skip.
    const freshSession = loadCanonicalReviewSessions().find((s) => s.id === selectedActiveReviewId);
    let onChainSessionId = freshSession?.onChainSessionId || targetSession?.onChainSessionId;
    if (!onChainSessionId && (freshSession?.paperId || targetSession?.paperId)) {
      const paperId = freshSession?.paperId || targetSession?.paperId;
      const chainSession = await fetchSessionByPaperIdOnChain(paperId).catch(() => null);
      onChainSessionId = chainSession?.sessionId || null;
    }
    if (onChainSessionId) {
      const voteMap = { accept: 1, reject: 2, neutral: 3 };
      const voteInt = voteMap[vote] ?? 0;
      try {
        await submitReviewOnChain(onChainSessionId, voteInt, reviewCid || "");
      } catch (error) {
        setReviewValidationError(formatWalletActionError(error, "Could not submit review on-chain."));
        return;
      }
    }

    const targetIndex = myIndex;
    const mySlotInSession = targetSession?.reviewers?.[targetIndex] || null;
    const lateDays = targetSession ? getLateDays(submissionDate, targetSession.deadline) : 0;
    const wasLateSubmission = lateDays > 0;

    // Keep local stake values for the local state update below.
    const localStake = Number(mySlotInSession?.stakedTokens || 0);
    const hadLockedStake = mySlotInSession?.stakeStatus === "locked" && localStake > 0;
    const { slashingRate, slashedAmount, refundedAmount, status: resolvedStakeStatus } = hadLockedStake
      ? computeStakeSlashing(localStake, lateDays)
      : { slashingRate: 0, slashedAmount: 0, refundedAmount: 0, status: "none" };

    const reviewQualityScore = computeReviewQualityScore({
      summary,
      strengths,
      weaknesses,
      requiredChanges,
      vote,
      field: targetSession?.field,
    });
    const baseReviewerReward = getSessionPerReviewerBaseReward(targetSession);
    const reviewerReward = hadLockedStake
      ? computeReviewerRewardAmount({
          baseReward: baseReviewerReward,
          qualityScore: reviewQualityScore,
          lateDays,
          rewardCap: getSessionRewardPoolRemaining(targetSession),
        })
      : 0;

    // Settlement: always query on-chain stake and pool so it works even when local state is stale.
    // Cap the reward to the actual on-chain pool remaining to avoid InsufficientRewardPool revert.
    try {
      const [onChainStake, onChainFunding] = await Promise.all([
        fetchReviewerStake(
          targetSession?.paperId || selectedActiveReviewId,
          reviewerWalletAddress
        ).catch(() => ({ amount: 0, active: false })),
        fetchPaperFunding(targetSession?.paperId || selectedActiveReviewId)
          .catch(() => ({ rewardPoolRemaining: 0 })),
      ]);

      if (onChainStake.active && onChainStake.amount > 0) {
        const actualSlash = computeStakeSlashing(onChainStake.amount, lateDays).slashedAmount;
        const onChainRewardCap = Number(onChainFunding?.rewardPoolRemaining ?? 0);
        const actualReward = computeReviewerRewardAmount({
          baseReward: baseReviewerReward,
          qualityScore: reviewQualityScore,
          lateDays,
          rewardCap: Math.min(getSessionRewardPoolRemaining(targetSession) || 0, onChainRewardCap),
        });
        const settlementResult = await settleReviewerOnChain(
          targetSession?.paperId || selectedActiveReviewId,
          reviewerWalletAddress,
          actualReward,
          actualSlash
        );
        const nextWalletBalance = await refreshWalletBalanceFromChain();
        setTokenomicsState((prev) => ({ ...prev, walletBalance: nextWalletBalance }));
        appendAuditEvent(reviewerWalletAddress, {
          eventType: "review_settlement",
          status: "success",
          paperId: targetSession?.paperId || selectedActiveReviewId,
          rewardDst: roundTo2(actualReward),
          slashedAmountDst: roundTo2(actualSlash),
          txHash: settlementResult.txHash,
        });
      }
    } catch (error) {
      console.error("[Settlement] Failed to settle reviewer stake:", error?.message || error);
      appendAuditEvent(reviewerWalletAddress, {
        eventType: "review_settlement",
        status: "failed_transaction",
        paperId: targetSession?.paperId || selectedActiveReviewId,
        rewardDst: roundTo2(reviewerReward),
        slashedAmountDst: roundTo2(slashedAmount),
      });
    }

    // Update local state to reflect this reviewer's submission.
    // The backend chain listener will read the on-chain state and automatically
    // call finalizeSession or setRebuttalPhase once all votes are in.
    setReviewSessions((prev) =>
      applyDeadlineAutomation(prev.map((session) => {
        if (session.id !== selectedActiveReviewId) return session;
        const normalizedSession = ensureSessionFunding(session);
        const reviewers = [...normalizedSession.reviewers];
        const myStakeUpdate = hadLockedStake
          ? {
              stakeStatus: resolvedStakeStatus,
              stakeResolvedAt: submissionDate,
              stakeResolution:
                slashingRate <= 0
                  ? "On-time submission"
                  : `Late by ${lateDays} day(s): ${Math.round(slashingRate * 100)}% slashed to FeeVault for storage funding`,
              stakeSlashed: roundTo2(slashedAmount),
              stakeRefunded: roundTo2(refundedAmount),
            }
          : {};

        reviewers[targetIndex] = {
          ...reviewers[targetIndex],
          vote,
          summary,
          strengths,
          weaknesses,
          requiredChanges,
          reviewHash,
          reviewCid: reviewCid || reviewers[targetIndex]?.reviewCid || "",
          submittedDate: submissionDate,
          revealIdentityAfterPublish,
          reviewerPublicName: normalizeFirstLastName(reviewerPublicName),
          rewardEarned: roundTo2(Number(reviewers[targetIndex].rewardEarned || 0) + reviewerReward),
          qualityScore: reviewQualityScore,
          ...myStakeUpdate,
        };
        const settledSession = settleSessionEconomics(normalizedSession, {
          rewardGranted: reviewerReward,
          slashedAmount,
        });
        return { ...settledSession, reviewers };
      }))
    );
    if (hadLockedStake) {
      setReviewValidationError(
        `Quality ${Math.round(reviewQualityScore)}/100. Stake refunded +${formatTokenAmount(refundedAmount)} DST, slashed ${formatTokenAmount(slashedAmount)} DST, reward +${formatTokenAmount(reviewerReward)} DST.`
      );
    } else if (reviewerReward > 0) {
      setReviewValidationError(
        `Quality ${Math.round(reviewQualityScore)}/100. Reviewer reward credited: +${formatTokenAmount(reviewerReward)} DST.`
      );
    }
    setSummary("");
    setStrengths("");
    setWeaknesses("");
    setRequiredChanges("");
    setVote("");
    setRebuttalComment("");
    setRebuttalVote("");
    clearReviewDraft({
      reviewerWalletAddress,
      sessionId: selectedActiveReviewId,
    });
    recordReviewerSubmission(reviewerWalletAddress, { onTime: !wasLateSubmission }).catch(() => {});
    appendAuditEvent(reviewerWalletAddress, {
      eventType: "review_submitted",
      status: "success",
      paperId: targetSession?.paperId || selectedActiveReviewId,
      vote,
      reviewHash,
      phase: "blind_review",
      lateDays,
    });
    appendAuditEvent(reviewerWalletAddress, {
      eventType: "vote",
      status: "success",
      paperId: targetSession?.paperId || selectedActiveReviewId,
      vote,
      phase: "blind_review",
      reviewHash,
      lateDays,
      rewardDst: roundTo2(reviewerReward),
      stakeRefundedDst: roundTo2(refundedAmount),
      stakeSlashedDst: roundTo2(slashedAmount),
      slashDestination: slashedAmount > 0 ? "fee_vault_storage_commission" : null,
    });
    if (reviewerReward > 0) {
      appendAuditEvent(reviewerWalletAddress, {
        eventType: "reward_paid",
        status: "success",
        paperId: targetSession?.paperId || selectedActiveReviewId,
        rewardDst: roundTo2(reviewerReward),
        source: "reviewer_reward_pool",
      });
    }
    showToast("Blind review submitted successfully.");
    setRepTick((prev) => prev + 1);
  };

  const handleSubmitRebuttal = async () => {
    if (!selectedActiveReviewId || !rebuttalComment || !rebuttalVote) return;
    const targetSession = reviewSessions.find((session) => session.id === selectedActiveReviewId);
    const rebuttalGuardError = validateRebuttalSubmission(targetSession, reviewerWalletAddress);
    if (rebuttalGuardError) {
      setReviewValidationError(rebuttalGuardError);
      return;
    }
    const rebuttalHash = buildReviewHash({
      paperId: targetSession?.paperId || selectedActiveReviewId,
      reviewerWallet: reviewerWalletAddress,
      vote: rebuttalVote,
      rebuttalComment,
      phase: "rebuttal",
    });
    if (!rebuttalHash) {
      setReviewValidationError("Rebuttal hash cannot be empty.");
      return;
    }
    try {
      const signatureResult = await requestWalletSignature({
        action: "vote",
        walletAddress: reviewerWalletAddress,
        message: `Submit rebuttal vote ${rebuttalVote} for review ${targetSession?.paperId || selectedActiveReviewId}.`,
      });
      appendAuditEvent(reviewerWalletAddress, {
        eventType: "vote",
        status: "signed",
        paperId: targetSession?.paperId || selectedActiveReviewId,
        vote: rebuttalVote,
        phase: "rebuttal",
        challengeHash: signatureResult.challengeHash,
        rebuttalHash,
      });
    } catch (error) {
      setReviewValidationError(formatWalletActionError(error, "Wallet signature is required to submit vote."));
      appendAuditEvent(reviewerWalletAddress, {
        eventType: "vote",
        status: "failed_signature",
        paperId: targetSession?.paperId || selectedActiveReviewId,
        vote: rebuttalVote,
        phase: "rebuttal",
      });
      return;
    }
    setReviewValidationError("");

    // Pin rebuttal comment to IPFS — required before submitting on-chain.
    let rebuttalCid = "";
    try {
      rebuttalCid = await pinRebuttalToIpfs({
        paperId: targetSession?.paperId || selectedActiveReviewId,
        reviewerWallet: reviewerWalletAddress,
        vote: rebuttalVote,
        rebuttalComment,
        submittedDate: new Date().toISOString().split("T")[0],
        rebuttalHash,
      });
    } catch {
      setReviewValidationError("Failed to pin rebuttal to IPFS. Please check your connection and try again.");
      return;
    }
    if (!rebuttalCid) {
      setReviewValidationError("IPFS returned an empty CID. Please try again.");
      return;
    }

    // Submit rebuttal vote on-chain — reviewer signs via MetaMask.
    // Re-read onChainSessionId fresh (same stale-closure fix as blind review).
    const freshSessionR = loadCanonicalReviewSessions().find((s) => s.id === selectedActiveReviewId);
    let onChainSessionId = freshSessionR?.onChainSessionId || targetSession?.onChainSessionId;
    if (!onChainSessionId && (freshSessionR?.paperId || targetSession?.paperId)) {
      const paperId = freshSessionR?.paperId || targetSession?.paperId;
      const chainSession = await fetchSessionByPaperIdOnChain(paperId).catch(() => null);
      onChainSessionId = chainSession?.sessionId || null;
    }
    if (onChainSessionId) {
      const voteMap = { accept: 1, reject: 2 };
      const voteInt = voteMap[String(rebuttalVote).toLowerCase()];
      if (!voteInt) {
        setReviewValidationError("Invalid rebuttal vote. Please select Accept or Reject.");
        return;
      }
      try {
        await submitReviewOnChain(onChainSessionId, voteInt, rebuttalCid);
      } catch (error) {
        setReviewValidationError(formatWalletActionError(error, "Could not submit rebuttal vote on-chain."));
        return;
      }
    }

    setReviewSessions((prev) =>
      prev.map((session) => {
        if (session.id !== selectedActiveReviewId) return session;
        const reviewers = [...session.reviewers];
        const myIndex = reviewers.findIndex(
          (reviewer) => normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWalletAddress)
        );
        if (myIndex < 0) return session;
        reviewers[myIndex] = {
          ...reviewers[myIndex],
          rebuttalComment,
          rebuttalVote,
          rebuttalHash,
          rebuttalCid,
        };
        return { ...session, reviewers };
      })
    );
    appendAuditEvent(reviewerWalletAddress, {
      eventType: "review_submitted",
      status: "success",
      paperId: targetSession?.paperId || selectedActiveReviewId,
      vote: rebuttalVote,
      phase: "rebuttal",
      rebuttalHash,
      rebuttalCid,
    });
    appendAuditEvent(reviewerWalletAddress, {
      eventType: "vote",
      status: "success",
      paperId: targetSession?.paperId || selectedActiveReviewId,
      vote: rebuttalVote,
      phase: "rebuttal",
      rebuttalHash,
      rebuttalCid,
    });
    showToast("Rebuttal vote submitted successfully.");
    clearReviewDraft({
      reviewerWalletAddress,
      sessionId: selectedActiveReviewId,
    });
    resetReviewForms();
  };

  if (isLoading) {
    return <TabState type="loading" title="Loading review workspace" description="Fetching review sessions." />;
  }

  if (error) {
    return <TabState type="error" title="Could not load review workspace" description={error} />;
  }

  return (
    <div className="space-y-6">
      <SubNav active={subTab} setActive={setSubTab} />
      {joinStakeSessionId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-xl font-semibold text-[#111322]">Stake Tokens to Join</div>
            <p className="mt-2 text-sm text-[#5f657d]">
              Stake amount is fixed by protocol: lower reputation requires higher stake, higher reputation requires lower stake.
            </p>
            <div className="mt-4 rounded-xl bg-[#ececf1] px-4 py-3 text-sm text-[#111322]">
              Available balance: <span className="font-semibold">{formatTokenAmount(tokenomicsState.walletBalance)} DST</span>
            </div>
            <div className="mt-4 rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm text-[#111322]">
              Required stake: <span className="font-semibold">{formatTokenAmount(selectedRequiredStakeAmount)} DST</span>
              <p className="mt-1 text-xs text-[#7a8096]">
                Base {formatTokenAmount(MIN_STAKE_TOKENS)} DST + reputation adjustment (rep {reviewerReputation.reviewerRep})
                {isExplicitHighPriority(selectedStakeSession) ? " + high-priority premium." : "."}
              </p>
              <p className="mt-1 text-xs text-[#7a8096]">
                High-priority papers require reputation {HIGH_PRIORITY_MIN_REPUTATION}+; review access is restricted below {REVIEW_RESTRICTION_THRESHOLD}.
              </p>
            </div>
            {stakeError ? (
              <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{stakeError}</div>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={closeStakeDialog}
                className="rounded-xl border border-[#d7d9e3] bg-white py-2.5 text-sm font-semibold text-[#111322]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmStakeAndJoin}
                className="rounded-xl bg-[#6828ce] py-2.5 text-sm font-semibold text-white hover:bg-[#5a24b4]"
              >
                Confirm Stake
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {subTab === "incoming" && (
        <div className="space-y-4">
          {incomingView === "active" && selectedReviewView ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSelectedActiveReviewId(null)}
                className="inline-flex items-center gap-2 text-xl font-medium text-[#111322]"
              >
                <ArrowLeft className="h-5 w-5" />
                Back to Reviews
              </button>

              <div className="flex items-center justify-between rounded-2xl border-[1px] border-[#d7d9e3] bg-white px-5 py-4">
                <div className="min-w-0">
                  <div className="text-2xl font-semibold text-[#111322]">
                    {selectedReviewView.title}
                  </div>
                  <div className="mt-1 text-base text-[#5f657d]">
                    Phase:{" "}
                    <span className="font-semibold text-[#111322]">
                      {selectedReviewView.phaseLabel}
                    </span>{" "}
                    · <span className="font-semibold text-[#111322]">{selectedReviewView.panelLabel}</span>{" "}
                    · {selectedReviewView.votedLabel} reviews submitted
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isSelectedDecided ? (
                    <span
                      className={[
                        "inline-flex items-center gap-1 rounded-full border px-4 py-2 text-base font-semibold",
                        selectedReviewView.decision === "accepted"
                          ? "border-[#9dd9b8] bg-[#def4e8] text-[#10a452]"
                          : selectedReviewView.decision === "rejected"
                            ? "border-[#f3b1b1] bg-[#fde4e4] text-[#ef4444]"
                            : "border-[#cfd3e1] bg-[#ececf1] text-[#6f748e]",
                      ].join(" ")}
                    >
                      {selectedReviewView.decisionLabel}
                    </span>
                  ) : null}
                  <div className="inline-flex items-center gap-1 rounded-full bg-[#ececf1] px-4 py-2 text-base font-semibold text-[#111322]">
                    <Coins className="h-4 w-4 text-[#6828ce]" />
                    {selectedReviewView.rewardLabel}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-2xl border-[1px] border-[#d7d9e3] bg-white p-4">
                    <span className="rounded-full bg-[#ececf1] px-3 py-1 text-sm font-medium text-[#111322]">
                      {selectedReviewView.field}
                    </span>
                    <div className="mt-4 rounded-2xl border border-dashed border-[#c8cad6] bg-[#f4f4f8] px-8 py-10 text-center">
                      <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ece7f8]">
                        <FileText className="h-7 w-7 text-[#6828ce]" />
                      </div>
                      <div className="mt-3 text-base font-semibold text-[#111322]">Manuscript PDF</div>
                      <p className="mt-1 text-sm text-[#7b8099]">Opens in the Pinata gateway in a new tab.</p>
                      <button
                        type="button"
                        onClick={() => handleViewPaper(selectedReviewView)}
                        disabled={viewingPaperSessionId === selectedReviewView.id}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#6828ce] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#5a24b4] disabled:opacity-60"
                      >
                        <FileText className="h-4 w-4" />
                        {viewingPaperSessionId === selectedReviewView.id ? "Loading…" : "View PDF"}
                      </button>
                    </div>
                    <p className="mt-4 text-[17px] leading-relaxed text-[#5f657d]">
                      {selectedReviewView.abstract}
                    </p>
                  </div>

                  <div className="rounded-2xl border-[1px] border-[#d7d9e3] bg-white p-4">
                    <div className="mb-3 text-2xl font-semibold text-[#111322]">
                      Reviewer Panel
                    </div>
                    <div className="space-y-2">
                      {selectedReviewView.panel?.map((row) => (
                        <div
                          key={row.slot}
                          className="flex items-center justify-between rounded-xl border-[1px] border-[#d7d9e3] bg-[#ececf1] px-4 py-3"
                        >
                          <div className="inline-flex min-w-0 items-center gap-3">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#ece7f8] text-sm font-semibold text-[#6828ce]">
                              {row.slot}
                            </span>
                            <span
                              className="max-w-[320px] truncate text-xl text-[#111322]"
                              title={row.reviewer}
                            >
                              {formatReviewerLabel(row.reviewer)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {row.stakeAmount > 0 ? (
                              <span
                                className={[
                                  "whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold",
                                  row.stakeStatus === "slashed"
                                    ? "bg-red-100 text-red-700"
                                    : row.stakeStatus === "partial_slashed"
                                      ? "bg-[#fff2df] text-[#d68000]"
                                    : row.stakeStatus === "returned"
                                      ? "bg-green-100 text-green-700"
                                      : "bg-[#ece7f8] text-[#6828ce]",
                                ].join(" ")}
                              >
                                Stake {formatTokenAmount(row.stakeAmount)} DST ({formatStakeStatus(row.stakeStatus)})
                              </span>
                            ) : null}
                            {isSelectedRebuttal || isSelectedDecided ? (
                              <VotePill vote={row.vote} />
                            ) : (
                              <span className="text-base text-[#5f657d]">{row.status}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(isSelectedRebuttal || isSelectedDecided) && (
                    <div className="rounded-2xl border-[1px] border-[#d7d9e3] bg-white p-4">
                      <div className="mb-3 inline-flex items-center gap-2 text-2xl font-semibold text-[#111322]">
                        <Eye className="h-5 w-5 text-[#6828ce]" />
                        {isSelectedRebuttal ? "Reviews Revealed - Rebuttal Phase" : "All Reviews"}
                      </div>
                      <div className="space-y-3">
                        {selectedReviewView.revealedReviews?.map((review) => (
                          <div key={review.reviewer} className="rounded-xl border-[1px] border-[#d7d9e3] bg-[#ececf1] p-4">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xl font-semibold text-[#111322]">{review.reviewer}</div>
                              <VotePill vote={review.vote} />
                            </div>
                            <div className="space-y-1 text-[17px]">
                              <p><span className="text-[#5f657d]">Summary:</span> {review.summary}</p>
                              <p><span className="text-[#5f657d]">Strengths:</span> {review.strengths}</p>
                              <p><span className="text-[#5f657d]">Weaknesses:</span> {review.weaknesses}</p>
                              <p><span className="text-[#5f657d]">Required Changes:</span> {review.changes}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="self-start rounded-2xl border-[1px] border-[#d7d9e3] bg-white p-4">
                  {isSelectedRebuttal ? (
                    <>
                      <div className="inline-flex items-center gap-2 text-2xl font-semibold text-[#111322]">
                        <MessageSquare className="h-5 w-5 text-[#6828ce]" />
                        Rebuttal Phase
                      </div>
                      <p className="mt-2 text-sm text-[#5f657d]">
                        Initial votes and comments are now visible to the reviewer panel. In rebuttal, each reviewer must
                        switch to a final binary decision: accept or reject.
                      </p>
                      <div className="mt-4 rounded-xl border border-[#a487df] bg-[#ece7f8] p-4">
                        <div className="text-sm text-[#5f657d]">Your original vote</div>
                        <div className="mt-2"><VotePill vote={mySlot?.vote} /></div>
                      </div>
                      <div className="mt-4">
                        <label className="mb-1 block text-sm font-semibold text-[#111322]">Rebuttal Comment</label>
                        <textarea
                          value={rebuttalComment}
                          onChange={(e) => {
                            setRebuttalComment(e.target.value);
                            setReviewValidationError("");
                          }}
                          className="w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none"
                          rows={3}
                          placeholder="Explain whether the revealed panel feedback changes your decision..."
                        />
                      </div>
                      <div className="mt-4">
                        <div className="mb-2 text-xl font-semibold text-[#111322]">Choose Rebuttal Vote</div>
                        <div className="space-y-2 text-xl">
                          <label className="flex items-center gap-2"><input type="radio" name="rebuttalVote" checked={rebuttalVote === "accept"} onChange={() => setRebuttalVote("accept")} /><CircleCheck className="h-4 w-4 text-[#1ab25f]" />Accept</label>
                          <label className="flex items-center gap-2"><input type="radio" name="rebuttalVote" checked={rebuttalVote === "reject"} onChange={() => setRebuttalVote("reject")} /><XCircle className="h-4 w-4 text-[#ef4444]" />Reject</label>
                        </div>
                        <button
                          type="button"
                          onClick={handleSubmitRebuttal}
                          disabled={!rebuttalComment || !rebuttalVote}
                          className={[
                            "mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white",
                            rebuttalComment && rebuttalVote
                              ? "bg-[#6828ce] hover:bg-[#5a24b4]"
                              : "bg-[#a487df] cursor-not-allowed",
                          ].join(" ")}
                        >
                          <span className="inline-flex items-center gap-2"><Send className="h-4 w-4" />Submit Rebuttal</span>
                        </button>
                        {reviewValidationError ? (
                          <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                            {reviewValidationError}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : isSelectedDecided ? (
                    <div className="p-8 text-center space-y-3">
                      <div className={["mx-auto flex h-14 w-14 items-center justify-center rounded-full", getDecisionToneClass(selectedReviewView.decision)].join(" ")}>
                        {renderDecisionIcon(selectedReviewView.decision)}
                      </div>
                      <div className="text-lg font-bold text-[#111322] capitalize">Paper {selectedReviewView.decisionLabel}</div>
                      <p className="text-sm text-[#5f657d]">{getDecisionSummary(selectedReviewView.decision)}</p>
                      {selectedReviewView.protocolStatusLabel ? (
                        <div className="rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm font-medium text-[#111322]">
                          {selectedReviewView.protocolStatusLabel}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setSelectedActiveReviewId(null)}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-[#6828ce] px-4 py-2 text-sm font-medium text-white hover:bg-[#5a24b4]"
                      >
                        Back to Reviews
                      </button>
                    </div>
                  ) : hasSubmitted ? (
                    <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
                      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#ece7f8]">
                        <EyeOff className="h-10 w-10 text-[#6828ce]" />
                      </div>
                      <div className="text-3xl font-semibold text-[#111322]">Review Submitted</div>
                      <p className="mt-3 text-lg text-[#5f657d]">
                        Waiting for other reviewers ({submittedCount}/3 submitted). Each reviewer submits their vote independently — the final decision is made once all 3 votes are in.
                      </p>
                      {mySlot?.stakedTokens ? (
                        <p className="mt-3 text-sm text-[#5f657d]">
                          Stake status:{" "}
                          <span className="font-semibold capitalize text-[#111322]">
                            {formatStakeStatus(mySlot.stakeStatus || "locked")}
                          </span>{" "}
                          ({formatTokenAmount(mySlot.stakedTokens)} DST)
                        </p>
                      ) : null}
                      {mySlot?.stakeNote ? (
                        <div className="mt-3 rounded-xl border border-[#f2c47d] bg-[#fff2df] px-4 py-3 text-sm text-[#8a5a00]">
                          {mySlot.stakeNote}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="inline-flex items-center gap-2 text-2xl font-semibold text-[#111322]">
                        <EyeOff className="h-5 w-5 text-[#6828ce]" />
                        Submit Blind Review
                      </div>
                      <p className="mt-2 text-sm text-[#5f657d]">
                        Your review stays hidden from other reviewers until the blind-review stage resolves. Each reviewer submits their own vote — the outcome is determined once all 3 votes are in.
                      </p>
                      {mySlot?.stakedTokens ? (
                        <div className="mt-3 rounded-xl bg-[#ececf1] px-4 py-3 text-sm text-[#111322]">
                          Staked: {formatTokenAmount(mySlot.stakedTokens)} DST
                          {" · "}
                          Status: <span className="font-semibold capitalize">{formatStakeStatus(mySlot.stakeStatus || "locked")}</span>
                        </div>
                      ) : null}
                      {mySlot?.stakeNote ? (
                        <div className="mt-3 rounded-xl border border-[#f2c47d] bg-[#fff2df] px-4 py-3 text-sm text-[#8a5a00]">
                          {mySlot.stakeNote}
                        </div>
                      ) : null}
                      <div className="mt-4 space-y-3">
                        <div><label className="mb-1 block text-sm font-semibold text-[#111322]">Summary</label><textarea value={summary} onChange={(e) => { setSummary(e.target.value); setReviewValidationError(""); }} className="w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none" rows={2} placeholder="Brief summary of the paper..." /></div>
                        <div><label className="mb-1 block text-sm font-semibold text-[#111322]">Strengths</label><textarea value={strengths} onChange={(e) => { setStrengths(e.target.value); setReviewValidationError(""); }} className="w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none" rows={2} placeholder="Key strengths..." /></div>
                        <div><label className="mb-1 block text-sm font-semibold text-[#111322]">Weaknesses</label><textarea value={weaknesses} onChange={(e) => { setWeaknesses(e.target.value); setReviewValidationError(""); }} className="w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none" rows={2} placeholder="Areas needing improvement..." /></div>
                        <div><label className="mb-1 block text-sm font-semibold text-[#111322]">Required Changes</label><textarea value={requiredChanges} onChange={(e) => { setRequiredChanges(e.target.value); setReviewValidationError(""); }} className="w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none" rows={2} placeholder="Specific changes needed..." /></div>
                      </div>
                      <div className="mt-4 border-t border-[#e5e6ec] pt-4">
                        <div className="mb-2 text-xl font-semibold text-[#111322]">Your Vote</div>
                        {assignments.find((a) => a.paperId === selectedActiveReview?.paperId)?.isTiebreaker ? (
                          <div className="mb-3 rounded-xl border border-[#f2c47d] bg-[#fff2df] px-4 py-3 text-sm text-[#8a5a00]">
                            Tie-breaker vote: cast accept or reject only to resolve the deadlocked panel.
                          </div>
                        ) : null}
                        <div className="space-y-2 text-xl">
                          <label className="flex items-center gap-2"><input type="radio" name="vote" checked={vote === "accept"} onChange={() => setVote("accept")} /><CircleCheck className="h-4 w-4 text-[#1ab25f]" />Accept</label>
                          {!assignments.find((a) => a.paperId === selectedActiveReview?.paperId)?.isTiebreaker ? (
                            <label className="flex items-center gap-2"><input type="radio" name="vote" checked={vote === "neutral"} onChange={() => setVote("neutral")} /><MinusCircle className="h-4 w-4 text-[#f59e0b]" />Neutral</label>
                          ) : null}
                          <label className="flex items-center gap-2"><input type="radio" name="vote" checked={vote === "reject"} onChange={() => setVote("reject")} /><XCircle className="h-4 w-4 text-[#ef4444]" />Reject</label>
                        </div>
                        <div className="mt-4 rounded-xl border border-[#d7d9e3] bg-[#f8f8fb] p-3">
                          <label className="inline-flex items-center gap-2 text-sm text-[#111322]">
                            <input
                              type="checkbox"
                              checked={revealIdentityAfterPublish}
                              onChange={(e) => setRevealIdentityAfterPublish(e.target.checked)}
                            />
                            Reveal my identity after official publication
                          </label>
                          {revealIdentityAfterPublish ? (
                            <input
                              value={reviewerPublicName}
                              onChange={(e) => setReviewerPublicName(e.target.value)}
                              placeholder="Reviewer display name"
                              className="mt-2 w-full rounded-lg border border-[#d7d9e3] bg-white px-3 py-2 text-sm outline-none"
                            />
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={handleSubmitBlindReview}
                          disabled={!summary || !vote}
                          className={[
                            "mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white",
                            summary && vote
                              ? "bg-[#6828ce] hover:bg-[#5a24b4]"
                              : "bg-[#a487df] cursor-not-allowed",
                          ].join(" ")}
                        >
                          <span className="inline-flex items-center gap-2"><Send className="h-4 w-4" />Submit Blind Review</span>
                        </button>
                        {reviewValidationError ? (
                          <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                            {reviewValidationError}
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-3xl font-bold text-[#111322]">
                  Your Review Assignments
                </h3>
                <p className="mt-1 text-sm text-[#7b8099]">
                  Papers are assigned to you by the system. Accept to stake DST and begin reviewing. Decline to pass the assignment to another reviewer.
                </p>
              </div>

              <div className="inline-flex rounded-xl bg-[#ebebef] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setIncomingView("available");
                    setSelectedActiveReviewId(null);
                  }}
                  className={[
                    "rounded-lg px-5 py-2 text-base font-semibold transition",
                    incomingView === "available"
                      ? "bg-white text-[#111322] shadow-sm"
                      : "text-[#5f657d]",
                  ].join(" ")}
                >
                  Assignments ({assignments.filter((a) => a.status === "pending").length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIncomingView("active");
                    setSelectedActiveReviewId(null);
                  }}
                  className={[
                    "rounded-lg px-5 py-2 text-base font-semibold transition",
                    incomingView === "active"
                      ? "bg-white text-[#111322] shadow-sm"
                      : "text-[#5f657d]",
                  ].join(" ")}
                >
                  My Active Reviews ({activeSessions.length})
                </button>
              </div>

              {incomingView === "available" &&
                assignments.filter((a) => a.status === "pending").map((assignment) => {
                  const assignedDate = new Date(assignment.assignedAt).toLocaleDateString();
                  const deadlineDate = new Date(assignment.expiresAt).toLocaleDateString();
                  const remainingMs = assignment.expiresAt - Date.now();
                  const remainingDays = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60 * 24)));
                  const cooldownSecs = acceptCooldowns[assignment.paperId] || 0;
                  return (
                    <div
                      key={assignment.paperId}
                      className="rounded-2xl border border-[#d9dbe5] bg-white p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xl font-semibold text-[#111322]">
                              {assignment.paperTitle || `Paper ${assignment.paperId.slice(0, 10)}…`}
                            </span>
                            {assignment.isTiebreaker ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#f2c47d] bg-[#fff2df] px-3 py-1 text-xs font-semibold text-[#d68000]">
                                Tie-Breaker Review
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[#5f657d]">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              Assigned {assignedDate}
                            </span>
                            <span className={["inline-flex items-center gap-1", deadlineColor(remainingDays)].join(" ")}>
                              <Clock3 className="h-4 w-4" />
                              Accept by {deadlineDate} ({remainingDays}d left)
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDeclineAssignment(assignment.paperId)}
                            className="rounded-xl border border-[#d7d9e3] bg-white px-4 py-2 text-sm font-semibold text-[#5f657d] hover:bg-[#f5f5f8]"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAcceptAssignment(assignment.paperId, assignment.paperTitle)}
                            disabled={cooldownSecs > 0}
                            className={[
                              "rounded-xl px-5 py-2 text-sm font-semibold text-white",
                              cooldownSecs > 0
                                ? "cursor-not-allowed bg-[#a487df]"
                                : "bg-[#6828ce] hover:bg-[#5a24b4]",
                            ].join(" ")}
                          >
                            {cooldownSecs > 0 ? `Wait ${cooldownSecs}s` : "Accept"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

              {incomingView === "available" && assignments.filter((a) => a.status === "pending").length === 0 && (
                <TabState type="empty" title="No papers assigned for review at this time." className="py-12" />
              )}

              {incomingView === "active" &&
                activeSessions.map((session) => {
                  const days = daysLeft(session.deadline);
                  const submitted = session.reviewers.filter((r) => r.vote !== null).length;
                  const needsAttention = needsReviewerAttention(session);
                  const isHighPriority = isExplicitHighPriority(session);
                  const rewardLabel = formatReviewerRewardLabel(session);
                  const mySessionAssignment = assignments.find((a) => a.paperId === session.paperId);
                  const isTiebreakerSession = mySessionAssignment?.isTiebreaker || false;
                  return (
                  <div key={session.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedActiveReviewId(session.id)}
                      className="w-full rounded-2xl border border-[#d9dbe5] bg-white p-5 text-left"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div
                              className={[
                                "text-xl font-semibold",
                                needsAttention ? "text-[#d68000]" : "text-[#111322]",
                              ].join(" ")}
                            >
                              {session.title}
                            </div>
                            {isTiebreakerSession ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#f2c47d] bg-[#fff2df] px-3 py-1 text-xs font-semibold text-[#d68000]">
                                Tie-Breaker Review
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-base text-[#5f657d]">
                            <span
                              className={[
                                "rounded-full px-3 py-1 text-sm font-medium",
                                phaseBadgeClass(session.phase),
                              ].join(" ")}
                            >
                              {phaseLabel(session.phase)}
                            </span>
                            {session.reminderLevel && session.reminderLevel !== "none" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff2df] px-3 py-1 text-xs font-semibold text-[#d68000]">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {formatReminderLabel(session.reminderDays)}
                              </span>
                            ) : null}
                            {getResolutionReasonLabel(session.resolutionReason) ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#ece7f8] px-3 py-1 text-xs font-semibold text-[#6828ce]">
                                {getResolutionReasonLabel(session.resolutionReason)}
                              </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {submitted}/3 voted
                            </span>
                            <span className={["inline-flex items-center gap-1", deadlineColor(days)].join(" ")}>
                              <Clock3 className="h-4 w-4" />
                              {days}d left
                            </span>
                            {isHighPriority ? (
                              <span className="inline-flex animate-pulse items-center gap-1 rounded-full border border-[#f2c47d] bg-[#fff2df] px-3 py-1 text-xs font-semibold text-[#d68000] shadow-sm">
                                High Priority
                              </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1">
                              <Coins className="h-4 w-4 text-[#6828ce]" />
                              {rewardLabel}
                            </span>
                          </div>
                        </div>
                        <ArrowRight className="h-5 w-5 text-[#6b7189]" />
                      </div>
                    </button>
                    <div className="mt-2 flex justify-end px-1">
                      <button
                        type="button"
                        onClick={() => handleViewPaper(session)}
                        disabled={viewingPaperSessionId === session.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#ece7f8] px-3 py-1.5 text-xs font-semibold text-[#6828ce] hover:bg-[#dcd5f5] disabled:opacity-50"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {viewingPaperSessionId === session.id ? "Loading..." : "View Paper"}
                      </button>
                    </div>
                  </div>
                );
              })}

              {incomingView === "active" && activeSessions.length === 0 && (
                <TabState type="empty" title="No active reviews" className="py-12" />
              )}
            </>
          )}
        </div>
      )}

      {subTab === "completed" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-3xl font-bold text-[#111322]">Completed Reviews</h3>
            <p className="mt-1 text-sm text-[#7b8099]">Your review history and payments</p>
          </div>
          <div className="space-y-4">
            {completed.length === 0 ? (
              <TabState type="empty" title="No completed reviews yet" className="py-12" />
            ) : null}
            {completed.map((c) => (
              <div
                key={c.id}
                className="rounded-2xl border border-[#d9dbe5] bg-white p-5 shadow-none"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold text-[#2b2333]">
                      {c.title}
                    </div>
                    <div className="mt-1 text-sm text-[#6b5d78]">
                      Author:{" "}
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-mono ring-1 ring-black/5">
                        {c.author}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-5 text-sm text-[#6b5d78]">
                      <span className="inline-flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Completed: {c.date}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Star className="h-4 w-4 text-yellow-500" />
                        Rating: {formatRating(c.rating)}
                      </span>
                      <span className="inline-flex items-center gap-2 font-semibold text-[#6828ce]">
                        {formatTokenAmount(c.tokens)} DST
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-3">
                    <StatusPill status={c.tokens > 0 ? "paid" : "accepted"} />
                    <button
                      type="button"
                      onClick={() =>
                        setOpenCompletedReviewId((prev) => (prev === c.id ? null : c.id))
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-[#d7d9e3] bg-white px-4 py-2 text-sm font-semibold text-[#111322] hover:bg-[#f4f4f8]"
                    >
                      <FileText className="h-4 w-4" />
                      {openCompletedReviewId === c.id ? "Hide Review" : "View Review"}
                    </button>
                  </div>
                </div>

                {openCompletedReviewId === c.id ? (
                  <div className="mt-4 rounded-xl border border-[#e5e6ec] bg-[#f8f8fb] p-4 text-sm text-[#2f3346]">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#7b8099]">
                      <span className="rounded-full bg-white px-3 py-1 ring-1 ring-black/5">
                        Paper ID: {c.paperId || "-"}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 ring-1 ring-black/5">
                        Vote: {voteLabel(c.vote)}
                      </span>
                      {c.decision ? (
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-black/5">
                          Final decision: {toDisplayDecision(c.decision)}
                        </span>
                      ) : null}
                      {getResolutionReasonLabel(c.resolutionReason) ? (
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-black/5">
                          {getResolutionReasonLabel(c.resolutionReason)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4 space-y-3">
                      <div>
                        <p className="mb-1 text-xs font-semibold text-[#7b8099]">Summary</p>
                        <p>{c.summary || "-"}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-[#7b8099]">Strengths</p>
                        <p>{c.strengths || "-"}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-[#7b8099]">Weaknesses</p>
                        <p>{c.weaknesses || "-"}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-[#7b8099]">Required Changes</p>
                        <p>{c.requiredChanges || "-"}</p>
                      </div>
                      {c.rebuttalComment ? (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-[#7b8099]">Rebuttal Comment</p>
                          <p>{c.rebuttalComment}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function normalizeWallet(wallet) {
  return String(wallet || "").trim().toLowerCase();
}

function normalizeFirstLastName(rawName) {
  const parts = (rawName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function isOwnAuthorSession(session, reviewerWallet) {
  if (!session) return false;
  const authorWallet = normalizeWallet(session.authorWallet);
  const reviewerWalletValue = normalizeWallet(reviewerWallet);
  return Boolean(authorWallet) && authorWallet === reviewerWalletValue;
}

function formatReviewerLabel(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "unassigned") return "Unassigned";
  if (raw.includes("...")) return raw;
  if (raw.startsWith("0x") && raw.length > 16) {
    return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
  }
  return raw;
}

function voteLabel(vote) {
  const normalized = String(vote || "").toLowerCase();
  if (normalized === "accept") return "Accepted";
  if (normalized === "reject") return "Rejected";
  if (normalized === "neutral") return "Neutral";
  return "Pending";
}

function buildReviewHash(payload) {
  const raw = JSON.stringify(payload || {});
  if (!raw || raw === "{}") return "";
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
  }
  return `rvw_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validateReviewAcceptance(session, reviewerWallet, walletBalance, requiredStakeAmount, reviewerRep) {
  if (requiredStakeAmount > walletBalance) {
    return "Not enough tokens, please top up.";
  }
  if (!session) {
    return "Cannot accept review for a non-existent paper.";
  }
  if ((session.phase !== "blind_review" && session.phase !== "replacement_review") || session.decision) {
    return "Review acceptance is not open for this paper right now.";
  }
  if (isPastDeadline(session.deadline)) {
    return "This review request has passed its deadline and is no longer available.";
  }
  if (isOwnAuthorSession(session, reviewerWallet)) {
    return "You cannot review your own paper.";
  }
  if (hasConflictOfInterest(session, reviewerWallet)) {
    return "Conflict of interest: you cannot review this paper.";
  }
  const eligibility = getReviewerEligibility(reviewerRep, {
    highPriority: isExplicitHighPriority(session),
  });
  if (!eligibility.allowed) {
    return eligibility.reason;
  }
  const myWallet = normalizeWallet(reviewerWallet);
  const mySlot = session.reviewers.find(
    (r) => normalizeWallet(r.reviewerWallet) === myWallet
  );

  // Pre-assigned flow: reviewer already has a slot on-chain.
  // Skip the open-slot requirement — they just need to stake and confirm.
  if (mySlot) {
    if (mySlot.accepted === true || mySlot.requestStatus === "accepted") {
      return "You have already accepted this review.";
    }
    return "";
  }

  // Self-select flow: reviewer must claim an open slot.
  if (!session.reviewers.some((reviewer) => isOpenReviewRequest(reviewer))) {
    return "No reviewer slot is available for this paper.";
  }
  const filledWallets = session.reviewers
    .map((reviewer) => normalizeWallet(reviewer.reviewerWallet))
    .filter(Boolean);
  if (new Set([...filledWallets, myWallet]).size !== filledWallets.length + 1) {
    return "Reviewers must be independent and unique.";
  }
  return "";
}

function validateBlindReviewSubmission(session, reviewerWallet) {
  if (!session) return "Cannot submit a review for a non-existent paper.";
  if (session.phase === "decided") return "This paper has already been finalized.";
  if (session.phase !== "blind_review") return "Blind review submission is closed for this paper.";
  const mySlot = session.reviewers.find(
    (reviewer) => normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWallet)
  );
  if (!mySlot) return "You are not authorized to submit a review for this paper.";
  if (mySlot.accepted !== true && mySlot.requestStatus !== "accepted") {
    return "You must accept the review request before submitting.";
  }
  if (mySlot.vote) return "Blind review has already been submitted for this reviewer slot.";
  return "";
}

function validateRebuttalSubmission(session, reviewerWallet) {
  if (!session) return "Cannot submit a rebuttal for a non-existent paper.";
  if (session.phase === "decided") return "This paper has already been finalized.";
  if (session.phase !== "rebuttal") return "Rebuttal voting is not open for this paper.";
  const mySlot = session.reviewers.find(
    (reviewer) => normalizeWallet(reviewer.reviewerWallet) === normalizeWallet(reviewerWallet)
  );
  if (!mySlot) return "You are not authorized to submit a rebuttal for this paper.";
  if (mySlot.rebuttalVote) return "Rebuttal vote has already been submitted for this reviewer slot.";
  return "";
}

function formatStakeStatus(value) {
  const normalized = String(value || "locked").toLowerCase();
  if (normalized === "slashed") return "Slashed";
  if (normalized === "partial_slashed") return "Partially Slashed";
  if (normalized === "returned") return "Returned";
  if (normalized === "locked") return "Locked";
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : "Locked";
}

function formatReviewerSlotStatus(slot) {
  if (slot?.rebuttalVote) return "Rebuttal Submitted";
  if (slot?.vote) return "Submitted";
  if (slot?.requestStatus === "accepted") return "Accepted";
  if (slot?.requestStatus === "requested" && slot?.requestExpiresOn) return `Requested until ${slot.requestExpiresOn}`;
  if (slot?.requestStatus === "expired") return "Request Expired";
  if (slot?.requestStatus === "replaced") return "Replaced";
  if (slot?.requestStatus === "no_show") return "No Show";
  return "Requested";
}

function voteToRating(vote) {
  const normalized = String(vote || "").toLowerCase();
  if (normalized === "accept") return 4.5;
  if (normalized === "neutral") return 3.0;
  if (normalized === "reject") return 2.0;
  return 0;
}

function ensureSessionFunding(session) {
  const reservedRewardPool = roundTo2(Number(session?.reservedRewardPoolDst ?? session?.tokenReward ?? 0));
  const rewardPaid = roundTo2(Number(session?.rewardPaidDst || 0));
  const rewardPoolRemaining = roundTo2(
    Math.max(0, Number(session?.rewardPoolRemainingDst ?? reservedRewardPool - rewardPaid))
  );
  return {
    ...session,
    reservedRewardPoolDst: reservedRewardPool,
    rewardPaidDst: rewardPaid,
    rewardPoolRemainingDst: rewardPoolRemaining,
    slashedStakeTreasuryDst: roundTo2(Number(session?.slashedStakeTreasuryDst || 0)),
  };
}

function getSessionPerReviewerBaseReward(session) {
  const normalizedSession = ensureSessionFunding(session);
  const totalReward = Number(normalizedSession.reservedRewardPoolDst || 0);
  if (Number.isFinite(totalReward) && totalReward > 0) {
    return roundTo2(totalReward / 3);
  }
  return 0;
}

function getDisplayedReviewerReward(session) {
  const baseReward = roundTo2(Number(session?.tokenReward || 0));
  const priorityBonus = roundTo2(Number(session?.priorityFeePaidDst || 0));
  return {
    totalReward: roundTo2(baseReward + priorityBonus),
    priorityBonus,
  };
}

function formatReviewerRewardLabel(session) {
  const { totalReward, priorityBonus } = getDisplayedReviewerReward(session);
  if (priorityBonus > 0) {
    return `${formatTokenAmount(totalReward)} DST reward (+${formatTokenAmount(priorityBonus)} DST priority bonus)`;
  }
  return `${formatTokenAmount(totalReward)} DST reward`;
}

function getSessionRewardPoolRemaining(session) {
  return ensureSessionFunding(session).rewardPoolRemainingDst;
}

function settleSessionEconomics(session, options = {}) {
  const normalizedSession = ensureSessionFunding(session);
  const rewardGranted = roundTo2(Number(options.rewardGranted || 0));
  const slashedAmount = roundTo2(Number(options.slashedAmount || 0));
  return {
    ...normalizedSession,
    rewardPaidDst: roundTo2(normalizedSession.rewardPaidDst + rewardGranted),
    rewardPoolRemainingDst: roundTo2(Math.max(0, normalizedSession.rewardPoolRemainingDst - rewardGranted)),
    slashedStakeTreasuryDst: roundTo2(normalizedSession.slashedStakeTreasuryDst + slashedAmount),
  };
}

function finalizeSession(session, decision, resolutionReason = "") {
  if (session?.phase === "decided") {
    return ensureSessionFunding(session);
  }
  return {
    ...ensureSessionFunding(session),
    phase: "decided",
    decision,
    resolutionReason,
  };
}

function computeStakeSlashing(stakeAmount, lateDays, options = {}) {
  const stake = roundTo2(Number(stakeAmount || 0));
  const daysLate = Math.max(0, Number(lateDays || 0));
  const acceptedNoShow = Boolean(options.acceptedNoShow);
  const baseRate = Math.max(0, Math.min(1, daysLate * 0.1));
  const slashingRate = acceptedNoShow
    ? Math.max(ACCEPTED_NO_SHOW_MIN_SLASH_RATE, Math.min(1, baseRate * 1.5))
    : baseRate;
  const slashedAmount = roundTo2(stake * slashingRate);
  const refundedAmount = roundTo2(Math.max(0, stake - slashedAmount));
  const status = slashingRate <= 0 ? "returned" : slashingRate >= 1 ? "slashed" : "partial_slashed";
  return { slashingRate, slashedAmount, refundedAmount, status };
}

function computeReviewQualityScore({ summary, strengths, weaknesses, requiredChanges, vote, field }) {
  const safeLength = (value) => String(value || "").trim().length;
  const totalLength =
    safeLength(summary) + safeLength(strengths) + safeLength(weaknesses) + safeLength(requiredChanges);
  const contentScore = Math.min(70, totalLength / 12);
  const voteScore = vote === "neutral" ? 10 : vote === "accept" || vote === "reject" ? 18 : 0;
  const fieldBonus = String(field || "").toLowerCase().includes("security") ? 4 : 0;
  return roundTo2(Math.max(0, Math.min(100, contentScore + voteScore + fieldBonus + 8)));
}

function computeReviewerRewardAmount({ baseReward, qualityScore, lateDays, rewardCap }) {
  const normalizedBaseReward = roundTo2(Number(baseReward || 0));
  const normalizedRewardCap = roundTo2(Math.max(0, Number(rewardCap ?? normalizedBaseReward)));
  const normalizedQuality = Math.max(0, Math.min(100, Number(qualityScore || 0)));
  const normalizedLateDays = Math.max(0, Number(lateDays || 0));
  const effectiveBaseReward = roundTo2(Math.min(normalizedBaseReward, normalizedRewardCap));
  const qualityMultiplier = roundTo2(0.4 + (normalizedQuality / 100) * 0.6);
  const latenessMultiplier =
    normalizedLateDays <= 0
      ? 1
      : normalizedLateDays <= 1
        ? 0.85
        : normalizedLateDays <= 3
          ? 0.65
          : normalizedLateDays <= 7
            ? 0.35
            : 0;
  return roundTo2(
    Math.min(normalizedRewardCap, effectiveBaseReward * qualityMultiplier * latenessMultiplier)
  );
}

function offsetIsoDate(days) {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() + Number(days || 0));
  return utc.toISOString().slice(0, 10);
}

function buildLiveChainSession(onChain, slots = [], paperTitle = "") {
  const phaseMap = { 0: "pending", 1: "blind_review", 2: "rebuttal", 3: "replacement_review", 4: "decided" };
  const decisionMap = { 0: "", 1: "accepted", 2: "rejected", 3: "revision_requested", 4: "abandoned" };
  const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
  const deadlineDate = Number(onChain?.deadline || 0) > 0
    ? new Date(Number(onChain.deadline) * 1000).toISOString().slice(0, 10)
    : offsetIsoDate(14);

  return {
    id: `chain-${onChain.sessionId}-${String(onChain.paperId || "").slice(2, 10)}`,
    paperId: onChain.paperId,
    title: paperTitle || `Paper ${String(onChain.paperId || "").slice(0, 10)}...`,
    deadline: deadlineDate,
    authorWallet: "",
    phase: onChain.finalized ? "decided" : (phaseMap[Number(onChain.phase)] || "blind_review"),
    decision: decisionMap[Number(onChain.decision)] || "",
    finalized: Boolean(onChain.finalized),
    highPriority: Boolean(onChain.highPriority),
    onChainSessionId: Number(onChain.sessionId),
    rebuttalCid: onChain.rebuttalCid || "",
    reviewers: (slots || []).map((slot, index) => ({
      id: `${onChain.paperId}-slot-${index + 1}`,
      reviewerWallet: slot.reviewer && slot.reviewer !== NULL_ADDRESS ? slot.reviewer : null,
      requestStatus: slot.accepted ? "accepted" : "requested",
      accepted: Boolean(slot.accepted),
      declined: Boolean(slot.declined),
      submitted: Boolean(slot.submitted),
      vote: slot.submitted ? slot.vote : null,
      reviewCid: slot.reviewCid || "",
      rebuttalVote: slot.rebuttalSubmitted ? slot.rebuttalVote : null,
      rebuttalCid: slot.rebuttalCid || "",
      requestOpenedOn: offsetIsoDate(0),
      requestExpiresOn: deadlineDate,
      requestRound: 1,
      stakedTokens: 0,
      stakeStatus: "none",
    })),
  };
}

function resetReviewerForNextCycle(reviewer) {
  return {
    ...reviewer,
    vote: null,
    summary: "",
    strengths: "",
    weaknesses: "",
    requiredChanges: "",
    submittedDate: null,
    rebuttalComment: "",
    rebuttalVote: null,
  };
}

function isOpenReviewRequest(reviewer) {
  return !normalizeWallet(reviewer?.reviewerWallet) && reviewer?.requestStatus !== "replaced";
}

function normalizeReviewerSlot(slot) {
  if (normalizeWallet(slot?.reviewerWallet)) {
    return {
      ...slot,
      requestStatus: slot?.requestStatus || "accepted",
      acceptedAt: slot?.acceptedAt || slot?.stakeJoinedAt || slot?.submittedDate || offsetIsoDate(0),
      requestRound: Number(slot?.requestRound || 1),
    };
  }

  return {
    ...slot,
    reviewerWallet: null,
    requestStatus: slot?.requestStatus || "requested",
    requestOpenedOn: slot?.requestOpenedOn || offsetIsoDate(0),
    requestExpiresOn: slot?.requestExpiresOn || offsetIsoDate(REVIEW_REQUEST_WINDOW_DAYS),
    requestRound: Number(slot?.requestRound || 1),
  };
}

function openReplacementRequest(slot, reason = "replacement_opened") {
  return {
    ...resetReviewerForNextCycle({
      ...slot,
      reviewerWallet: null,
      stakedTokens: 0,
      stakeStatus: "none",
      stakeJoinedAt: null,
      rewardEarned: 0,
      requestStatus: "requested",
      requestOpenedOn: offsetIsoDate(0),
      requestExpiresOn: offsetIsoDate(REVIEW_REQUEST_WINDOW_DAYS),
      requestRound: Number(slot?.requestRound || 1) + 1,
      lastReplacementReason: reason,
    }),
  };
}

function hasConflictOfInterest(session, wallet) {
  const reviewerWallet = normalizeWallet(wallet);
  if (!reviewerWallet) return false;
  const conflictedWallets = new Set(
    [session?.authorWallet, ...(Array.isArray(session?.conflictOfInterestWallets) ? session.conflictOfInterestWallets : [])]
      .map((entry) => normalizeWallet(entry))
      .filter(Boolean)
  );
  return conflictedWallets.has(reviewerWallet);
}

function hasValidIndependentPanel(session) {
  if (!session || !Array.isArray(session.reviewers) || session.reviewers.length !== 3) return false;
  const wallets = session.reviewers.map((reviewer) => normalizeWallet(reviewer.reviewerWallet));
  if (wallets.some((wallet) => !wallet)) return false;
  if (new Set(wallets).size !== 3) return false;
  return wallets.every((wallet) => !hasConflictOfInterest(session, wallet));
}

function hasUnresolvedVotes(session) {
  if (!session || !Array.isArray(session.reviewers)) return true;
  if (session.phase === "blind_review") {
    return session.reviewers.some((reviewer) => !["accept", "neutral", "reject"].includes(reviewer.vote));
  }
  if (session.phase === "rebuttal") {
    return session.reviewers.some((reviewer) => !["accept", "reject"].includes(reviewer.rebuttalVote || reviewer.vote));
  }
  return false;
}

function isSubmittedBlindVote(reviewer) {
  return ["accept", "neutral", "reject"].includes(String(reviewer?.vote || "").toLowerCase());
}

function allInitialBlindReviewsSubmitted(session) {
  if (!session || !Array.isArray(session.reviewers) || session.reviewers.length !== 3) {
    return false;
  }
  return session.reviewers.every((reviewer) => isSubmittedBlindVote(reviewer));
}

function getReviewDraftStorageId({ reviewerWalletAddress, sessionId } = {}) {
  const wallet = normalizeWallet(reviewerWalletAddress);
  const session = String(sessionId || "").trim().toLowerCase();
  if (!wallet || !session) return "";
  return `${wallet}:${session}`;
}

function loadReviewDraft({ reviewerWalletAddress, sessionId } = {}) {
  const storageId = getReviewDraftStorageId({ reviewerWalletAddress, sessionId });
  if (!storageId) return {};
  try {
    const drafts = JSON.parse(localStorage.getItem(REVIEW_DRAFT_STORAGE_KEY) || "{}");
    const draft = drafts?.[storageId];
    return draft && typeof draft === "object" ? draft : {};
  } catch {
    return {};
  }
}

function saveReviewDraft({ reviewerWalletAddress, sessionId } = {}, draft = {}) {
  const storageId = getReviewDraftStorageId({ reviewerWalletAddress, sessionId });
  if (!storageId) return;
  try {
    const drafts = JSON.parse(localStorage.getItem(REVIEW_DRAFT_STORAGE_KEY) || "{}");
    drafts[storageId] = {
      summary: String(draft.summary || ""),
      strengths: String(draft.strengths || ""),
      weaknesses: String(draft.weaknesses || ""),
      requiredChanges: String(draft.requiredChanges || ""),
      vote: String(draft.vote || ""),
      rebuttalComment: String(draft.rebuttalComment || ""),
      rebuttalVote: String(draft.rebuttalVote || ""),
      revealIdentityAfterPublish: Boolean(draft.revealIdentityAfterPublish),
      reviewerPublicName: String(draft.reviewerPublicName || ""),
    };
    localStorage.setItem(REVIEW_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore localStorage failures in restricted environments
  }
}

function clearReviewDraft({ reviewerWalletAddress, sessionId } = {}) {
  const storageId = getReviewDraftStorageId({ reviewerWalletAddress, sessionId });
  if (!storageId) return;
  try {
    const drafts = JSON.parse(localStorage.getItem(REVIEW_DRAFT_STORAGE_KEY) || "{}");
    delete drafts[storageId];
    localStorage.setItem(REVIEW_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore localStorage failures in restricted environments
  }
}

function resolveBlindReviewDeadlinePolicy(session) {
  if (!session || session.phase !== "blind_review" || !isPastDeadline(session.deadline)) {
    return null;
  }

  const submittedReviewers = session.reviewers.filter((reviewer) => isSubmittedBlindVote(reviewer));
  const missingAssignedReviewers = session.reviewers.filter(
    (reviewer) => normalizeWallet(reviewer.reviewerWallet) && !isSubmittedBlindVote(reviewer)
  );

  if (missingAssignedReviewers.length === 0) {
    return null;
  }

  const daysLate = Math.max(1, Math.abs(daysToDeadline(session.deadline)));
  let platformShareTotal = 0;
  let reviewerCompensationTotal = 0;

  const submittedVoteValues = submittedReviewers
    .map((reviewer) => String(reviewer?.vote || "").toLowerCase())
    .filter((voteValue) => ["accept", "neutral", "reject"].includes(voteValue));
  const twoReviewerAgreementOutcome =
    submittedVoteValues.length === 2 && submittedVoteValues.every((voteValue) => voteValue === "accept")
      ? "accepted"
      : submittedVoteValues.length === 2 && submittedVoteValues.every((voteValue) => voteValue === "reject")
        ? "rejected"
        : null;

  const reviewers = session.reviewers.map((reviewer) => {
    if (!normalizeWallet(reviewer.reviewerWallet) || isSubmittedBlindVote(reviewer)) {
      return reviewer;
    }

    recordReviewerNoShow(reviewer.reviewerWallet).catch(() => {});

    const stakeAmount = roundTo2(Number(reviewer?.stakedTokens || 0));
    if (twoReviewerAgreementOutcome) {
      return {
        ...reviewer,
        requestStatus: "no_show",
        noShowRecordedAt: offsetIsoDate(0),
        stakeStatus: stakeAmount > 0 ? "returned" : "none",
        stakeResolvedAt: offsetIsoDate(0),
        stakeResolution:
          stakeAmount > 0
            ? "Missed deadline, but no penalty applied because the remaining two reviewers reached the same decision."
            : "Missed deadline with no active stake.",
        stakeSlashed: 0,
        stakeRefunded: stakeAmount,
        slashedToReviewerCompensationDst: 0,
        slashedToPlatformPoolDst: 0,
        rewardEarned: roundTo2(Number(reviewer?.rewardEarned || 0)),
        stakeNote:
          stakeAmount > 0
            ? "Deadline missed. No penalty applied because the other two reviewers agreed."
            : "Deadline missed. Reviewer marked as no-show.",
      };
    }
    const { slashingRate, slashedAmount, refundedAmount, status } =
      stakeAmount > 0
        ? computeStakeSlashing(stakeAmount, daysLate, { acceptedNoShow: true })
        : { slashingRate: 0, slashedAmount: 0, refundedAmount: 0, status: "none" };

    const reviewerCompensationShare = roundTo2(slashedAmount * 0.5);
    const platformShare = roundTo2(slashedAmount - reviewerCompensationShare);
    reviewerCompensationTotal = roundTo2(reviewerCompensationTotal + reviewerCompensationShare);
    platformShareTotal = roundTo2(platformShareTotal + platformShare);

    const penalizedReviewer = {
      ...reviewer,
      requestStatus: "no_show",
      noShowRecordedAt: offsetIsoDate(0),
      stakeStatus: status,
      stakeResolvedAt: offsetIsoDate(0),
      stakeResolution:
        slashingRate <= 0
          ? "Missed deadline with no active stake."
          : `Accepted review but missed submission deadline: ${Math.round(slashingRate * 100)}% of stake slashed after ${daysLate} late day(s).`,
      stakeSlashed: roundTo2(slashedAmount),
      stakeRefunded: roundTo2(refundedAmount),
      slashedToReviewerCompensationDst: reviewerCompensationShare,
      slashedToPlatformPoolDst: platformShare,
      rewardEarned: roundTo2(Number(reviewer?.rewardEarned || 0)),
      stakeNote:
        slashingRate <= 0
          ? "Deadline missed. Reviewer marked as no-show."
          : `Accepted review but did not submit. ${Math.round(slashingRate * 100)}% of the reviewer stake was slashed.`,
    };

    if (submittedReviewers.length >= 2) {
      return penalizedReviewer;
    }

    return openReplacementRequest(
      penalizedReviewer,
      submittedReviewers.length === 1
        ? "replacement_requested_after_single_submission"
        : "session_reset_after_zero_submissions"
    );
  });

  const settledSession = settleSessionEconomics(session, {
    slashedAmount: platformShareTotal,
  });

  if (twoReviewerAgreementOutcome) {
    return finalizeSession(
      {
        ...settledSession,
        reviewers,
      },
      twoReviewerAgreementOutcome,
      "agreement_decision_after_two_of_three_reviews"
    );
  }

  if (submittedReviewers.length >= 2) {
    const compensationPerReviewer =
      submittedReviewers.length > 0
        ? roundTo2(reviewerCompensationTotal / submittedReviewers.length)
        : 0;
    const compensatedReviewers = reviewers.map((reviewer) =>
      isSubmittedBlindVote(reviewer)
        ? {
            ...reviewer,
            rewardEarned: roundTo2(Number(reviewer?.rewardEarned || 0) + compensationPerReviewer),
            stakeNote: compensationPerReviewer
              ? `Compensation credited from non-submitting reviewer stake: +${formatTokenAmount(compensationPerReviewer)} DST.`
              : reviewer?.stakeNote || "",
          }
        : reviewer
    );
    return {
      ...settledSession,
      reviewers: compensatedReviewers.map((reviewer) =>
        !isSubmittedBlindVote(reviewer) && normalizeWallet(reviewer.reviewerWallet)
          ? openReplacementRequest(
              reviewer,
              "replacement_requested_after_conflicting_two_reviewer_split"
            )
          : reviewer
      ),
      deadline: offsetIsoDate(REPLACEMENT_REVIEW_WINDOW_DAYS),
      reminderLevel: "3d",
      reminderDays: REPLACEMENT_REVIEW_WINDOW_DAYS,
      resolutionReason: "replacement_requested_after_conflicting_two_reviewer_split",
      highPriority: true,
      authorActionRequired: true,
      authorActionOptions: ["pay_priority_fee", "extend_review_window"],
      reviewerCompensationDst: roundTo2(
        Number(session?.reviewerCompensationDst || 0) + reviewerCompensationTotal
      ),
    };
  }

  return {
    ...settledSession,
    reviewers,
    deadline: offsetIsoDate(REPLACEMENT_REVIEW_WINDOW_DAYS),
    reminderLevel: "3d",
    reminderDays: REPLACEMENT_REVIEW_WINDOW_DAYS,
    reviewRoundStatus:
      submittedReviewers.length === 1 ? "incomplete" : "failed",
    resolutionReason:
      submittedReviewers.length === 1
        ? "replacement_requested_after_single_submission"
        : "session_reset_after_zero_submissions",
    highPriority: true,
    authorActionRequired: true,
    authorActionOptions: ["pay_priority_fee", "extend_review_window"],
  };
}

function daysToDeadline(deadline, nowTs = Date.now()) {
  const dueTs = new Date(`${deadline}T00:00:00Z`).getTime();
  const now = new Date(nowTs);
  const todayTs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(dueTs) || !Number.isFinite(todayTs)) return 0;
  return Math.floor((dueTs - todayTs) / (1000 * 60 * 60 * 24));
}

function isPastDeadline(deadline, nowTs = Date.now()) {
  return daysToDeadline(deadline, nowTs) < 0;
}

function applyDeadlineAutomation(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions.map((session) => {
    let normalizedSession = {
      ...ensureSessionFunding(session),
      reviewers: (session.reviewers || []).map((reviewer) => normalizeReviewerSlot(reviewer)),
    };

    const blindReviewDeadlineResolution = resolveBlindReviewDeadlinePolicy(normalizedSession);
    if (blindReviewDeadlineResolution) {
      return blindReviewDeadlineResolution;
    }

    let deadlineExtended = false;

    normalizedSession = {
      ...normalizedSession,
      reviewers: normalizedSession.reviewers.map((reviewer) => {
        if (normalizeWallet(reviewer.reviewerWallet) || reviewer.requestStatus !== "requested") {
          return reviewer;
        }
        if (!isPastDeadline(reviewer.requestExpiresOn)) return reviewer;
        if (Number(reviewer.requestRound || 1) > MAX_REPLACEMENT_ROUNDS) {
          return { ...reviewer, requestStatus: "replaced", lastReplacementReason: "request_rounds_exhausted" };
        }
        return {
          ...reviewer,
          requestOpenedOn: offsetIsoDate(0),
          requestExpiresOn: offsetIsoDate(REVIEW_REQUEST_WINDOW_DAYS),
          requestRound: Number(reviewer.requestRound || 1) + 1,
          requestStatus: "requested",
          lastReplacementReason: "request_expired_reissued",
        };
      }),
    };

    normalizedSession = {
      ...normalizedSession,
      reviewers: normalizedSession.reviewers.map((reviewer) => {
        if (
          normalizedSession.phase === "blind_review" ||
          !normalizeWallet(reviewer.reviewerWallet) ||
          reviewer.vote ||
          !isPastDeadline(normalizedSession.deadline)
        ) {
          return reviewer;
        }
        recordReviewerNoShow(reviewer.reviewerWallet).catch(() => {});
        deadlineExtended = true;
        return openReplacementRequest(
          {
            ...reviewer,
            previousReviewerWallet: reviewer.reviewerWallet,
            requestStatus: "no_show",
            noShowRecordedAt: offsetIsoDate(0),
          },
          "reviewer_missed_submission_deadline"
        );
      }),
    };

    if (deadlineExtended) {
      normalizedSession = {
        ...normalizedSession,
        deadline: offsetIsoDate(REPLACEMENT_REVIEW_WINDOW_DAYS),
      };
    }

    const allSlotsFilled = normalizedSession.reviewers.every((reviewer) => normalizeWallet(reviewer.reviewerWallet));
    if (allSlotsFilled && !hasValidIndependentPanel(normalizedSession)) {
      return {
        ...finalizeSession(normalizedSession, "abandoned", "invalid_or_conflicted_panel"),
        reminderLevel: "overdue",
        reminderDays: -1,
      };
    }
    if (session.phase === "decided") {
      return { ...normalizedSession, reminderLevel: "none", reminderDays: null };
    }
    const days = daysToDeadline(normalizedSession.deadline);
    const reminderLevel = days < 0 ? "overdue" : days <= 1 ? "1d" : days <= 3 ? "3d" : days <= 7 ? "7d" : "none";

    const exhaustedOpenSlots = normalizedSession.reviewers.filter(
      (reviewer) =>
        !normalizeWallet(reviewer.reviewerWallet) &&
        reviewer.requestStatus === "replaced" &&
        Number(reviewer.requestRound || 1) > MAX_REPLACEMENT_ROUNDS
    );
    if (exhaustedOpenSlots.length > 0) {
      return {
        ...finalizeSession(normalizedSession, "abandoned", "reviewer_requests_exhausted"),
        reminderLevel,
        reminderDays: days,
      };
    }

    const hasOpenRequests = normalizedSession.reviewers.some((reviewer) => isOpenReviewRequest(reviewer));
    if (isPastDeadline(session.deadline) && hasOpenRequests) {
      return {
        ...normalizedSession,
        deadline: offsetIsoDate(REPLACEMENT_REVIEW_WINDOW_DAYS),
        reminderLevel: "3d",
        reminderDays: REPLACEMENT_REVIEW_WINDOW_DAYS,
      };
    }

    if (isPastDeadline(session.deadline) && hasUnresolvedVotes(normalizedSession)) {
      return {
        ...finalizeSession(normalizedSession, "abandoned", "deadline_expired_before_complete_panel_resolution"),
        reminderLevel,
        reminderDays: days,
      };
    }
    return { ...normalizedSession, reminderLevel, reminderDays: days };
  });
}

function formatReminderLabel(days) {
  const normalizedDays = Number(days);
  if (!Number.isFinite(normalizedDays)) return "On schedule";
  if (normalizedDays < 0) return "Overdue";
  if (normalizedDays === 1) return "Reminder: 1 day left";
  return `Reminder: ${normalizedDays} days left`;
}

function toDisplayDecision(decision) {
  const normalized = String(decision || "").toLowerCase();
  if (normalized === "accepted") return "Accepted";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "flagged") return "Abandoned";
  if (normalized === "abandoned") return "Abandoned";
  if (normalized === "rebuttal_open") return "Rebuttal Open";
  return decision;
}

function getDecisionToneClass(decision) {
  const normalized = String(decision || "").toLowerCase();
  if (normalized === "accepted") return "bg-[#def4e8]";
  if (normalized === "rejected") return "bg-[#fde4e4]";
  if (normalized === "abandoned") return "bg-[#ececf1]";
  if (normalized === "flagged") return "bg-[#ececf1]";
  return "bg-[#ececf1]";
}

function renderDecisionIcon(decision) {
  const normalized = String(decision || "").toLowerCase();
  if (normalized === "accepted") return <CircleCheck className="h-6 w-6 text-[#10a452]" />;
  if (normalized === "rejected") return <XCircle className="h-6 w-6 text-[#ef4444]" />;
  if (normalized === "abandoned") return <Clock className="h-6 w-6 text-[#6f748e]" />;
  if (normalized === "flagged") return <Clock className="h-6 w-6 text-[#6f748e]" />;
  return <AlertTriangle className="h-6 w-6 text-[#6f748e]" />;
}

function getDecisionSummary(decision) {
  const normalized = String(decision || "").toLowerCase();
  if (normalized === "accepted" || normalized === "rejected") {
    return "The review decision is final. The outcome was determined once all 3 reviewers submitted their independent votes.";
  }
  if (normalized === "abandoned") {
    return "The review process did not complete because reviewer participation failed. The paper must be reassigned or resubmitted into a new review cycle.";
  }
  if (normalized === "flagged") {
    return "The review process did not complete because reviewer participation failed. The paper must be reassigned or resubmitted into a new review cycle.";
  }
  return "The review process has finished.";
}

function getResolutionReasonLabel(reason) {
  const normalized = String(reason || "").toLowerCase();
  if (normalized === "agreement_decision_after_two_of_three_reviews") {
    return "Decision proceeded because 2/3 reviewers agreed";
  }
  if (normalized === "majority_decision_after_two_of_three_reviews") {
    return "Majority decision from 2/3 reviewers";
  }
  if (normalized === "replacement_requested_after_conflicting_two_reviewer_split") {
    return "Replacement reviewer requested after 2-reviewer conflict";
  }
  if (normalized === "replacement_requested_after_single_submission") {
    return "Incomplete panel: 1/3 reviewers submitted";
  }
  if (normalized === "session_reset_after_zero_submissions") {
    return "Failed review round: 0/3 reviewers submitted";
  }
  return "";
}

function isExplicitHighPriority(session) {
  return Boolean(session?.highPriority);
}

function needsReviewerAttention(session) {
  const reason = String(session?.resolutionReason || "").toLowerCase();
  return Boolean(
    isExplicitHighPriority(session) ||
      session?.authorActionRequired ||
      reason === "replacement_requested_after_single_submission" ||
      reason === "replacement_requested_after_conflicting_two_reviewer_split" ||
      reason === "session_reset_after_zero_submissions"
  );
}

