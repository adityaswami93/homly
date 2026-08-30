"use client";

import { useState } from "react";
import Link from "next/link";
import config from "@/lib/config";

/* ---------------------------------------------------------------- icons */

const ICON_PATHS: Record<string, string> = {
  chat:     "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  wallet:   "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5M16 12h.01",
  supplies: "M3 7h18l-1.4 12.2a2 2 0 0 1-2 1.8H6.4a2 2 0 0 1-2-1.8L3 7zM8 7V5a4 4 0 0 1 8 0v2M9 12v4M15 12v4",
  people:   "M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  shield:   "M12 22s8-4 8-10V5.5L12 2.5 4 5.5V12c0 6 8 10 8 10zM9 12l2 2 4-4",
  scan:     "M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16M7 12h10",
  memory:   "M19 21l-7-4.8L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  bolt:     "M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z",
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/* ----------------------------------------------------------------- data */

/** The domains the agent owns — proves the scope is the household, not a ledger. */
const DOMAINS = [
  {
    icon:  "wallet",
    title: "Money",
    desc:  "Every receipt read and categorised, budgets tracked against actual spend, what you owe your helper settled to the cent, and price trends across the shops you actually use.",
  },
  {
    icon:  "supplies",
    title: "Supplies",
    desc:  "Knows what is in your pantry and what ran out. Shopping lists build themselves as stock runs down or a recipe needs something you do not have.",
  },
  {
    icon:  "people",
    title: "People and schedule",
    desc:  "Chore schedules and who did what, helper leave requests and approvals, and the daily rhythm of the house — without anyone maintaining a rota.",
  },
  {
    icon:  "shield",
    title: "Cover and renewals",
    desc:  "Your insurance policies, what they cover, where the gaps are, and a warning well before anything lapses or auto-renews at a worse rate.",
  },
];

/** How the agent behaves — proves it is an agent, not a set of forms. */
const BEHAVIOURS = [
  {
    icon:  "scan",
    title: "It reads",
    desc:  "Photograph a receipt and it becomes structured data — vendor, items, categories — with no one typing anything in. Same for a fridge shelf or a policy document.",
  },
  {
    icon:  "memory",
    title: "It remembers",
    desc:  "Standing preferences, dietary rules, how far ahead you like to be warned, who handles what. Tell it once and it carries that into every future decision.",
  },
  {
    icon:  "bolt",
    title: "It acts on its own",
    desc:  "It reviews the household every morning and raises what matters — a budget about to break, a renewal closing in, a chore that keeps getting missed.",
  },
  {
    icon:  "chat",
    title: "It answers",
    desc:  "Ask anything about your household in plain language and get a real answer, drawn from everything above rather than a single table.",
  },
];

const CHAT = [
  { from: "them", name: "Helper",  receipt: { vendor: "NTUC FairPrice", total: "$84.20" } },
  { from: "bot",  text: "Filed — NTUC FairPrice, $84.20. 12 items, mostly groceries. Rice and oil were running low; both are stocked again." },
  { from: "them", name: "Priya",   text: "are we ok on the grocery budget this month?" },
  { from: "bot",  text: "$612.40 across 9 receipts — about 12% under your $700 budget with 4 days to go." },
  { from: "bot",  text: "Separately: your car insurance renews in 7 days at $1,240, up $180 on last year. Worth a look before it auto-renews." },
];

const FAQS = [
  {
    q: "Is Homly an expense tracker?",
    a: "Spending is one of the things it manages, not the whole of it. It also runs chore schedules and helper leave, pantry and shopping lists, budgets, and insurance cover and renewals — as one assistant with a single picture of your household, rather than separate tools.",
  },
  {
    q: "Do I have to use WhatsApp?",
    a: "No. WhatsApp is simply the easiest place to reach it, because it is where your household already talks. Everything is equally available on the dashboard, and anything done in one shows up in the other.",
  },
  {
    q: "Does my helper need to install anything?",
    a: "No. They send receipt photos to the group exactly as they do today. There is no app, no account and nothing to learn on their side.",
  },
  {
    q: "What does it do without being asked?",
    a: "It reviews your household each morning and raises only what is worth raising — a budget heading over, a renewal approaching, a chore repeatedly missed. It stays quiet when there is nothing to say, and you can turn this off entirely.",
  },
  {
    q: "Is my data secure?",
    a: "Each household's data is fully isolated from every other. Receipt images are stored privately, the dashboard is password protected, and nothing is shared or sold.",
  },
  {
    q: "How much does it cost?",
    a: "Free during early access. A paid plan at SGD 9.99/month is planned after launch, and early access members will get plenty of notice before anything changes.",
  },
];

/* ----------------------------------------------------------- components */

function WaitlistForm() {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState("");

  const handleSubmit = async () => {
    if (!email || !email.includes("@")) { setError("Enter a valid email"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/waitlist`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed");
      setDone(true);
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="text-center">
        <p className="text-emerald-400 font-medium text-lg mb-1">You&apos;re on the list</p>
        <p className="text-stone-400 text-sm">We&apos;ll be in touch when your spot is ready.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2 w-full max-w-md mx-auto">
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(""); }}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/60 transition text-sm"
      />
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition text-sm whitespace-nowrap min-h-[44px]"
      >
        {loading ? "Joining..." : "Join waitlist"}
      </button>
      {error && (
        <p className="text-red-400 text-xs mt-1 w-full">{error}</p>
      )}
    </div>
  );
}

type ChatMessage = {
  from:     "them" | "bot";
  name?:    string;
  text?:    string;
  receipt?: { vendor: string; total: string };
};

function ChatDemo() {
  return (
    <div className="bg-stone-900/70 border border-stone-800 rounded-2xl p-4 md:p-5">
      <div className="flex items-center gap-3 pb-4 mb-4 border-b border-stone-800">
        <div className="w-9 h-9 rounded-full bg-stone-800 flex items-center justify-center text-stone-400 text-xs font-semibold">
          FH
        </div>
        <div className="min-w-0">
          <p className="text-stone-200 text-sm font-medium truncate">Family — Home</p>
          <p className="text-stone-500 text-xs truncate">You, Priya, Helper, Homly</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {(CHAT as ChatMessage[]).map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.from === "bot" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                msg.from === "bot"
                  ? "bg-emerald-600/15 border border-emerald-500/25"
                  : "bg-stone-800/80 border border-stone-700/60"
              }`}
            >
              {msg.from === "bot" && (
                <p className="text-emerald-400/80 text-[10px] font-semibold tracking-wide mb-1">
                  HOMLY
                </p>
              )}
              {msg.name && (
                <p className="text-stone-400 text-[10px] font-semibold tracking-wide mb-1">
                  {msg.name.toUpperCase()}
                </p>
              )}

              {msg.receipt ? (
                <div className="bg-stone-950/60 border border-stone-700/60 rounded-lg px-3 py-2.5 w-44">
                  <div className="space-y-1">
                    <div className="h-1.5 w-20 rounded-full bg-stone-700" />
                    <div className="h-1.5 w-28 rounded-full bg-stone-800" />
                    <div className="h-1.5 w-24 rounded-full bg-stone-800" />
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-stone-800 flex items-baseline justify-between">
                    <span className="text-stone-400 text-[11px]">{msg.receipt.vendor}</span>
                    <span className="text-stone-200 text-xs font-semibold">{msg.receipt.total}</span>
                  </div>
                </div>
              ) : (
                <p className="text-stone-200 text-sm leading-relaxed">{msg.text}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardGrid({
  items,
}: {
  items: { icon: string; title: string; desc: string }[];
}) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {items.map((item) => (
        <div
          key={item.title}
          className="bg-stone-900/40 border border-stone-800 rounded-2xl p-6 hover:border-stone-700 transition-colors"
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
            <Icon name={item.icon} />
          </div>
          <h3 className="text-stone-100 font-medium mb-2">{item.title}</h3>
          <p className="text-stone-500 text-sm leading-relaxed">{item.desc}</p>
        </div>
      ))}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-stone-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-stone-900/40 transition-colors min-h-[44px]"
      >
        <p className="text-stone-200 text-sm font-medium pr-4">{q}</p>
        <span className={`text-stone-500 transition-transform duration-200 shrink-0 ${open ? "rotate-45" : ""}`}>
          +
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4">
          <p className="text-stone-400 text-sm leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">

      {/* Nav */}
      <nav className="max-w-5xl mx-auto px-4 md:px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center">
            <span className="text-xs font-bold text-white">H</span>
          </div>
          <span className="font-semibold tracking-tight">{config.appName}</span>
        </div>
        <Link
          href="/login"
          className="text-sm text-stone-400 hover:text-stone-200 transition-colors"
        >
          Sign in →
        </Link>
      </nav>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-4 md:px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-300 text-xs font-medium">Early access — Singapore</span>
        </div>

        <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight mb-6">
          The agent that{" "}
          <span className="text-emerald-400">runs your household</span>
        </h1>

        <p className="text-stone-400 text-lg md:text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
          {config.description}
        </p>

        <WaitlistForm />

        <p className="text-stone-600 text-xs mt-4">
          Free during early access · No credit card required
        </p>
      </section>

      {/* What it runs */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            What it runs
          </h2>
          <p className="text-stone-400 text-base max-w-xl mx-auto">
            Not four apps that happen to share a login. One assistant with a single
            picture of the household, so each part informs the rest.
          </p>
        </div>
        <CardGrid items={DOMAINS} />
      </section>

      {/* How it behaves */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            It works like an assistant, not a form
          </h2>
          <p className="text-stone-400 text-base max-w-xl mx-auto">
            Nobody in your household has to maintain it. That is the point.
          </p>
        </div>
        <CardGrid items={BEHAVIOURS} />
      </section>

      {/* How you reach it */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            Reach it wherever you already are
          </h2>
          <p className="text-stone-400 text-base max-w-xl mx-auto">
            The assistant is the product. WhatsApp and the dashboard are just two doors
            into it, and both show the same household.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          <ChatDemo />

          <div className="space-y-4">
            <div className="bg-stone-900/40 border border-stone-800 rounded-2xl p-6">
              <h3 className="text-stone-100 font-medium mb-2">In your group chat</h3>
              <p className="text-stone-500 text-sm leading-relaxed">
                Add Homly to the household WhatsApp group you already have. Your helper
                keeps sending receipt photos exactly as they do now — no app, no account,
                nothing to learn. Anyone in the group can ask it something.
              </p>
            </div>

            <div className="bg-stone-900/40 border border-stone-800 rounded-2xl p-6">
              <h3 className="text-stone-100 font-medium mb-2">On the dashboard</h3>
              <p className="text-stone-500 text-sm leading-relaxed">
                When you want the full picture — spending by week and category, budgets,
                policies, chore history, price trends — it is all there, in sync with
                everything that happened in the chat.
              </p>
            </div>

            <div className="bg-stone-900/40 border border-stone-800 rounded-2xl p-6">
              <h3 className="text-stone-100 font-medium mb-2">Set up in about a minute</h3>
              <p className="text-stone-500 text-sm leading-relaxed">
                One number added to one group, and a short setup on the dashboard.
                Nothing to roll out to the rest of the household.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            Simple pricing
          </h2>
          <p className="text-stone-400 text-base">
            Free during early access. No surprises.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* Free */}
          <div className="bg-stone-900/40 border border-stone-800 rounded-2xl p-6">
            <p className="text-stone-400 text-sm mb-2">Early access</p>
            <p className="text-3xl font-bold mb-1">Free</p>
            <p className="text-stone-500 text-sm mb-6">While we&apos;re in early access</p>
            <ul className="space-y-2.5 text-sm text-stone-400">
              {[
                "The full assistant",
                "Unlimited receipts",
                "Money, supplies, schedule, cover",
                "WhatsApp and dashboard",
                "Up to 2 household members",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-emerald-400 text-xs">✓</span> {f}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <WaitlistForm />
            </div>
          </div>

          {/* Paid */}
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-6">
            <p className="text-emerald-400/70 text-sm mb-2">After launch</p>
            <div className="flex items-end gap-1 mb-1">
              <p className="text-3xl font-bold">SGD 9.99</p>
              <p className="text-stone-400 text-sm mb-1">/month</p>
            </div>
            <p className="text-stone-500 text-sm mb-6">Early access members get notice first</p>
            <ul className="space-y-2.5 text-sm text-stone-400">
              {[
                "Everything in early access",
                "Unlimited history",
                "Unlimited members",
                "PayNow QR generation",
                "Priority support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-emerald-400 text-xs">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-2xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            Common questions
          </h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-stone-800/60 py-20">
        <div className="max-w-xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            Stop running your household from memory
          </h2>
          <p className="text-stone-400 text-base mb-8">
            Join the waitlist and we will set you up when your spot is ready.
          </p>
          <WaitlistForm />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800/40 py-8">
        <div className="max-w-5xl mx-auto px-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-emerald-500 flex items-center justify-center">
              <span className="text-[9px] font-bold text-white">H</span>
            </div>
            <span className="text-stone-400 text-sm">{config.appName}</span>
          </div>
          <p className="text-stone-600 text-xs">
            Built for Singapore households · {new Date().getFullYear()}
          </p>
          <Link href="/login" className="text-stone-600 hover:text-stone-400 text-xs transition-colors">
            Sign in
          </Link>
        </div>
      </footer>

    </main>
  );
}
