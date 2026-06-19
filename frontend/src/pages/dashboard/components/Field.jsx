export default function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#2b2333]">
        {label}
      </label>
      {hint ? <div className="mt-1 text-xs text-[#6b5d78]">{hint}</div> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}
