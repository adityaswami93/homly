import Link from "next/link";

const FEATURES = [
  {
    title: "Morning Digest",
    description: "AI-generated briefing on global markets and Singapore economy delivered to your inbox at 7am.",
    icon: "◎",
    stat: "7am SGT",
    statLabel: "daily delivery",
  },
  {
    title: "Ask Anything",
    description: "Ask questions in plain English and get grounded answers with sources. No jargon, no noise.",
    icon: "◈",
    stat: "<5s",
    statLabel: "average response",
  },
  {
    title: "Watchlist Digest",
    description: "Track stocks, crypto and topics. Get weekly digests on what moved and why it matters.",
    icon: "◇",
    stat: "Weekly",
    statLabel: "personalised digest",
  },
];

const EXAMPLE_QA = [
  {
    q: "What is happening with interest rates?",
    a: "The Federal Reserve is expected to hold rates steady through mid-2026, with Wells Fargo economists citing stronger-than-expected labor data and cooling inflation as key factors...",
  },
  {
    q: "How are Singapore markets performing?",
    a: "Singapore's STI gained 0.8% this week, led by DBS and OCBC as regional banks benefited from stabilising credit conditions across Southeast Asia...",
  },
];

export default function Landing() {
  return (
    <main className="min-h-screen bg-[#080808] text-white overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-emerald-500/8 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 right-[-100px] w-[400px] h-[400px] bg-emerald-500/4 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-[-100px] w-[300px] h-[300px] bg-emerald-500/3 rounded-full blur-[80px]" />
      </div>

      {/* Nav */}
      <nav className="relative border-b border-white/5 px-4 md:px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-semibold tracking-tight text-lg">Finclaro</span>
          </div>
          <div className="flex items-center gap-3 md:gap-6">
            <Link href="/login" className="text-sm text-white/40 hover:text-white transition hidden md:block">
              Sign in
            </Link>
            <Link
              href="/login"
              className="text-sm bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-2 rounded-lg transition"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative max-w-5xl mx-auto px-4 md:px-6 pt-16 md:pt-24 pb-12 md:pb-16 text-center">
        <div className="inline-flex items-center gap-2 border border-emerald-400/20 bg-emerald-400/5 text-emerald-400 text-xs px-3 py-1.5 rounded-full mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          AI-powered · Built for Singapore
        </div>

        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.1] mb-6">
          Research markets
          <br />
          <span className="text-emerald-400">without the noise</span>
        </h1>

        <p className="text-white/40 text-base md:text-xl max-w-lg mx-auto mb-10 leading-relaxed">
          Your personal AI analyst — monitoring global markets, answering your questions, and delivering insights that matter.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16 md:mb-20">
          <Link
            href="/login"
            className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-8 py-3.5 rounded-xl transition text-sm"
          >
            Start for free →
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto text-center text-white/40 hover:text-white text-sm transition border border-white/10 hover:border-white/20 px-8 py-3.5 rounded-xl"
          >
            Sign in
          </Link>
        </div>

        {/* Example QA preview */}
        <div className="max-w-2xl mx-auto space-y-3">
          {EXAMPLE_QA.map((item, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 md:p-5 text-left hover:border-white/20 transition">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <p className="text-xs text-emerald-400 font-medium">Question</p>
              </div>
              <p className="text-sm text-white/80 mb-3 font-medium">{item.q}</p>
              <div className="border-t border-white/5 pt-3">
                <p className="text-xs text-white/30 mb-1">Answer</p>
                <p className="text-sm text-white/50 leading-relaxed">{item.a}</p>
              </div>
            </div>
          ))}
          <p className="text-xs text-white/20 text-center pt-1">
            Powered by real-time financial news — updated every 6 hours
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="relative border-y border-white/5 py-8 md:py-10">
        <div className="max-w-4xl mx-auto px-4 md:px-6 grid grid-cols-3 gap-4 md:gap-8 text-center">
          {[
            { value: "10+", label: "Topics monitored" },
            { value: "6h", label: "News refresh" },
            { value: "7am", label: "Digest delivery" },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-2xl md:text-3xl font-semibold text-emerald-400 mb-1">{s.value}</p>
              <p className="text-xs md:text-sm text-white/30">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="relative max-w-5xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <p className="text-xs text-white/30 uppercase tracking-widest text-center mb-4">
          What Finclaro does
        </p>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-center mb-10 md:mb-12">
          Everything you need to stay informed
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-white/5 border border-white/10 rounded-xl p-5 md:p-6 hover:border-emerald-400/20 hover:bg-white/8 transition"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="text-emerald-400 text-2xl">{f.icon}</div>
                <div className="text-right">
                  <p className="text-base md:text-lg font-semibold text-white/80">{f.stat}</p>
                  <p className="text-xs text-white/30">{f.statLabel}</p>
                </div>
              </div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative max-w-2xl mx-auto px-4 md:px-6 py-16 md:py-20 text-center border-t border-white/5">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
          Ready to research smarter?
        </h2>
        <p className="text-white/40 mb-8 text-base md:text-lg">
          Join financial professionals using Finclaro to stay ahead of the markets.
        </p>
        <Link
          href="/login"
          className="inline-block bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-8 md:px-10 py-3.5 md:py-4 rounded-xl transition"
        >
          Get started for free
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/5 px-4 md:px-6 py-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-sm text-white/30">Finclaro</span>
          </div>
          <p className="text-white/20 text-sm">© 2026 · Built in Singapore</p>
        </div>
      </footer>
    </main>
  );
}