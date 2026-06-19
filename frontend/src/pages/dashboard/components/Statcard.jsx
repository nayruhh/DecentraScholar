export default function StatCard({ label, value, icon, tone = "purple" }) {
  const toneMap = {
    purple: "text-[#6828ce]",
    blue: "text-blue-600",
    green: "text-green-600",
  };

  return (
    <div className="rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-[#6b5d78]">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-[#2b2333]">
            {value}
          </div>
        </div>
        <div className={["mt-1", toneMap[tone] || toneMap.purple].join(" ")}>
          {icon}
        </div>
      </div>
    </div>
  );
}
