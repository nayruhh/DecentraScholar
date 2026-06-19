import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, LayoutGrid, List, Search, Star } from "lucide-react";
import TabHeader from "../../../components/feedback/TabHeader";
import TabState from "../../../components/feedback/TabState";

function formatRating(value) {
  return Number(value || 0).toFixed(1);
}

export default function LibraryTab({ savedPapers, isLoading = false, error = "" }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState("grid");

  const likedPapers = useMemo(
    () => (savedPapers || []).filter((paper) => Boolean(paper.saved)),
    [savedPapers]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = likedPapers.filter(
      (p) =>
        p.title.toLowerCase().includes(query) ||
        (p.tags || []).some((tag) => tag.toLowerCase().includes(query))
    );

    if (sortBy === "newest") {
      result = [...result].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    } else if (sortBy === "rating") {
      result = [...result].sort((a, b) => (b.stars || 0) - (a.stars || 0));
    } else if (sortBy === "reads") {
      result = [...result].sort((a, b) => (b.reads || 0) - (a.reads || 0));
    }

    return result;
  }, [likedPapers, search, sortBy]);

  if (isLoading) {
    return <TabState type="loading" title="Loading library" description="Fetching your saved papers." />;
  }

  if (error) {
    return <TabState type="error" title="Could not load library" description={error} />;
  }

  return (
    <div className="space-y-6">
      <TabHeader title="My Library" subtitle="Browse papers you have liked and saved" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b8099]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search liked papers..."
            className="w-full rounded-xl border border-[#d7d9e3] bg-white py-3 pl-9 pr-3 text-sm outline-none"
          />
        </div>

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
              viewMode === "grid" ? "bg-[#6828ce] text-white" : "text-[#646b84]",
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
              viewMode === "list" ? "bg-[#6828ce] text-white" : "text-[#646b84]",
            ].join(" ")}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={viewMode === "grid" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "space-y-3"}>
        {filtered.map((paper) => (
          <button
            key={paper.id}
            type="button"
            onClick={() => navigate(`/paper/${paper.paperId}`)}
            className="w-full rounded-2xl border border-[#dde0ea] bg-white text-left transition-colors hover:border-[#b8bcd0]"
          >
            <div className={viewMode === "list" ? "flex items-center gap-4 p-4" : "p-5"}>
              <div className={viewMode === "list" ? "min-w-0 flex-1" : ""}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full bg-[#f0eff4] px-2.5 py-1 text-xs font-semibold text-[#22263a]">
                    {paper.category || paper.tag || "General"}
                  </span>
                  <span className="rounded-full bg-[#ece7f8] px-2.5 py-1 text-xs font-semibold text-[#6828ce]">
                    Liked
                  </span>
                </div>

                <h3 className="mb-2 line-clamp-2 text-sm font-semibold leading-snug text-[#111322]">
                  {paper.title}
                </h3>

                <div className="flex flex-wrap items-center gap-3 text-xs text-[#666b84]">
                  <span>{paper.authorName || paper.authorWallet || "Unknown Author"}</span>
                  <span>{paper.date}</span>
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {paper.reads || 0}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[#6828ce]">
                    <Star className="h-3 w-3" />
                    {formatRating(paper.stars)}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? <TabState type="empty" title="No liked papers found" className="py-12" /> : null}
    </div>
  );
}
