import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileText,
  MinusCircle,
  Trash2,
  XCircle,
} from "lucide-react";
import { getSubmissionMetadataForPaper } from "./submissionMetadataStore";
import { resolveIpfsUrl } from "../../../services/ipfsGateway";
import TabHeader from "../../../components/feedback/TabHeader";
import TabState from "../../../components/feedback/TabState";

function voteIcon(vote) {
  if (vote === "accept") return <CheckCircle2 className="h-4 w-4 text-[#17a35b]" />;
  if (vote === "reject") return <XCircle className="h-4 w-4 text-[#dc2626]" />;
  if (vote === "neutral") return <MinusCircle className="h-4 w-4 text-[#d68000]" />;
  return <Clock className="h-4 w-4 text-[#8a90a8]" />;
}

function voteLabel(vote) {
  if (vote === "accept") return "Accepted";
  if (vote === "reject") return "Rejected";
  if (vote === "neutral") return "Neutral";
  return "Pending";
}

function phaseBadge(phase) {
  const map = {
    blind_review: "bg-[#ececf1] text-[#6f748e]",
    rebuttal: "bg-[#fff2df] text-[#d68000]",
    decided: "bg-[#def4e8] text-[#17a35b]",
    escalated: "bg-[#fff2df] text-[#d68000]",
  };
  const labelMap = {
    blind_review: "Blind Review",
    rebuttal: "Rebuttal",
    decided: "Decided",
    escalated: "Escalated",
  };
  return (
    <span
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold",
        map[phase] || "bg-[#ececf1] text-[#6f748e]",
      ].join(" ")}
    >
      {labelMap[phase] || phase}
    </span>
  );
}

function decisionBadge(decision) {
  if (decision === "accepted") {
    return (
      <span className="rounded-full bg-[#17a35b] px-3 py-1 text-xs font-semibold text-white">
        Accepted
      </span>
    );
  }
  if (decision === "rejected") {
    return (
      <span className="rounded-full bg-[#dc2626] px-3 py-1 text-xs font-semibold text-white">
        Rejected
      </span>
    );
  }
  if (decision === "under_review") {
    return (
      <span className="rounded-full bg-[#ececf1] px-3 py-1 text-xs font-semibold text-[#6f748e]">
        Under Review
      </span>
    );
  }
  if (decision === "abandoned") {
    return (
      <span className="rounded-full bg-[#ececf1] px-3 py-1 text-xs font-semibold text-[#6f748e]">
        Abandoned
      </span>
    );
  }
  return null;
}

function decisionExplanation(decision) {
  if (decision === "accepted") {
    return "The paper met the publication threshold and can now move to official publication.";
  }
  if (decision === "rejected") {
    return "The panel concluded that the paper should not proceed in its current form.";
  }
  if (decision === "abandoned") {
    return "The review process did not complete because reviewer participation failed. The paper must be reassigned or resubmitted into a new review cycle.";
  }
  return "";
}

function authorActionTitle(session) {
  if (session.resolutionReason === "replacement_requested_after_single_submission") {
    return "Incomplete review panel";
  }
  if (session.resolutionReason === "session_reset_after_zero_submissions") {
    return "Failed review round";
  }
  return "Reviewer replacement required";
}

function authorActionDescription(session, priorityFeeDst, reviewExtensionDays) {
  if (session.resolutionReason === "replacement_requested_after_single_submission") {
    return `Only 1 of 3 reviewers submitted before the deadline and grace period. That review has been preserved, the two no-show reviewers were penalized, and the paper is now marked high priority while the system searches for 2 replacement reviewers. You can either pay an additional ${priorityFeeDst} DST to prioritize matching, or extend the review window by ${reviewExtensionDays} days.`;
  }
  if (session.resolutionReason === "session_reset_after_zero_submissions") {
    return `None of the 3 reviewers submitted before the deadline and grace period. The review round failed, all reviewer stakes were penalized, and the system is reassigning a fresh full panel. You can either pay an additional ${priorityFeeDst} DST to prioritize reassignment, or extend the review window by ${reviewExtensionDays} days.`;
  }
  return `Two reviewers submitted conflicting decisions. You can either pay an additional ${priorityFeeDst} DST to prioritize reviewer matching, or extend the review window by ${reviewExtensionDays} days.`;
}

function needsReviewerIssueResubmission(session) {
  const decision = String(session?.decision || "").toLowerCase();
  const reason = String(session?.resolutionReason || "").toLowerCase();
  return (
    decision === "abandoned" ||
    reason === "replacement_requested_after_single_submission" ||
    reason === "reviewer_requests_exhausted" ||
    reason === "deadline_expired_before_complete_panel_resolution" ||
    reason === "session_reset_after_zero_submissions"
  );
}

function ReviewerCard({ slot, index, isVisible, showReviewerDeliberation = false }) {
  const hasSubmitted = Boolean(slot.submittedDate);
  const visibleVote = showReviewerDeliberation ? slot.rebuttalVote || slot.vote : slot.vote;

  return (
    <div className="space-y-3 rounded-xl border border-[#e5e6ec] bg-[#f8f8fb] p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#111322]">Reviewer {index + 1}</span>
        <div className="flex items-center gap-2">
          {isVisible ? voteIcon(visibleVote) : <Clock className="h-4 w-4 text-[#8a90a8]" />}
          <span className="text-sm text-[#5f657d]">
            {isVisible ? voteLabel(visibleVote) : hasSubmitted ? "Submitted" : "Pending"}
          </span>
        </div>
      </div>

      {hasSubmitted && isVisible ? (
        <div className="space-y-2 text-sm text-[#2f3346]">
          <div>
            <p className="mb-1 text-xs font-semibold text-[#7b8099]">Summary</p>
            <p>{slot.summary}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-[#7b8099]">Strengths</p>
            <p>{slot.strengths}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-[#7b8099]">Weaknesses</p>
            <p>{slot.weaknesses}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-[#7b8099]">Required Changes</p>
            <p>{slot.requiredChanges}</p>
          </div>
          {showReviewerDeliberation && slot.rebuttalComment ? (
            <div className="rounded-lg border border-[#a487df] bg-[#ece7f8] p-3">
              <p className="mb-1 text-xs font-semibold text-[#7b8099]">Rebuttal Comment</p>
              <p className="text-sm text-[#2f3346]">{slot.rebuttalComment}</p>
              {slot.rebuttalVote ? (
                <div className="mt-1 flex items-center gap-1 text-xs text-[#5f657d]">
                  {voteIcon(slot.rebuttalVote)}
                  <span>Updated vote: {voteLabel(slot.rebuttalVote)}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-[#7b8099]">Submitted: {slot.submittedDate}</p>
        </div>
      ) : hasSubmitted && !isVisible ? (
        <div className="flex items-center gap-2 text-sm text-[#7b8099]">
          <EyeOff className="h-4 w-4" />
          <span>Review submitted - details hidden until reviewer deliberation is complete</span>
        </div>
      ) : (
        <p className="text-sm text-[#7b8099]">Review not yet submitted</p>
      )}
    </div>
  );
}

export default function RevisionsTab({
  revisionItems,
  onOfficialPublish,
  onAcknowledgeCompletedReview,
  onPayPriorityFee,
  onExtendReviewWindow,
  onRemovePendingSubmission,
  priorityFeeDst = 0,
  reviewExtensionDays = 7,
  isLoading = false,
  error = "",
}) {
  const [expandedSession, setExpandedSession] = useState(null);
  const [openPaperId, setOpenPaperId] = useState(null);

  if (isLoading) {
    return <TabState type="loading" title="Loading paper reviews" description="Fetching review progress." />;
  }

  if (error) {
    return <TabState type="error" title="Could not load paper reviews" description={error} />;
  }

  if (!revisionItems?.length) {
    return (
      <div className="space-y-6">
        <TabHeader title="My Paper Reviews" subtitle="Track reviewer feedback on your submitted papers" />
        <TabState type="empty" title="No papers under review yet" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <TabHeader title="My Paper Reviews" subtitle="Track reviewer feedback on your submitted papers" />

      <div className="space-y-4">
        {revisionItems.map((session) => {
          const reviewers = Array.isArray(session.reviews) ? session.reviews : [];
          const isExpanded = expandedSession === session.id;
          const isPaperOpen = openPaperId === session.id;
          const showResubmissionAlert = needsReviewerIssueResubmission(session);
          const assignedCount = Number(session.assignedReviewerCount ?? reviewers.length);
          const submittedCount = Number(session.submittedReviewCount ?? reviewers.filter((r) => r?.submittedDate).length);
          const totalCount = Number(session.totalReviewerCount ?? reviewers.length) || 3;
          const showReviewerDeliberation = session.phase === "decided";
          const displayPhase = session.phase === "rebuttal" ? "blind_review" : session.phase;
          const reviewsVisible = showReviewerDeliberation || !session.reviewsHiddenUntilComplete;
          const metadata = getSubmissionMetadataForPaper({
            paperId: session.paperId,
            title: session.title,
          });
          const isMetadataOnlyPendingSubmission =
            session.phase === "submitted" &&
            !session.sessionId &&
            Number(session.totalReviewerCount ?? 0) === 0;

          return (
            <div key={session.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
              <button
                type="button"
                onClick={() => {
                  const nextExpanded = isExpanded ? null : session.id;
                  setExpandedSession(nextExpanded);
                }}
                className="w-full p-5 text-left transition hover:bg-[#f8f8fb]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div
                      className={[
                        "text-lg font-semibold leading-tight",
                        showResubmissionAlert ? "text-[#d68000]" : "text-[#111322]",
                      ].join(" ")}
                    >
                      {session.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#f0eff4] px-3 py-1 text-xs font-semibold text-[#22263a]">
                        {session.field}
                      </span>
                      {session.reviewCompletePendingAck ? (
                        <span className="rounded-full bg-[#def4e8] px-3 py-1 text-xs font-semibold text-[#17a35b]">
                          Review Complete
                        </span>
                      ) : (
                        phaseBadge(displayPhase)
                      )}
                      {decisionBadge(session.decision)}
                      {showResubmissionAlert ? (
                        <span className="rounded-full bg-[#fff2df] px-3 py-1 text-xs font-semibold text-[#d68000]">
                          Resubmission Needed
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm text-[#7b8099]">
                    <p>{assignedCount}/{totalCount} reviewers</p>
                    {submittedCount > 0 && session.phase !== "rebuttal" ? (
                      <p className="text-xs">{submittedCount}/{totalCount} submitted</p>
                    ) : null}
                    <p className="text-xs">Due: {session.deadline}</p>
                  </div>
                </div>
              </button>

              {isExpanded ? (
                <div className="space-y-4 border-t border-[#eceef4] p-5">
                  {decisionExplanation(session.decision) ? (
                    <div className="rounded-lg bg-[#f8f8fb] px-4 py-3 text-sm text-[#5f657d] ring-1 ring-black/5">
                      {decisionExplanation(session.decision)}
                    </div>
                  ) : null}
                  {session.authorActionRequired ? (
                    <div className="rounded-lg border border-[#d9c7ff] bg-[#f7f2ff] p-4 text-sm text-[#3a2d46]">
                      <div className="font-semibold text-[#111322]">
                        {authorActionTitle(session)}
                      </div>
                      <p className="mt-1">
                        {authorActionDescription(session, priorityFeeDst, reviewExtensionDays)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onPayPriorityFee?.(session.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#6828ce] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a24b4]"
                        >
                          Pay Priority Fee
                        </button>
                        <button
                          type="button"
                          onClick={() => onExtendReviewWindow?.(session.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#3a2d46] ring-1 ring-black/10 hover:bg-black/[0.02]"
                        >
                          Extend Review Window
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {!reviewsVisible ? (
                    <div className="flex items-center gap-2 rounded-lg bg-[#f2f2f4] p-3 text-sm text-[#7b8099]">
                      <EyeOff className="h-4 w-4 shrink-0" />
                      <span>
                        Review is in progress — full details will be available once the review process is complete.
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {reviewers.length > 0 ? (
                      reviewers.map((slot, index) => (
                        <ReviewerCard
                          key={slot.id || `${session.id}-reviewer-${index + 1}`}
                          slot={slot}
                          index={index}
                          isVisible={reviewsVisible}
                          showReviewerDeliberation={showReviewerDeliberation}
                        />
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-[#d7d9e3] bg-[#f8f8fb] px-4 py-4 text-sm text-[#7b8099]">
                        This paper is submitted and waiting for reviewer assignment.
                      </div>
                    )}
                  </div>

                  <div className="border-t border-[#eceef4] pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenPaperId((prev) => {
                            const isClosingCurrent = prev === session.id;
                            if (isClosingCurrent && session.reviewCompletePendingAck) {
                              onAcknowledgeCompletedReview?.(session.paperId);
                            }
                            return isClosingCurrent ? null : session.id;
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#3a2d46] ring-1 ring-black/10 hover:bg-black/[0.02]"
                      >
                        <Eye className="h-4 w-4" />
                        {isPaperOpen ? "Hide Paper" : `View Paper (${session.paperId})`}
                      </button>
                      {session.decision === "accepted" && !session.officiallyPublished ? (
                        <button
                          type="button"
                          onClick={() => onOfficialPublish?.(session.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#6828ce] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a24b4]"
                        >
                          Publish Officially
                        </button>
                      ) : null}
                      {session.officiallyPublished ? (
                        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                          Officially Published
                        </span>
                      ) : null}
                      {isMetadataOnlyPendingSubmission ? (
                        <button
                          type="button"
                          onClick={() =>
                            onRemovePendingSubmission?.({
                              paperId: session.paperId,
                              title: session.title,
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#b45309] ring-1 ring-black/10 hover:bg-black/[0.02]"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove Submission
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isPaperOpen ? (
                    <div className="rounded-xl border border-[#e5e6ec] bg-[#f8f8fb] p-4">
                      <div className="text-base font-semibold text-[#111322]">Submitted Paper</div>
                      <div className="mt-3 space-y-3 text-sm text-[#2f3346]">
                        <div>
                          <p className="mb-1 text-xs font-semibold text-[#7b8099]">Abstract</p>
                          <p>{String(metadata?.abstract || "").trim() || "No abstract saved yet."}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-[#7b8099]">Keywords</p>
                          <p>
                            {Array.isArray(metadata?.keywords) && metadata.keywords.length
                              ? metadata.keywords.join(", ")
                              : "None"}
                          </p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-[#7b8099]">Collaborators</p>
                          <p>
                            {Array.isArray(metadata?.collaborators) && metadata.collaborators.length
                              ? metadata.collaborators.join(", ")
                              : "None"}
                          </p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-[#7b8099]">File</p>
                          <p>{String(metadata?.fileName || "").trim() || "No file metadata saved yet."}</p>
                          {resolveIpfsUrl(metadata?.manuscriptCid) ? (
                            <a
                              href={resolveIpfsUrl(metadata.manuscriptCid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[#d7d9e3] bg-white px-4 py-2 text-sm font-semibold text-[#111322] hover:bg-[#f4f4f8]"
                            >
                              <FileText className="h-4 w-4" />
                              View PDF
                            </a>
                          ) : null}
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-[#7b8099]">Review Deadline</p>
                          <p>{session.deadline || metadata?.reviewDeadline || "-"}</p>
                        </div>
                        {session.priorityFeePaidAt ? (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-[#7b8099]">Priority Matching</p>
                            <p>
                              Priority fee paid: {session.priorityFeePaidDst || priorityFeeDst} DST on{" "}
                              {session.priorityFeePaidAt}
                            </p>
                          </div>
                        ) : null}
                        {session.reviewWindowExtendedAt ? (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-[#7b8099]">Review Window Extension</p>
                            <p>
                              Extended by {session.reviewWindowExtendedDays || reviewExtensionDays} days on{" "}
                              {session.reviewWindowExtendedAt}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
