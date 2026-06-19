import { Eye, Star } from "lucide-react";

function StatusBadge({ status }) {
  const map = {
    published: "bg-[#ececf1] text-[#6f748e]",
    "under review": "bg-[#ece7f8] text-[#6828ce]",
    accepted: "bg-[#dcf5e7] text-[#17a35b]",
  };
  return (
    <span className={["rounded-full px-3 py-1 text-xs font-semibold", map[status] || "bg-[#ececf1] text-[#6f748e]"].join(" ")}>
      {status}
    </span>
  );
}

export default function PaperCard({ p }) {
  const rating = Number(p?.stars || 0).toFixed(1);
  return (
    <div className="rounded-2xl border border-[#dde0ea] bg-white p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#f0eff4] px-3 py-1 text-xs font-semibold text-[#22263a]">
          {p.category}
        </span>
        <StatusBadge status={p.status} />
      </div>

      <h3 className="mt-3 text-2xl font-semibold leading-snug text-[#111322]">
        {p.title}
      </h3>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[#666b84]">
        <span className="font-mono">{p.author}</span>
        <span>{p.date}</span>
        <span className="inline-flex items-center gap-1">
          <Eye className="h-4 w-4" />
          {p.reads}
        </span>
        <span className="inline-flex items-center gap-1 text-[#6828ce]">
          <Star className="h-4 w-4" />
          {rating}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {p.tags?.map((tag) => (
          <span key={tag} className="rounded-full bg-[#f0eff4] px-3 py-1 text-xs text-[#616783]">
            {tag}
          </span>
        ))}
      </div>

    </div>
  );
}
