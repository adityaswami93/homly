"use client";

import { useState } from "react";
import Link from "next/link";
import config from "@/lib/config";

const FEATURES = [
  {
    emoji: "📱",
    title: "No app for your helper",
    desc:  "Your helper sends receipt photos to your household WhatsApp group — exactly as they do today. Nothing changes for them.",
  },
  {
    emoji: "🧾",
    title: "Automatic OCR",
    desc:  "Homly reads each receipt and extracts the vendor, total, and line items automatically. Categorised instantly.",
  },
  {
    emoji: "📊",
    title: "Weekly dashboard",
    desc:  "See exactly what was spent, by whom, and by category. Navigate back through past weeks any time.",
  },
  {
    emoji: "💬",
    title: "WhatsApp summaries",
    desc:  "Every Saturday morning, Homly posts a spending summary to your group automatically. Send one on demand any time.",
  },
  {
    emoji: "💰",
    title: "Reimbursement tracking",
    desc:  "Track what you owe your helper. Mark weeks as paid, record partial payments, and see your outstanding balance at a glance.",
  },
  {
    emoji: "👨‍👩‍👧",
    title: "Built for households",
    desc:  "Invite your spouse or partner. Set admin and member roles. Manage your household your way.",
  },
];

const STEPS = [
  {
    number: "01",
    title:  "Add Homly to your group",
    desc:   "Add the Homly number to your existing household WhatsApp group. Takes 30 seconds.",
  },
  {
    number: "02",
    title:  "Helper sends receipts as usual",
    desc:   "No training needed. Your helper sends receipt photos to the group — Homly detects them automatically.",
  },
  {
    number: "03",
    title:  "Check your dashboard",
    desc:   "Log in to see this week's spending, broken down by category. Get a summary in WhatsApp every Saturday.",
  },
];

const FAQS = [
  {
    q: "Does my helper need to install anything?",
    a: "No. They just send receipt photos to your WhatsApp group as they normally would. Nothing changes for them.",
  },
  {
    q: "Which WhatsApp does this work with?",
    a: "Regular WhatsApp. No WhatsApp Business account needed.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. Receipt images are stored privately. Your dashboard is password protected. Data is never shared or sold.",
  },
  {
    q: "What languages are supported?",
    a: "Homly reads English receipts. Most Singapore supermarket and household receipts print in English.",
  },
  {
    q: "How accurate is the OCR?",
    a: "High confidence on most printed receipts. Homly flags anything it is unsure about for your review.",
  },
  {
    q: "How much does it cost?",
    a: "Free during early access. Paid plan at SGD 9.99/month planned after launch.",
  },
];

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
      const res = await fetch("/api/waitlist", {
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
        <p className="text-emerald-400 font-medium text-lg mb-1">✓ You're on the list</p>
        <p className="text-stone-400 text-sm">We'll be in touch when your spot is ready.</p>
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
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition text-sm whitespace-nowrap"
      >
        {loading ? "Joining..." : "Join waitlist"}
      </button>
      {error && (
        <p className="text-red-400 text-xs mt-1 w-full">{error}</p>
      )}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-stone-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-stone-900/40 transition-colors"
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
          Household expenses,{" "}
          <span className="text-emerald-400">tracked automatically</span>
        </h1>

        <p className="text-stone-400 text-lg md:text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
          {config.description}
        </p>

        <WaitlistForm />

        <p className="text-stone-600 text-xs mt-4">
          Free during early access · No credit card required
        </p>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-20 border-t border-stone-800/60">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            How it works
          </h2>
          <p className="text-stone-400 text-base max-w-xl mx-auto">
            Set up in under 5 minutes. No training for your helper.
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
            Everything you need
          </h2>
          <p className="text-stone-400 text-base max-w-xl mx-auto">
            Built specifically for Singapore households employing domestic helpers.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-stone-900/40 border border-stone-800 rounded-2xl p-5 hover:border-stone-700 transition-colors"
            >
              <p className="text-2xl mb-3">{feature.emoji}</p>
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
            <p className="text-stone-500 text-sm mb-6">While we're in early access</p>
            <ul className="space-y-2.5 text-sm text-stone-400">
              {[
                "Unlimited receipts",
                "Full dashboard access",
                "WhatsApp summaries",
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
            <p className="text-emerald-400/70 text-sm mb-2">Coming soon</p>
            <div className="flex items-end gap-1 mb-1">
              <p className="text-3xl font-bold">SGD 9.99</p>
              <p className="text-stone-400 text-sm mb-1">/month</p>
            </div>
            <p className="text-stone-500 text-sm mb-6">After early access</p>
            <ul className="space-y-2.5 text-sm text-stone-400">
              {[
                "Everything in free",
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
            Ready to stop tallying receipts?
          </h2>
          <p className="text-stone-400 text-base mb-8">
            Join the waitlist and we will set up your household when your spot is ready.
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
