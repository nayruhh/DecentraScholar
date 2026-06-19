import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookCheck, CalendarDays, FileText, MessageSquareText } from "lucide-react";
import { getSubmissionMetadataForPaper } from "./submissionMetadataStore";
import { loadProfileDisplayName } from "../../../services/browserSession";
import TabHeader from "../../../components/feedback/TabHeader";
import TabState from "../../../components/feedback/TabState";
import { useToast } from "../../../components/feedback/ToastProvider";

export default function SubmissionsTab({
  submissions,
  onOfficialPublish,
  isLoading = false,
  error = "",
}) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [openSubmissionId, setOpenSubmissionId] = useState("");
  const [openReviewsId, setOpenReviewsId] = useState("");

  if (isLoading) {
    return <TabState type="loading" title="Loading submissions" description="Fetching your published papers." />;
  }

  if (error) {
    return <TabState type="error" title="Could not load submissions" description={error} />;
  }

  if (!submissions?.length) {
    return (
      <div className="space-y-6">
        <TabHeader title="My Submissions" subtitle="Track every paper you have submitted, including current and final outcomes." />
        <TabState type="empty" title="No submitted papers yet" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TabHeader title="My Submissions" subtitle="Track every paper you have submitted, including current and final outcomes." />

      <div className="space-y-4">
        {submissions.map((s) => (
          <div
            key={s.id}
            className="rounded-2xl border border-[#d9dbe5] bg-white p-6 shadow-none"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-lg font-semibold">{s.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#6b5d78]">
                  <span className="rounded-full bg-[#f2f2f4] px-3 py-1 text-xs font-mono">
                    Paper ID: {s.paperId}
                  </span>
                  {s.field ? (
                    <span className="rounded-full bg-[#f2f2f4] px-3 py-1 text-xs font-semibold">
                      {s.field}
                    </span>
                  ) : null}
                  {s.doi ? (
                    <span className="rounded-full bg-[#f2f2f4] px-3 py-1 text-xs font-mono">
                      DOI: {s.doi}
                    </span>
                  ) : null}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[#6b5d78]">
              {s.publishedAt ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-4 w-4" />
                  Published: {s.publishedAt}
                </span>
              ) : null}
              {s.deadline ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-4 w-4" />
                  Review deadline: {s.deadline}
                </span>
              ) : null}
              {s.venue ? <span>Venue: {s.venue}</span> : null}
              {s.version ? <span>Version: {s.version}</span> : null}
            </div>

            <div className="mt-5 flex justify-end">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (s.status === "published") {
                      navigate(`/paper/${encodeURIComponent(s.paperId)}`);
                      return;
                    }
                    setOpenSubmissionId((prev) => (prev === s.id ? "" : s.id));
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#d7d9e3] bg-white px-4 py-2 text-sm font-semibold text-[#111322] hover:bg-[#f4f4f8]"
                >
                  <FileText className="h-4 w-4" />
                  {s.status === "published"
                    ? "View Published Paper"
                    : openSubmissionId === s.id
                      ? "Hide Paper"
                      : "View Paper"}
                </button>
                {s.status === "published" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => exportCitation("bibtex", s, showToast)}
                      className="rounded-lg bg-[#ece7f8] px-3 py-2 text-xs font-semibold text-[#6828ce]"
                    >
                      BibTeX
                    </button>
                    <button
                      type="button"
                      onClick={() => exportCitation("ris", s, showToast)}
                      className="rounded-lg bg-[#ece7f8] px-3 py-2 text-xs font-semibold text-[#6828ce]"
                    >
                      RIS
                    </button>
                    <button
                      type="button"
                      onClick={() => exportCitation("apa", s, showToast)}
                      className="rounded-lg bg-[#ece7f8] px-3 py-2 text-xs font-semibold text-[#6828ce]"
                    >
                      APA
                    </button>
                  </>
                ) : null}
                {!s.reviewsHiddenUntilComplete && Array.isArray(s.reviews) && s.reviews.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setOpenReviewsId((prev) => (prev === s.id ? "" : s.id))}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#d7d9e3] bg-white px-4 py-2 text-sm font-semibold text-[#111322] hover:bg-[#f4f4f8]"
                  >
                    <MessageSquareText className="h-4 w-4" />
                    {openReviewsId === s.id ? "Hide Reviews" : "View Reviews"}
                  </button>
                ) : null}
                {s.status === "accepted" && !s.officiallyPublished && s.sessionId ? (
                  <button
                    type="button"
                    onClick={() => onOfficialPublish?.(s.sessionId)}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#6828ce] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a24b4]"
                  >
                    <BookCheck className="h-4 w-4" />
                    Publish Officially
                  </button>
                ) : null}
              </div>
            </div>

            {openReviewsId === s.id ? (
              <div className="mt-5 space-y-3 rounded-2xl border border-[#ececf1] bg-[#fafafe] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#111322]">
                  <MessageSquareText className="h-4 w-4" />
                  Reviewer Feedback
                </div>
                {s.reviews.map((review) => (
                  <div
                    key={review.id}
                    className="rounded-xl border border-[#e4e6ef] bg-white p-4 text-sm text-[#5f657d]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-[#111322]">{review.reviewerLabel}</div>
                      <div className="text-xs text-[#6b5d78]">
                        {review.vote ? `Vote: ${String(review.vote).toUpperCase()}` : "Review in progress"}
                        {review.submittedDate ? ` · ${review.submittedDate}` : ""}
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <p><span className="font-semibold text-[#111322]">Summary:</span> {review.summary || "-"}</p>
                      <p><span className="font-semibold text-[#111322]">Strengths:</span> {review.strengths || "-"}</p>
                      <p><span className="font-semibold text-[#111322]">Weaknesses:</span> {review.weaknesses || "-"}</p>
                      <p><span className="font-semibold text-[#111322]">Required changes:</span> {review.requiredChanges || "-"}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {openSubmissionId === s.id ? (
              <div className="mt-5 space-y-4 rounded-2xl border border-[#ececf1] bg-[#fafafe] p-5">
                <div>
                  <div className="text-sm font-semibold text-[#111322]">Paper Details</div>
                  <div className="mt-3 space-y-2 text-sm text-[#5f657d]">
                    <p>
                      <span className="font-semibold text-[#111322]">Abstract:</span>{" "}
                      {String(s.metadata?.abstract || "").trim() || "No abstract saved yet."}
                    </p>
                    <p>
                      <span className="font-semibold text-[#111322]">Keywords:</span>{" "}
                      {Array.isArray(s.metadata?.keywords) && s.metadata.keywords.length
                        ? s.metadata.keywords.join(", ")
                        : "None"}
                    </p>
                    <p>
                      <span className="font-semibold text-[#111322]">File:</span>{" "}
                      {String(s.metadata?.fileName || "").trim() || "No file metadata saved yet."}
                    </p>
                    <p>
                      <span className="font-semibold text-[#111322]">Collaborators:</span>{" "}
                      {Array.isArray(s.metadata?.collaborators) && s.metadata.collaborators.length
                        ? s.metadata.collaborators.join(", ")
                        : "None"}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#111322]">
                    <MessageSquareText className="h-4 w-4" />
                    Reviews
                  </div>
                  {s.reviewsHiddenUntilComplete ? (
                    <div className="mt-3 rounded-xl border border-dashed border-[#d7d9e3] bg-white px-4 py-4 text-sm text-[#6b5d78]">
                      Reviews stay hidden until all reviewer submissions are in.
                      {Number.isFinite(Number(s.submittedReviewCount)) && Number.isFinite(Number(s.totalReviewerCount)) ? (
                        <span className="block pt-1 text-xs">
                          Current progress: {s.submittedReviewCount}/{s.totalReviewerCount} submitted
                        </span>
                      ) : null}
                    </div>
                  ) : Array.isArray(s.reviews) && s.reviews.length ? (
                    <div className="mt-3 space-y-3">
                      {s.reviews.map((review) => (
                        <div
                          key={review.id}
                          className="rounded-xl border border-[#e4e6ef] bg-white p-4 text-sm text-[#5f657d]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-semibold text-[#111322]">{review.reviewerLabel}</div>
                            <div className="text-xs text-[#6b5d78]">
                              {review.vote ? `Vote: ${String(review.vote).toUpperCase()}` : "Review in progress"}
                              {review.submittedDate ? ` · ${review.submittedDate}` : ""}
                            </div>
                          </div>
                          <div className="mt-3 space-y-2">
                            <p><span className="font-semibold text-[#111322]">Summary:</span> {review.summary || "-"}</p>
                            <p><span className="font-semibold text-[#111322]">Strengths:</span> {review.strengths || "-"}</p>
                            <p><span className="font-semibold text-[#111322]">Weaknesses:</span> {review.weaknesses || "-"}</p>
                            <p><span className="font-semibold text-[#111322]">Required changes:</span> {review.requiredChanges || "-"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-[#d7d9e3] bg-white px-4 py-4 text-sm text-[#6b5d78]">
                      No reviews are attached to this submission yet.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "submitted").toLowerCase();
  const map = {
    published: "bg-green-100 text-green-800",
    accepted: "bg-[#def4e8] text-[#10a452]",
    under_review: "bg-[#ece7f8] text-[#6828ce]",
    rejected: "bg-red-100 text-red-800",
    abandoned: "bg-[#ececf1] text-[#6f748e]",
    submitted: "bg-[#ececf1] text-[#6f748e]",
  };
  const labelMap = {
    published: "Published",
    accepted: "Accepted",
    under_review: "Under Review",
    rejected: "Rejected",
    abandoned: "Abandoned",
    submitted: "Submitted",
  };
  return (
    <span className={["rounded-full px-3 py-1 text-xs font-semibold", map[normalized] || map.submitted].join(" ")}>
      {labelMap[normalized] || "Submitted"}
    </span>
  );
}

function exportCitation(format, submission, showToast) {
  const metadata = getSubmissionMetadataForPaper({
    paperId: submission?.paperId,
    title: submission?.title,
  });
  const citation = buildCitation(format, submission, metadata);
  const fileSafeTitle = String(submission?.paperId || submission?.title || "paper")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .toLowerCase();
  const ext = format === "bibtex" ? "bib" : format === "ris" ? "ris" : "txt";
  downloadTextFile(`${fileSafeTitle}.${ext}`, citation);
  if (typeof showToast === "function") {
    showToast(`${format.toUpperCase()} citation downloaded.`);
  }
}

function buildCitation(format, submission, metadata) {
  const year = getYear(submission?.publishedAt);
  const title = String(submission?.title || "Untitled");
  const doi = String(submission?.doi || "").trim();
  const venue = String(submission?.venue || "DecentraScholar");
  const authorName = getCitationAuthor(metadata);
  const paperId = String(submission?.paperId || "paper");

  if (format === "bibtex") {
    const key = `${authorName.split(" ").slice(-1)[0] || "author"}${year || "n.d"}${paperId}`;
    return [
      `@article{${sanitizeBibtexKey(key)},`,
      `  title = {${escapeBraces(title)}},`,
      `  author = {${escapeBraces(authorName)}},`,
      `  journal = {${escapeBraces(venue)}},`,
      `  year = {${year || "n.d."}},`,
      doi ? `  doi = {${escapeBraces(doi)}},` : "",
      `  note = {Paper ID: ${escapeBraces(paperId)}}`,
      `}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (format === "ris") {
    return [
      "TY  - JOUR",
      `TI  - ${title}`,
      `AU  - ${authorName}`,
      `JO  - ${venue}`,
      year ? `PY  - ${year}` : "",
      doi ? `DO  - ${doi}` : "",
      `ID  - ${paperId}`,
      "ER  -",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const datePart = year ? `(${year}).` : "(n.d.).";
  const doiPart = doi ? ` https://doi.org/${doi}` : "";
  return `${authorName}. ${datePart} ${title}. ${venue}.${doiPart}`;
}

function getCitationAuthor(metadata) {
  const profileName = String(loadProfileDisplayName() || "").trim();
  if (profileName) return profileName;
  const collaborators = Array.isArray(metadata?.collaborators) ? metadata.collaborators : [];
  if (collaborators.length > 0) return collaborators[0];
  return "Anonymous Author";
}

function getYear(dateValue) {
  const raw = String(dateValue || "").trim();
  const match = raw.match(/^(\d{4})/);
  return match ? match[1] : "";
}

function sanitizeBibtexKey(value) {
  return String(value || "paper").replace(/[^a-zA-Z0-9:_-]/g, "");
}

function escapeBraces(value) {
  return String(value || "").replace(/[{}]/g, "");
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([String(content || "")], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
}
