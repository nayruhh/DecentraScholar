import {
  ArrowRight,
  BookOpen,
  Coins,
  Eye,
  FileText,
  Lock,
  Scale,
  Shield,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import PageTransition from "../components/PageTransition";

const howItWorks = [
  {
    step: "1",
    title: "Connect Your Wallet",
    description:
      "Link your wallet to create a pseudonymous identity without exposing personal details.",
    icon: Lock,
  },
  {
    step: "2",
    title: "Publish Your Research",
    description:
      "Upload paper metadata and files with tamper-evident records for provenance and transparency.",
    icon: FileText,
  },
  {
    step: "3",
    title: "Blind Peer Review",
    description:
      "Three independent reviewers evaluate work privately before panel deliberation.",
    icon: Users,
  },
  {
    step: "4",
    title: "Consensus Decision",
    description:
      "Final outcome is decided by the same 3-reviewer panel, including rebuttal when needed.",
    icon: Scale,
  },
];

const reviewRules = [
  { scenario: "3 Accept", result: "Accepted", tone: "green" },
  { scenario: "2 Accept, 1 Reject", result: "Accepted", tone: "green" },
  { scenario: "2 Accept, 1 Neutral", result: "Accepted", tone: "green" },
  { scenario: "3 Reject", result: "Rejected", tone: "red" },
  { scenario: "2 Reject, 1 Accept", result: "Rejected", tone: "red" },
  { scenario: "2 Reject, 1 Neutral", result: "Rejected", tone: "red" },
  { scenario: "2 Neutral, 1 Accept", result: "Accepted", tone: "green" },
  { scenario: "2 Neutral, 1 Reject", result: "Rejected", tone: "red" },
  { scenario: "1 Accept, 1 Neutral, 1 Reject", result: "Rebuttal Phase", tone: "purple" },
  { scenario: "3 Neutral", result: "Rebuttal Phase", tone: "purple" },
  { scenario: "Deadline expires before full panel resolution", result: "Abandoned", tone: "slate" },
];

const features = [
  {
    icon: Shield,
    title: "Pseudonymous Identity",
    description:
      "Use wallet-based identities to publish and review without exposing private personal information.",
  },
  {
    icon: FileText,
    title: "Publication Identity",
    description:
      "Authors can set a first and last name in Profile for published papers. If left blank, the wallet address is shown instead.",
  },
  {
    icon: Eye,
    title: "Transparent Review Trail",
    description:
      "Review rounds and final decisions are auditable, giving every paper a clear accountability trail.",
  },
  {
    icon: Coins,
    title: "Token Rewards",
    description:
      "Reviewers must stake DST tokens to join a paper review, and can earn only from that paper's reserved reviewer pool. Slashed stake is routed to the FeeVault to support storage commission and protocol operations.",
  },
  {
    icon: Users,
    title: "3-Reviewer Consensus",
    description:
      "Each paper is evaluated by three independent reviewers for balanced, decentralised decision-making.",
  },
  {
    icon: Scale,
    title: "Structured Rebuttal",
    description:
      "When reviewers disagree, the same panel enters rebuttal and re-votes. No 4th reviewer is introduced.",
  },
  {
    icon: BookOpen,
    title: "Personal Library",
    description:
      "Save and revisit papers you like in a curated library tailored to your research interests.",
  },
];

function ruleTone(tone) {
  if (tone === "green") return "bg-[#def4e8] text-[#10a452]";
  if (tone === "red") return "bg-[#fde4e4] text-[#ef4444]";
  if (tone === "slate") return "bg-[#ececf1] text-[#6f748e]";
  return "bg-[#ece7f8] text-[#6828ce]";
}

export default function LearnMore() {
  const navigate = useNavigate();

  return (
    <PageTransition>
      <div className="min-h-screen bg-[#f6f6f9] text-[#161824]">
        <header className="border-b border-[#e7e8ef] bg-[#f6f6f9]">
          <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-7 py-4">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-xl font-extrabold tracking-tight text-[#0f1220]"
            >
              Decentra<span className="text-[#6828ce]">Scholar</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/auth/connect-wallet")}
              className="rounded-xl bg-[#6828ce] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#5a24b4]"
            >
              Get Started
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] px-7 pb-14 pt-16">
          <section className="text-center">
            <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight text-[#181924] md:text-5xl">
              How Decentra<span className="text-[#6828ce]">Scholar</span> Works
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-[#5f647c] md:text-lg">
              A decentralised platform for academic publishing and peer review,
              powered by wallet identity, transparent governance, and aligned
              token incentives.
            </p>
          </section>

          <section className="mt-16">
            <h2 className="text-center text-3xl font-bold text-[#111322]">Getting Started</h2>
            <p className="mt-1 text-center text-sm text-[#7b8099]">
              Four steps from wallet connection to publication decisions
            </p>
            <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {howItWorks.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.step}
                    className="rounded-2xl border border-[#e1e3ec] bg-[#f8f8fb] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#a487df] hover:shadow-sm"
                  >
                    <div className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#6828ce] text-sm font-bold text-white">
                      {item.step}
                    </div>
                    <div className="mb-3 inline-flex rounded-xl bg-[#ece7f8] p-3">
                      <Icon className="h-5 w-5 text-[#6828ce]" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#111322]">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#5f647c]">{item.description}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-16 rounded-2xl border border-[#e1e3ec] bg-white p-6 md:p-8">
            <h2 className="text-center text-3xl font-bold text-[#111322]">Review Consensus Rules</h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-[#7b8099]">
              Outcomes are determined by the same 3-reviewer panel, with an explicit terminal state when the deadline expires before the panel resolves.
            </p>

            <div className="mx-auto mt-7 max-w-3xl space-y-3">
              {reviewRules.map((rule) => (
                <div
                  key={rule.scenario}
                  className="flex items-center justify-between rounded-xl border border-[#d7d9e3] bg-[#fbfbfd] px-4 py-3"
                >
                  <span className="text-sm font-medium text-[#111322]">{rule.scenario}</span>
                  <span className={["rounded-full px-3 py-1 text-xs font-semibold", ruleTone(rule.tone)].join(" ")}>
                    {rule.result}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-16">
            <h2 className="text-center text-3xl font-bold text-[#111322]">Platform Features</h2>
            <p className="mt-1 text-center text-sm text-[#7b8099]">
              Core mechanics designed for trust, fairness, and open research
            </p>

            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                const isBottomCenteredCard = feature.title === "Personal Library";
                return (
                  <div
                    key={feature.title}
                    className={[
                      "rounded-2xl border border-[#e1e3ec] bg-[#f8f8fb] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#a487df] hover:shadow-sm",
                      isBottomCenteredCard
                        ? "md:col-span-2 md:mx-auto md:w-full md:max-w-xl lg:col-span-1 lg:col-start-2"
                        : "",
                    ].join(" ")}
                  >
                    <div className="mb-4 inline-flex rounded-xl bg-[#ece7f8] p-3">
                      <Icon className="h-5 w-5 text-[#6828ce]" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#111322]">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#5f647c]">{feature.description}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-16 rounded-2xl border border-[#e1e3ec] bg-[#f8f8fb] p-8 text-center">
            <h2 className="text-3xl font-bold text-[#111322]">Ready to get started?</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[#5f647c]">
              Connect your wallet and join a decentralised community for fair, transparent academic publishing.
            </p>
            <button
              type="button"
              onClick={() => navigate("/auth/connect-wallet")}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#6828ce] px-8 py-3 text-base font-semibold text-white transition hover:bg-[#5a24b4]"
            >
              Connect Wallet
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        </main>

        <footer className="border-t border-[#e7e8ef] py-10 text-center text-sm text-[#5f647c]">
          (c) 2026 DecentraScholar. Built for open science.
        </footer>
      </div>
    </PageTransition>
  );
}
