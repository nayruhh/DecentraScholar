export default function CardShell({ title, subtitle, right, children }) {
  return (
    <div className="rounded-2xl bg-white shadow-lg ring-1 ring-black/5">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[#2b2333]">{title}</h2>
            {subtitle ? (
              <p className="mt-1 text-xs text-[#6b5d78]">{subtitle}</p>
            ) : null}
          </div>
          {right ? <div>{right}</div> : null}
        </div>

        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
