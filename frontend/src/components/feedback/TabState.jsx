import { AlertCircle, Inbox, Loader2 } from "lucide-react";

const styleMap = {
  empty: {
    container: "bg-white text-[#7b8099]",
    icon: Inbox,
  },
  loading: {
    container: "bg-white text-[#5f657d]",
    icon: Loader2,
    spin: true,
  },
  error: {
    container: "bg-red-50 text-red-800",
    icon: AlertCircle,
  },
};

export default function TabState({ type = "empty", title, description, className = "" }) {
  const resolved = styleMap[type] || styleMap.empty;
  const Icon = resolved.icon;
  return (
    <div className={["rounded-2xl p-8 text-center ring-1 ring-black/5", resolved.container, className].join(" ")}>
      <Icon className={["mx-auto mb-3 h-10 w-10 opacity-70", resolved.spin ? "animate-spin" : ""].join(" ")} />
      {title ? <p className="text-base font-semibold text-[#111322]">{title}</p> : null}
      {description ? <p className="mt-1 text-sm">{description}</p> : null}
    </div>
  );
}
