import { Coins, Eye, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PageTransition from "../components/PageTransition";

const cards = [
  {
    icon: Shield,
    title: "Pseudonymous Reviews",
    desc: "Wallet-based identity ensures unbiased peer review",
  },
  {
    icon: Coins,
    title: "Token Rewards",
    desc: "Earn tokens for quality reviews and contributions",
  },
  {
    icon: Eye,
    title: "Open Access",
    desc: "Free reading for everyone, stored on IPFS",
  },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <PageTransition>
      <div className="h-screen bg-[#f6f6f9] text-[#161824]">
        <header className="border-b border-[#e7e8ef] bg-[#f6f6f9]">
          <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-7 py-3">
            <div className="text-xl font-extrabold tracking-tight text-[#0f1220]">
              Decentra<span className="text-[#5f2acc]">Scholar</span>
            </div>
            <button
              type="button"
              onClick={() => navigate("/auth/connect-wallet")}
              className="rounded-xl bg-[#612bd1] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#5526b8]"
            >
              Get Started
            </button>
          </div>
        </header>

        <main className="mx-auto flex h-[calc(100vh-118px)] w-full max-w-[1280px] flex-col justify-between px-7 pb-5 pt-6">
          <section className="text-center">
            <div className="inline-flex rounded-full bg-[#e8e3f6] px-4 py-1 text-xs font-semibold text-[#4f2ab6]">
              Decentralised Academic Publishing
            </div>

            <h1 className="mx-auto mt-5 max-w-4xl text-3xl font-extrabold leading-tight tracking-tight text-[#181924] md:text-4xl">
              Publish. Review.
              <br />
              <span className="text-[#5f2acc]">Own Your Research.</span>
            </h1>

            <p className="mx-auto mt-4 max-w-3xl text-sm leading-relaxed text-[#5f647c] md:text-base">
              A peer-review platform where your identity is your wallet, reviews
              are transparent, and quality contributions are rewarded with
              tokens.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/auth/connect-wallet")}
                className="rounded-xl bg-[#612bd1] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5526b8]"
              >
                Get Started
              </button>
              <button
                type="button"
                onClick={() => navigate("/learn-more")}
                className="rounded-xl border border-[#d6d8e3] bg-white px-6 py-2.5 text-sm font-semibold text-[#161824]"
              >
                Learn More
              </button>
            </div>
          </section>

          <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="rounded-2xl border border-[#e1e3ec] bg-[#f8f8fb] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#a487df] hover:shadow-sm"
                >
                  <div className="mb-4 inline-flex rounded-2xl bg-[#ece7f8] p-3">
                    <Icon className="h-6 w-6 text-[#5f2acc]" />
                  </div>
                  <h3 className="text-xl font-semibold text-[#111322]">{card.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#5f647c]">{card.desc}</p>
                </div>
              );
            })}
          </section>
        </main>

        <footer className="border-t border-[#e7e8ef] py-3 text-center text-xs text-[#5f647c]">
          (c) 2026 DecentraScholar. Built for open science.
        </footer>
      </div>
    </PageTransition>
  );
}
