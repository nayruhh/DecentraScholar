import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bookmark, Copy, Download, FileText, Star } from "lucide-react";
import { resolveIpfsUrl } from "../../services/ipfsGateway";
import PageTransition from "../../components/PageTransition";
import AppShell from "../dashboard/components/AppShell";
import { loadTokenomicsState } from "../dashboard/tabs/tokenomicsStore";
import { getSubmissionMetadataForPaper } from "../dashboard/tabs/submissionMetadataStore";
import {
  getPublishedPaperById,
  refreshPublishedPapers,
  ratePaper,
  subscribePaperChanges,
  toggleSavePaper,
} from "../dashboard/tabs/paperStore";

export default function PaperDetails() {
  const navigate = useNavigate();
  const { paperId } = useParams();
  const [walletBalance] = useState(() => loadTokenomicsState().walletBalance);
  const [paper, setPaper] = useState(() => (paperId ? getPublishedPaperById(paperId) : null));
  const [actionMessage, setActionMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setPaper(paperId ? getPublishedPaperById(paperId) : null);
  }, [paperId]);

  useEffect(() => {
    const unsubscribe = subscribePaperChanges((papers) => {
      const next = papers.find((p) => p.paperId === paperId) || null;
      setPaper(next);
    });
    refreshPublishedPapers().finally(() => setIsLoading(false));
    return unsubscribe;
  }, [paperId]);

  const authorLabel = useMemo(() => {
    if (!paper) return "";
    return paper.authorName || paper.authorWallet || "Unknown Author";
  }, [paper]);
  const metadata = useMemo(
    () =>
      getSubmissionMetadataForPaper({
        paperId: paper?.paperId,
        title: paper?.title,
      }),
    [paper?.paperId, paper?.title]
  );

  if (!paper) {
    return (
      <PageTransition>
        <AppShell
          activeNav="browse"
          pageTitle="Paper Details"
          pageSubtitle="Published paper details"
          tokenBalance={walletBalance}
        >
          <div className="rounded-2xl bg-white p-8 text-center text-[#7b8099] ring-1 ring-black/5">
            {isLoading ? "Loading paper..." : "Paper not found."}
          </div>
        </AppShell>
      </PageTransition>
    );
  }

  const handleToggleSave = async () => {
    try {
      const saved = await toggleSavePaper(paper.paperId);
      setActionMessage(saved ? "Saved to library." : "Removed from library.");
    } catch (error) {
      setActionMessage(String(error?.message || "Could not update saved status."));
    }
  };

  const handleRate = async (score) => {
    try {
      setActionMessage("Confirm the transaction in MetaMask...");
      await ratePaper(paper.paperId, score);
      setActionMessage(`You rated this paper ${Number(score).toFixed(1)}/5.`);
    } catch (error) {
      const msg = String(error?.message || "");
      if (msg.includes("cannot rate your own paper")) {
        setActionMessage("You cannot rate your own paper.");
      } else if (msg.includes("connect your wallet")) {
        setActionMessage("Please connect your wallet to rate papers.");
      } else if (msg.includes("user rejected") || msg.includes("User denied")) {
        setActionMessage("Transaction cancelled.");
      } else if (msg.includes("MetaMask not detected")) {
        setActionMessage("MetaMask not detected. Please install MetaMask to rate papers.");
      } else {
        setActionMessage("Could not save your rating. Please try again.");
      }
    }
  };
  const handleDownloadCitation = (format) => {
    const citation = buildCitation(format, paper, metadata);
    const fileSafeTitle = String(paper?.paperId || paper?.title || "paper")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .toLowerCase();
    const ext = format === "bibtex" ? "bib" : format === "ris" ? "ris" : "txt";
    downloadTextFile(`${fileSafeTitle}.${ext}`, citation);
    setActionMessage(`${format.toUpperCase()} citation downloaded.`);
  };

  const handleCopyCitation = async (format) => {
    const citation = buildCitation(format, paper, metadata);
    try {
      await navigator.clipboard.writeText(citation);
      setActionMessage(`${format.toUpperCase()} citation copied.`);
    } catch {
      setActionMessage("Clipboard is unavailable in this browser.");
    }
  };

  const toTitleCase = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((word) =>
        word
          .split("-")
          .map((part) =>
            part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : part
          )
          .join("-")
      )
      .join(" ");

  return (
    <PageTransition>
      <AppShell
        activeNav="browse"
        pageTitle="Paper Details"
        pageSubtitle="Read, save, download, and rate published papers."
        tokenBalance={walletBalance}
      >
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-base font-semibold text-[#111322]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="space-y-5">
            <div className="rounded-2xl border border-[#d7d9e3] bg-white p-5">
              {resolveIpfsUrl(paper.manuscriptCid) ? (
                <a
                  href={resolveIpfsUrl(paper.manuscriptCid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-[#ececf1] p-16 text-center text-[#7a8096] hover:bg-[#e4e5ee] transition-colors"
                >
                  <FileText className="h-12 w-12" />
                  <div className="text-xl font-semibold text-[#6828ce]">View PDF on IPFS</div>
                  <div className="text-sm">{paper.title}</div>
                </a>
              ) : (
                <div className="rounded-2xl bg-[#ececf1] p-16 text-center text-[#7a8096]">
                  <FileText className="mx-auto h-12 w-12" />
                  <div className="mt-3 text-xl">PDF not yet available</div>
                </div>
              )}

              <h2 className="mt-5 text-4xl font-semibold text-[#111322]">{toTitleCase(paper.title)}</h2>
              <p className="mt-3 text-lg leading-relaxed text-[#5f657d]">
                {paper.abstract || "No abstract available."}
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-[#d7d9e3] bg-white p-5">
                <div className="space-y-3">
                  <div>
                    <div className="text-sm text-[#7b8099]">Author</div>
                    <div className="mt-1 text-xl text-[#111322]">{authorLabel}</div>
                  </div>
                  <div>
                    <div className="text-sm text-[#7b8099]">Reviewed By</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {paper.reviewCompleted && paper.officiallyPublished ? (
                        (paper.reviewedBy || []).length > 0 ? (
                          paper.reviewedBy.map((name) => (
                            <span
                              key={name}
                              className="rounded-full bg-[#ececf1] px-3 py-1 text-sm text-[#5f657d]"
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-[#5f657d]">Anonymous Reviewers</span>
                        )
                      ) : (
                        <span className="text-sm text-[#5f657d]">Hidden until publication</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-[#7b8099]">Field</div>
                    <span className="mt-1 inline-flex rounded-full bg-[#ececf1] px-3 py-1 text-sm font-semibold text-[#111322]">
                      {toTitleCase(paper.category)}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm text-[#7b8099]">Published</div>
                    <div className="mt-1 text-xl text-[#111322]">{paper.date}</div>
                  </div>
                  <div>
                    <div className="text-sm text-[#7b8099]">Keywords</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(paper.tags || []).map((tag) => (
                        <span key={tag} className="rounded-full bg-[#ececf1] px-3 py-1 text-sm text-[#5f657d]">
                          {toTitleCase(tag)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-[#7b8099]">Collaborators</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {paper.reviewCompleted && paper.officiallyPublished ? (
                        (paper.collaborators || []).length > 0 ? (
                          paper.collaborators.map((name) => (
                            <span
                              key={name}
                              className="rounded-full bg-[#ececf1] px-3 py-1 text-sm text-[#5f657d]"
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-[#5f657d]">None</span>
                        )
                      ) : (
                        <span className="text-sm text-[#5f657d]">Hidden until publication</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-[#eceef4] pt-4">
                  <button
                    type="button"
                    onClick={handleToggleSave}
                    className="w-full rounded-xl bg-[#6828ce] py-3 text-base font-semibold text-white hover:bg-[#5a24b4]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Bookmark className="h-4 w-4" />
                      {paper.saved ? "Saved in Library" : "Save to Library"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-[#d7d9e3] bg-white p-5">
                <div className="text-lg font-semibold text-[#111322]">Rate This Paper</div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {Array.from({ length: 10 }, (_, idx) => (idx + 1) / 2).map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => handleRate(score)}
                      className="inline-flex items-center gap-1 rounded border border-[#d7d9e3] bg-white px-2 py-1 text-xs text-[#111322] hover:bg-[#f7f7fa]"
                      aria-label={`Rate ${score} stars`}
                    >
                      <Star
                        className={[
                          "h-4 w-4",
                          score <= (paper.userRating || 0)
                            ? "fill-[#f59e0b] text-[#f59e0b]"
                            : "text-[#c5c8d6]",
                        ].join(" ")}
                      />
                      <span>{score.toFixed(1)}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-sm text-[#5f657d]">
                  Your rating: {(paper.userRating || 0).toFixed(1)} - Average rating: {Number(paper.stars || 0).toFixed(1)}
                </div>
              </div>

              <div className="rounded-2xl border border-[#d7d9e3] bg-white p-5">
                <div className="text-lg font-semibold text-[#111322]">Citations</div>
                <p className="mt-1 text-sm text-[#7b8099]">Download or copy in your preferred format.</p>
                <div className="mt-4 space-y-2">
                  {[
                    { key: "bibtex", label: "BibTeX" },
                    { key: "ris", label: "RIS" },
                    { key: "apa", label: "APA" },
                  ].map((format) => (
                    <div
                      key={format.key}
                      className="flex items-center justify-between rounded-xl bg-[#f7f7fa] px-3 py-2 ring-1 ring-black/5"
                    >
                      <span className="text-sm font-semibold text-[#111322]">{format.label}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyCitation(format.key)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#3a2d46] ring-1 ring-black/10 hover:bg-black/[0.02]"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadCitation(format.key)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#ece7f8] px-3 py-1.5 text-xs font-semibold text-[#6828ce] hover:bg-[#e3dcf5]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {actionMessage ? (
            <div className="rounded-xl bg-[#ece7f8] px-4 py-3 text-sm text-[#6828ce]">
              {actionMessage}
            </div>
          ) : null}
        </div>
      </AppShell>
    </PageTransition>
  );
}

function buildCitation(format, paper, metadata) {
  const year = getYear(paper?.date);
  const title = String(paper?.title || "Untitled");
  const doi = String(paper?.doi || "").trim();
  const venue = String(paper?.venue || "DecentraScholar");
  const authorName = getCitationAuthor(paper, metadata);
  const paperId = String(paper?.paperId || "paper");

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
      "}",
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

function buildPaperDownloadContent(paper, metadata) {
  return [
    `Title: ${String(paper?.title || "Untitled")}`,
    `Paper ID: ${String(paper?.paperId || "-")}`,
    `Author: ${String(paper?.authorName || paper?.authorWallet || "Unknown Author")}`,
    `Published: ${String(paper?.date || "-")}`,
    `Field: ${String(paper?.category || "-")}`,
    `DOI: ${String(paper?.doi || "-")}`,
    "",
    "Abstract",
    String(paper?.abstract || "No abstract available."),
    "",
    "Keywords",
    Array.isArray(paper?.tags) && paper.tags.length > 0 ? paper.tags.join(", ") : "None",
    "",
    "Collaborators",
    Array.isArray(metadata?.collaborators) && metadata.collaborators.length > 0
      ? metadata.collaborators.join(", ")
      : "None",
  ].join("\n");
}

function getCitationAuthor(paper, metadata) {
  const paperAuthor = String(paper?.authorName || "").trim();
  if (paperAuthor) return paperAuthor;
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
