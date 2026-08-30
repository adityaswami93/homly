"use client";

import { useState } from "react";
import Link from "next/link";
import config from "@/lib/config";

/* ---------------------------------------------------------------- icons */

const ICON_PATHS: Record<string, string> = {
  chat:     "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  receipt:  "M4 3v18l2.5-1.5L9 21l2.5-1.5L14 21l2.5-1.5L19 21V3l-2.5 1.5L14 3l-2.5 1.5L9 3 6.5 4.5 4 3zM8 9h7M8 13h7",
  ask:      "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  bell:     "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  wallet:   "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5M16 12h.01",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 16l2 2 4-4",
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

const FEATURES = [
  {
    icon:  "chat",
    title: "Nothing new for your helper",
    desc:  "They send receipt photos to the same group they already use. No app to install, no account, no training.",
  },
  {
    icon:  "receipt",
    title: "Receipts read on arrival",
    desc:  "Vendor, total and line items are extracted and categorised within seconds. Anything unclear is flagged for you to check.",
  },
  {
    icon:  "ask",
    title: "Ask in plain English",
    desc:  "\"How much on groceries this month?\" \"When does the car insurance renew?\" Ask in the group and get an answer back.",
  },
  {
    icon:  "bell",
    title: "Tells you before you ask",
    desc:  "Homly reviews your household each morning and speaks up about what matters — over budget, a renewal due, a chore missed.",
  },
  {
    icon:  "wallet",
    title: "Reimbursements without the spreadsheet",
    desc:  "A running balance of what you owe your helper, down to the receipt. Mark it paid and the balance clears.",
  },
  {
    icon:  "calendar",
    title: "Chores, leave and renewals",
    desc:  "Daily chore reminders in the group, leave requests you can approve, and insurance renewals flagged well ahead of time.",
  },
];

const STEPS = [
  {
    number: "01",
    title:  "Add Homly to your group",
    desc:   "One number added to the household WhatsApp group you already have. Takes about a minute.",
  },
  {
    number: "02",
    title:  "Everyone carries on as normal",
    desc:   "Your helper photographs receipts the way they always have. Homly picks them up and files them.",
  },
  {
    number: "03",
    title:  "Ask, or just get told",
    desc:   "Question in the chat when you want something. A dashboard when you want the full picture.",
  },
];

type ChatMessage = {
  from:     "them" | "bot";
  name?:    string;
  text?:    string;
  receipt?: { vendor: string; total: string };
};

const CHAT: ChatMessage[] = [
  { from: "them", name: "Helper",  receipt: { vendor: "NTUC FairPrice", total: "$84.20" } },
  { from: "bot",  text: "Filed — NTUC FairPrice, $84.20. 12 items, mostly groceries. Added to this week." },
  { from: "them", name: "Priya",   text: "how much have we spent on groceries this month?" },
  { from: "bot",  text: "$612.40 across 9 receipts — about 12% under your $700 budget with 4 days to go." },
  { from: "bot",  text: "Heads up: your car insurance renews in 7 days ($1,240). Want me to remind you again on Friday?" },
];

const FAQS = [
  {
    q: "Does my helper need to install anything?",
    a: "No. They send receipt photos to your WhatsApp group exactly as they do today. There is no app, no account and nothing to learn on their side.",
  },
  {
    q: "Is this only for tracking expenses?",
    a: "No. Homly also handles chore schedules and leave requests, insurance renewal reminders, pantry and shopping lists, and monthly budgets — all through the same group chat and dashboard.",
  },
  {
    q: "Can I just ask it things instead of opening the dashboard?",
    a: "Yes. Ask in the group — \"how much on groceries this week\", \"when is the insurance due\", \"what is left to do today\" — and Homly answers there. It also checks in each morning and raises anything worth knowing.",
  },
  {
    q: "Which WhatsApp does this work with?",
    a: "Regular WhatsApp. No WhatsApp Business account required.",
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

function ChatDemo() {
  return (
    <div className="max-w-md mx-auto bg-stone-900/70 border border-stone-800 rounded-2xl p-4 md:p-5">
      {/* group header */}
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
        {CHAT.map((msg, i) => (
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
      <section className="max-w-3xl mx-auto px-4 md:px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-300 text-xs font-medium">Early access — Singapore</span>
        </div>

        <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight mb-6">
          Your household, handled{" "}
          <span className="text-emerald-400">in WhatsApp</span>
        </h1>

        <p className="text-stone-400 text-lg md:text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
          {config.description}
        </p>

        <WaitlistForm />

        <p className="text-stone-600 text-xs mt-4">
          Free during early access · No credit card required
        </p>
      </section>

      {/* Product proof — the chat itself */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 pb-20">
        <ChatDemo />
        <p className="text-center text-stone-500 text-sm mt-6 max-w-md mx-auto">
          This is the whole product. No one in your household has to open anything.
        </p>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            How it works
          </h2>
          <p className="text-stone-400 text-base max-w-xl mx-auto">
            Set up once, in under five minutes. Nothing to roll out to anyone.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {STEPS.map((step) => (
            <div key={step.number} className="relative">
              <div className="bg-stone-900/60 border border-stone-800 rounded-2xl p-6 h-full">
                <p className="text-emerald-400/60 text-xs font-mono font-bold mb-4 tracking-widest">
                  {step.number}
                </p>
                <h3 className="text-stone-100 font-semibold mb-2">{step.title}</h3>
                <p className="text-stone-400 text-sm leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            One assistant for the whole household
          </h2>
          <p className="text-stone-400 text-base max-w-xl mx-auto">
            Built for Singapore families with a domestic helper — money, chores and
            renewals in one place.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-stone-900/40 border border-stone-800 rounded-2xl p-5 hover:border-stone-700 transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
                <Icon name={feature.icon} />
              </div>
              <h3 className="text-stone-100 font-medium mb-1.5 text-sm">{feature.title}</h3>
              <p className="text-stone-500 text-sm leading-relaxed">{feature.desc}</p>
            </div>
          ))}
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
                "Unlimited receipts",
                "Full dashboard access",
                "Chores, insurance and budgets",
                "Reimbursement tracking",
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
            Get your household off the spreadsheet
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
