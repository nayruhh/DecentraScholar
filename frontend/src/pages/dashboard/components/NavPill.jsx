import { Link } from "react-router-dom";

export default function NavPill({ active, onClick, icon, label, to }) {
  const className = [
    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition",
    "shadow-sm ring-1 ring-black/5",
    active
      ? "bg-[#6828ce] text-white"
      : "bg-white text-[#3a2d46] hover:bg-black/[0.03]",
  ].join(" ");

  if (to) {
    return (
      <Link to={to} className={className}>
        {icon}
        {label}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      {icon}
      {label}
    </button>
  );
}
