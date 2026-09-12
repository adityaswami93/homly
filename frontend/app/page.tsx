"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import config from "@/lib/config";
import { API_URL } from "@/lib/apiUrl";

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
  home:     "M3 10.5L12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M9.5 21v-6h5v6",
  ask:      "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
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

/** The two things a household manager looks after. Money is oversight, not bookkeeping. */
const PILLARS = [
  {
    icon:  "home",
    title: "Your home",
    lead:  "The daily running of your home, handled end to end.",
    points: [
      "Chore schedules, and a record of who actually did what",
      "Helper leave requests, and approvals in a tap",
      "Pantry stock, kept current from your own receipts",
      "Shopping lists that build themselves as things run out",
      "A daily nudge to the group for whatever is due today",
    ],
  },
  {
    icon:  "wallet",
    title: "Your money",
    lead:  "Watched over every day, and explained in plain numbers.",
    points: [
      "Every receipt read, categorised and filed on arrival",
      "Budgets watched against real spend, flagged before they break",
      "What you owe your helper, settled to the cent",
      "Insurance cover mapped, gaps surfaced, renewals caught early",
      "Savings and net worth, so you know where you stand",
      "Price trends across the shops you actually use",
    ],
  },
];

/** What separates a manager from software you have to operate. */
const QUALITIES = [
  {
    icon:  "ask",
    title: "You just ask",
    desc:  "Ask about your household the way you would ask a person, and get a straight answer back — in the group chat or on the dashboard.",
  },
  {
    icon:  "scan",
    title: "It reads everything for you",
    desc:  "Photograph a receipt and it becomes structured data — vendor, items, categories — on its own. Same for a fridge shelf or a policy document.",
  },
  {
    icon:  "memory",
    title: "It learns your household",
    desc:  "Dietary rules, how far ahead you like to be warned, who handles what. Tell it once and it carries that into everything it does afterwards.",
  },
  {
    icon:  "bolt",
    title: "It speaks up first",
    desc:  "A good manager tells you before you have to ask. Homly reviews your household each morning and raises what matters.",
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
    q: "What does Homly manage?",
    a: "Your money and your home, as one system. On the money side: receipts read and categorised, budgets watched against real spend, insurance cover and renewals, savings and net worth, and what you owe your helper. On the home side: chore schedules, helper leave, pantry stock and shopping lists.",
  },
  {
    q: "What do you mean by a household manager?",
    a: "Large households have always had someone running them — a house manager, an estate manager, a family office. Homly is that role for everyone else: it knows how your home works, you can simply ask it for things, and it comes to you when something needs a decision.",
  },
  {
    q: "Where do I use Homly?",
    a: "Wherever suits you. WhatsApp is the easiest place to reach it, because it is where your household already talks. Everything is equally available on the dashboard, and anything done in one shows up in the other.",
  },
  {
    q: "What does my helper do differently?",
    a: "Exactly what they do today — send receipt photos to your household group. Homly takes it from there, so their day stays the same.",
  },
  {
    q: "What does Homly do on its own?",
    a: "It reviews your household each morning and raises what matters — a budget heading over, a renewal approaching, a chore that keeps slipping. On a normal day it stays quiet, and you stay in control of how much it says.",
  },
  {
    q: "How is my data kept safe?",
    a: "Each household's data is fully isolated from every other. Receipt images are stored privately, the dashboard is password protected, and your data stays yours.",
  },
  {
    q: "How much does it cost?",
    a: "Free during early access. A paid plan at SGD 9.99/month is planned after launch, and early access members get plenty of notice before anything changes.",
  },
];

/* -------------------------------------------------------------- variants
   Two ways of opening the same page, both stated positively. `manager` leads
   with the role; `system` leads with the family-operating-system framing.
   Everything below the hero is identical in both, so conversion differences
   are attributable to the framing and nothing else.                          */

type VariantId = "manager" | "system";

const VARIANTS: Record<VariantId, { headline: React.ReactNode; sub: string }> = {
  manager: {
    headline: (
      <>
        Every home needs a manager.{" "}
        {/* Own line on md+ so the two sentences read as two beats, not one run-on. */}
        <span className="text-emerald-400 md:block">Now yours has&nbsp;one.</span>
      </>
    ),
    sub: "Homly manages what your household runs on — the money, the supplies, the schedule, the renewals. It reads what it needs, learns how you like things done, and comes to you when something needs a decision.",
  },
  system: {
    headline: (
      <>
        The operating system{" "}
        <span className="text-emerald-400 md:block">for your&nbsp;family.</span>
      </>
    ),
    sub: "One system for the money, the supplies, the schedule and the renewals — with an agent running it for you. Reach it in your group chat or on the dashboard.",
  },
};

const VARIANT_STORAGE_KEY = "homly_lp_variant";

/**
 * Resolved once per page load and cached, because useSyncExternalStore requires
 * a snapshot that is stable between calls — recomputing (and re-rolling the
 * coin) on every read would loop forever.
 */
let resolvedVariant: VariantId | null = null;

function resolveVariant(): VariantId {
  if (resolvedVariant) return resolvedVariant;

  // ?v=system / ?v=manager forces one, for previewing and for sharing a specific
  // version. Deliberately not persisted, so previewing cannot poison this
  // visitor's real assignment.
  const forced = new URLSearchParams(window.location.search).get("v");
  if (forced === "system" || forced === "manager") {
    resolvedVariant = forced;
    return resolvedVariant;
  }

  // localStorage throws outright in some privacy modes. Failing here should cost
  // the visitor a stable assignment across reloads, never the page itself.
  try {
    const stored = window.localStorage.getItem(VARIANT_STORAGE_KEY);
    if (stored === "system" || stored === "manager") {
      resolvedVariant = stored;
      return resolvedVariant;
    }
    const assigned: VariantId = Math.random() < 0.5 ? "manager" : "system";
    window.localStorage.setItem(VARIANT_STORAGE_KEY, assigned);
    resolvedVariant = assigned;
  } catch {
    resolvedVariant = Math.random() < 0.5 ? "manager" : "system";
  }
  return resolvedVariant;
}

/** The assignment never changes within a page load, so there is nothing to subscribe to. */
const subscribeToNothing = () => () => {};

/**
 * This page is a static export, so the variant cannot be chosen during render —
 * that would bake one variant into the prerendered HTML. useSyncExternalStore is
 * the supported way to render a server snapshot and then swap to a client-only
 * value after hydration, without a setState-in-effect. The server snapshot is
 * `manager`, so a visitor with JS disabled still gets a coherent page.
 */
function useVariant(): VariantId {
  return useSyncExternalStore<VariantId>(
    subscribeToNothing,
    resolveVariant,
    () => "manager",
  );
}

/* ----------------------------------------------------------- components */

function WaitlistForm({ className = "", variant }: { className?: string; variant: VariantId }) {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState("");

  const handleSubmit = async () => {
    if (!email || !email.includes("@")) { setError("Enter a valid email"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/waitlist`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, variant }),
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
      <div className={className}>
        <p className="text-emerald-400 font-medium text-lg mb-1">You&apos;re on the list</p>
        <p className="text-stone-400 text-sm">We&apos;ll be in touch when your spot is ready.</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col sm:flex-row gap-2 w-full max-w-md ${className}`}>
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(""); }}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/60 transition text-base sm:text-sm"
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

/** Small uppercase label above a section heading — cheap, effective hierarchy. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-emerald-400/70 text-[11px] font-semibold tracking-[0.18em] uppercase mb-4">
      {children}
    </p>
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
    <div className="bg-stone-900/70 border border-stone-800 rounded-2xl p-4 md:p-5 shadow-2xl shadow-black/40">
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
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${
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
    <div className="border-b border-stone-800/80">
      <button
        onClick={() => setOpen(!open)}
        className="w-full py-5 flex items-center justify-between text-left group min-h-[44px]"
      >
        <p className="text-stone-200 text-[15px] font-medium pr-6 group-hover:text-white transition-colors">
          {q}
        </p>
        <span
          className={`text-stone-600 group-hover:text-stone-400 transition-all duration-200 shrink-0 text-lg leading-none ${
            open ? "rotate-45" : ""
          }`}
        >
          +
        </span>
      </button>
      {open && (
        <div className="pb-5 -mt-1">
          <p className="text-stone-400 text-sm leading-relaxed max-w-2xl">{a}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function LandingPage() {
  const variant = useVariant();
  const hero = VARIANTS[variant];

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">

      {/* Nav */}
      <nav className="max-w-6xl mx-auto px-5 md:px-8 py-5 flex items-center justify-between">
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

      {/* ---------------------------------------------------------- HERO
          Asymmetric: copy left, the product itself right. The chat panel is
          the most persuasive asset on the page, so it sits above the fold
          rather than four sections down. */}
      <section className="max-w-6xl mx-auto px-5 md:px-8 pt-14 pb-24 md:pt-20 md:pb-32">
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-14 lg:gap-16 items-center">
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5 mb-7">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-300 text-xs font-medium">Early access — Singapore</span>
            </div>

            <h1 className="text-[2.6rem] leading-[1.05] md:text-[3.4rem] md:leading-[1.06] font-bold tracking-tight mb-6">
              {hero.headline}
            </h1>

            <p className="text-stone-400 text-lg leading-relaxed mb-9 max-w-xl mx-auto lg:mx-0">
              {hero.sub}
            </p>

            <WaitlistForm className="mx-auto lg:mx-0" variant={variant} />

            <p className="text-stone-600 text-xs mt-4">
              Free during early access · Just your email
            </p>
          </div>

          <div className="lg:pl-4">
            <ChatDemo />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- PILLARS
          Editorial two-column, no card chrome — whitespace and a rule do
          the containing. Left-aligned heading breaks the centred monotony. */}
      <section className="border-y border-stone-800/60 bg-[#131210]">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-14 md:mb-16">
            <Eyebrow>What it manages</Eyebrow>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Everything your household runs on
            </h2>
            <p className="text-stone-400 text-base md:text-lg leading-relaxed">
              Your home and your money, managed by one system that sees both.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12 md:gap-16">
            {PILLARS.map((pillar, i) => (
              <div
                key={pillar.title}
                className={i === 1 ? "md:pl-16 md:border-l md:border-stone-800/80" : ""}
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-5">
                  <Icon name={pillar.icon} />
                </div>
                <h3 className="text-stone-100 text-xl font-semibold mb-2.5">{pillar.title}</h3>
                <p className="text-stone-400 text-[15px] leading-relaxed mb-6">{pillar.lead}</p>
                <ul className="space-y-3">
                  {pillar.points.map((p) => (
                    <li key={p} className="flex gap-3 text-[15px] text-stone-400 leading-relaxed">
                      <span className="mt-[9px] shrink-0 w-1 h-1 rounded-full bg-emerald-400/60" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- QUALITIES
          Four across, no cards. Icons deliberately monochrome so emerald
          stays meaningful where it matters. */}
      <section className="max-w-6xl mx-auto px-5 md:px-8 py-20 md:py-28">
        <div className="max-w-2xl mb-14">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            It runs itself
          </h2>
          <p className="text-stone-400 text-base md:text-lg leading-relaxed">
            A manager does the work and comes to you when something needs a decision.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {QUALITIES.map((q) => (
            <div key={q.title}>
              <div className="w-9 h-9 rounded-lg bg-stone-800/70 border border-stone-700/60 flex items-center justify-center text-stone-300 mb-4">
                <Icon name={q.icon} />
              </div>
              <h3 className="text-stone-100 font-medium mb-2">{q.title}</h3>
              <p className="text-stone-500 text-sm leading-relaxed">{q.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- INTERFACES */}
      <section className="border-y border-stone-800/60 bg-[#131210]">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <Eyebrow>Where to reach it</Eyebrow>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Reach it wherever you already are
            </h2>
            <p className="text-stone-400 text-base md:text-lg leading-relaxed">
              WhatsApp and the dashboard are two doors into the same system, and both
              show the same household.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                title: "In your group chat",
                desc:  "Add Homly to the household WhatsApp group you already have. Your helper keeps sending receipt photos exactly as they do now, and anyone in the group can ask it something.",
              },
              {
                title: "On the dashboard",
                desc:  "When you want the full picture — spending by week and category, budgets, policies, chore history, price trends — it is all there, in sync with the chat.",
              },
              {
                title: "Set up in about a minute",
                desc:  "One number added to one group, and a short setup on the dashboard. Everyone else is ready from the first message.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="bg-stone-900/40 border border-stone-800 rounded-2xl p-6"
              >
                <h3 className="text-stone-100 font-medium mb-2.5">{item.title}</h3>
                <p className="text-stone-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- PRICING */}
      <section className="max-w-6xl mx-auto px-5 md:px-8 py-20 md:py-28">
        <div className="text-center mb-14">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Simple pricing
          </h2>
          <p className="text-stone-400 text-base md:text-lg">
            Free during early access. Simple after that.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          <div className="bg-stone-900/40 border border-stone-800 rounded-2xl p-7">
            <p className="text-stone-400 text-sm mb-2">Early access</p>
            <p className="text-4xl font-bold mb-1">Free</p>
            <p className="text-stone-500 text-sm mb-7">While we&apos;re in early access</p>
            <ul className="space-y-3 text-sm text-stone-400">
              {[
                "Everything Homly manages",
                "Your home and your money",
                "Unlimited receipts",
                "WhatsApp and dashboard",
                "Up to 2 household members",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5">
                  <span className="text-emerald-400 text-xs">✓</span> {f}
                </li>
              ))}
            </ul>
            <div className="mt-7">
              <WaitlistForm variant={variant} />
            </div>
          </div>

          <div className="bg-stone-900/20 border border-stone-800/70 rounded-2xl p-7">
            <p className="text-stone-500 text-sm mb-2">After launch</p>
            <div className="flex items-end gap-1.5 mb-1">
              <p className="text-4xl font-bold text-stone-300">SGD 9.99</p>
              <p className="text-stone-500 text-sm mb-1.5">/month</p>
            </div>
            <p className="text-stone-500 text-sm mb-7">Early access members get notice first</p>
            <ul className="space-y-3 text-sm text-stone-400">
              {[
                "Everything in early access",
                "Unlimited history",
                "Unlimited members",
                "PayNow QR generation",
                "Priority support",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5">
                  <span className="text-stone-600 text-xs">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- FAQ */}
      <section className="border-t border-stone-800/60 bg-[#131210]">
        <div className="max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28">
          <div className="mb-10">
            <Eyebrow>Questions</Eyebrow>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Common questions
            </h2>
          </div>
          <div className="border-t border-stone-800/80">
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ CLOSING
          The one big colour moment on the page — it earns it by being the
          only one, and by being the thing we want clicked. */}
      <section className="bg-gradient-to-b from-emerald-950/40 to-[#0f0e0c] border-t border-emerald-900/30">
        <div className="max-w-2xl mx-auto px-5 md:px-8 py-24 md:py-28 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Put your household on Homly
          </h2>
          <p className="text-stone-400 text-base md:text-lg mb-9">
            Join the waitlist and we will set you up when your spot is ready.
          </p>
          <WaitlistForm className="mx-auto" variant={variant} />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800/40 py-8">
        <div className="max-w-6xl mx-auto px-5 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
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
