import { CheckCircle, CircleCheck, Clock3, Inbox, MinusCircle, XCircle } from "lucide-react";

export function SubNav({ active, setActive }) {
  const tabClass = (isActive) =>
    [
      "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition shadow-sm",
      isActive
        ? "bg-[#6828ce] text-white hover:bg-[#5a24b4]"
        : "bg-white text-[#6828ce] hover:bg-[#f3ecff]",
    ].join(" ");

  return (
    <div className="sticky top-0 z-20 -mx-6 mt-4 px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setActive("incoming")} className={tabClass(active === "incoming")}>
          <Inbox className="h-4 w-4" />
          Incoming Requests
        </button>
        <button type="button" onClick={() => setActive("completed")} className={tabClass(active === "completed")}>
          <CheckCircle className="h-4 w-4" />
          Completed Reviews
        </button>
      </div>
    </div>
  );
}

export function StatusPill({ status }) {
  const map = {
    pending: "bg-gray-100 text-gray-700",
    accepted: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
  };
  const label = String(status || "")
    .split("_")
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
  return (
    <span
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold",
        map[status] || "bg-gray-100 text-gray-700",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

export function VotePill({ vote }) {
  const normalized = String(vote || "").toLowerCase();
  const label =
    normalized === "accept"
      ? "Accept"
      : normalized === "neutral"
        ? "Neutral"
        : normalized === "reject"
          ? "Reject"
          : "Pending";
  const map = {
    Accept: "bg-[#def4e8] text-[#10a452] border-[#9dd9b8]",
    Neutral: "bg-[#fff2df] text-[#d68000] border-[#f2c47d]",
    Reject: "bg-[#fde4e4] text-[#ef4444] border-[#f4b1b1]",
    Pending: "bg-[#ececf1] text-[#5f657d] border-[#d9dbe5]",
  };

  const Icon =
    label === "Accept"
      ? CircleCheck
      : label === "Neutral"
        ? MinusCircle
        : label === "Reject"
          ? XCircle
          : Clock3;

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium",
        map[label] || "bg-[#ececf1] text-[#5f657d] border-[#d9dbe5]",
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
}
