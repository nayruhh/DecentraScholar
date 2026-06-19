import { Check } from "lucide-react";

function StepItem({ index, label, state }) {
  const isDone = state === "done";
  const isActive = state === "active";

  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold",
          isDone || isActive
            ? "bg-[#652ed1] text-white"
            : "bg-[#ebebef] text-[#636983]",
        ].join(" ")}
      >
        {isDone ? <Check className="h-5 w-5" /> : index}
      </div>
      <span
        className={[
          "text-base",
          isActive ? "font-semibold text-[#111322]" : "text-[#5d647d]",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}

function Divider({ active }) {
  return (
    <div className={["h-px w-14", active ? "bg-[#652ed1]" : "bg-[#d8dae5]"].join(" ")} />
  );
}

export default function AuthStepShell({ step = 1, children }) {
  const connectState = step > 1 ? "done" : step === 1 ? "active" : "idle";
  const verifyState = step === 2 ? "active" : "idle";
  const dashboardState = "idle";

  return (
    <div className="min-h-screen bg-[#f5f5f7] px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-10 flex items-center justify-center gap-5">
          <StepItem index={1} label="Connect" state={connectState} />
          <Divider active={step >= 2} />
          <StepItem index={2} label="Verify" state={verifyState} />
          <Divider active={false} />
          <StepItem index={3} label="Dashboard" state={dashboardState} />
        </div>
        {children}
      </div>
    </div>
  );
}
