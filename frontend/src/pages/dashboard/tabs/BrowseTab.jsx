import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, LayoutGrid, List, Search, Star } from "lucide-react";
import { resolveIpfsUrl } from "../../../services/ipfsGateway";
import TabState from "../../../components/feedback/TabState";

function statusClass(status) {
  const normalized = String(status || "").toLowerCase().replace(/\s+/g, "_");
  const map = {
    published: "bg-[#ececf1] text-[#6f748e]",
    under_review: "bg-[#ece7f8] text-[#6828ce]",
    revision_requested: "bg-[#fff2df] text-[#d68000]",
    accepted: "bg-[#dcf5e7] text-[#17a35b]",
    rejected: "bg-[#fde4e4] text-[#dc2626]",
  };
  return map[normalized] || "bg-[#ececf1] text-[#6f748e]";
}

function resolveDisplayStatus(paper) {
  if (paper?.reviewCompleted && paper?.officiallyPublished) return "published";
  if (paper?.reviewCompleted && paper?.status) return paper.status;
  return "under_review";
}

function resolveAuthorLabel(paper, displayStatus) {
  if (displayStatus === "published") {
    return stripAuthorTitle(paper.authorName || paper.author || "Unknown Author");
  }
  return paper.authorWallet || paper.author || "Anonymous Author";
}

function formatRating(value) {
  return Number(value || 0).toFixed(1);
}

function toTitleCase(value) {
  return String(value || "")
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
}

function formatStatusLabel(value) {
  return toTitleCase(String(value || "").replace(/_/g, " "));
}

function stripAuthorTitle(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Unknown Author";
  return raw.replace(/^(dr|prof|mr|ms|mrs|mx)\.?\s+/i, "").trim();
}

export default function BrowseTab({ papers, isLoading = false, error = "" }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState("grid");

  const fields = useMemo(
    () => [...new Set((papers || []).map((p) => p.category).filter(Boolean))],
    [papers]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = (papers || []).filter(
      (p) =>
        resolveDisplayStatus(p) === "published" &&
        (fieldFilter === "all" || p.category === fieldFilter) &&
        (p.title.toLowerCase().includes(query) ||
          p.tags.some((tag) => tag.toLowerCase().includes(query)))
    );

    if (sortBy === "newest") {
      result = [...result].sort((a, b) => b.date.localeCompare(a.date));
    } else if (sortBy === "rating") {
      result = [...result].sort((a, b) => b.stars - a.stars);
    } else if (sortBy === "reads") {
      result = [...result].sort((a, b) => b.reads - a.reads);
    }

    return result;
  }, [search, fieldFilter, sortBy, papers]);

  if (isLoading) {
    return <TabState type="loading" title="Loading papers" description="Fetching published papers." />;
  }

  if (error) {
    return <TabState type="error" title="Could not load papers" description={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b8099]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search papers or keywords..."
            className="w-full rounded-xl border border-[#d7d9e3] bg-white py-3 pl-9 pr-3 text-sm outline-none"
          />
        </div>

        <select
          value={fieldFilter}
          onChange={(e) => setFieldFilter(e.target.value)}
          className="w-[180px] rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none"
        >
          <option value="all">All Fields</option>
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="w-[150px] rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none"
        >
          <option value="newest">Newest</option>
          <option value="rating">Highest Rated</option>
          <option value="reads">Most Read</option>
        </select>

        <div className="grid grid-cols-2 rounded-xl border border-[#d7d9e3] bg-white p-1">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
            className={[
              "flex h-8 w-8 items-center justify-center rounded-md",
              viewMode === "grid" ? "bg-[#5f2acc] text-white" : "text-[#646b84]",
            ].join(" ")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
            className={[
              "flex h-8 w-8 items-center justify-center rounded-md",
              viewMode === "list" ? "bg-[#5f2acc] text-white" : "text-[#646b84]",
            ].join(" ")}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={viewMode === "grid" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "space-y-3"}>
        {filtered.map((paper) => (
          <div key={paper.id || paper.paperId}>
            <button
              type="button"
              onClick={() => navigate(`/paper/${encodeURIComponent(paper.paperId)}`)}
              className="w-full rounded-2xl border border-[#dde0ea] bg-white text-left shadow-none transition-colors hover:border-[#b8bcd0]"
            >
              <div className={viewMode === "list" ? "flex items-center gap-4 p-4" : "p-5"}>
                <div className={viewMode === "list" ? "min-w-0 flex-1" : ""}>
                  {(() => {
                    const displayStatus = resolveDisplayStatus(paper);
                    const authorLabel = resolveAuthorLabel(paper, displayStatus);
                    return (
                      <>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded-full bg-[#f0eff4] px-2.5 py-1 text-xs font-semibold text-[#22263a]">
                            {toTitleCase(paper.category)}
                          </span>
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-xs font-semibold",
                              statusClass(displayStatus),
                            ].join(" ")}
                          >
                            {formatStatusLabel(displayStatus)}
                          </span>
                        </div>

                        <h3 className="mb-2 line-clamp-2 text-sm font-semibold leading-snug text-[#111322]">
                          {toTitleCase(paper.title)}
                        </h3>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-[#666b84]">
                          <span className={displayStatus === "published" ? "" : "font-mono"}>{authorLabel}</span>
                          <span>{paper.date}</span>
                          <span className="inline-flex items-center gap-1 text-[#5f2acc]">
                            <Star className="h-3 w-3" />
                            {formatRating(paper.stars)}
                          </span>
                          {paper.saved ? <span className="rounded-full bg-[#ece7f8] px-2 py-0.5 text-xs text-[#6828ce]">Saved</span> : null}
                        </div>
                      </>
                    );
                  })()}

                  {viewMode === "grid" ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {paper.tags?.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-[#f0eff4] px-2 py-0.5 text-xs text-[#616783]"
                        >
                          {toTitleCase(tag)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </button>
            {resolveIpfsUrl(paper.manuscriptCid) ? (
              <div className="mt-2 flex justify-end px-1">
                <a
                  href={resolveIpfsUrl(paper.manuscriptCid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#ece7f8] px-3 py-1.5 text-xs font-semibold text-[#6828ce] hover:bg-[#dcd5f5]"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View PDF
                </a>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {filtered.length === 0 ? <TabState type="empty" title="No papers found" className="py-12" /> : null}
    </div>
  );
}
