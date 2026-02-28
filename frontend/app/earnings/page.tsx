"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "../components/Navbar";

interface EarningsAnalysis {
  revenue_eps: {
    summary: string;
    beat_miss: string;
    key_numbers: string[];
  };
  guidance: {
    summary: string;
    direction: string;
    key_quotes: string[];
  };
  management_tone: {
    summary: string;
    sentiment: string;
  };
  key_risks: {
    summary: string;
    risks: string[];
  };
  qa_highlights: {
    summary: string;
    highlights: string[];
  };
  bull_bear: {
    bull_case: string;
    bear_case: string;
    overall: string;
  };
}

const SENTIMENT_COLORS: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-400/20 bg-emerald-400/5",
  neutral: "text-white/60 border-white/20 bg-white/5",
  cautious: "text-yellow-400 border-yellow-400/20 bg-yellow-400/5",
  bearish: "text-red-400 border-red-400/20 bg-red-400/5",
  beat: "text-emerald-400 border-emerald-400/20 bg-emerald-400/5",
  miss: "text-red-400 border-red-400/20 bg-red-400/5",
  "in-line": "text-white/60 border-white/20 bg-white/5",
  raised: "text-emerald-400 border-emerald-400/20 bg-emerald-400/5",
  lowered: "text-red-400 border-red-400/20 bg-red-400/5",
  maintained: "text-white/60 border-white/20 bg-white/5",
  withdrawn: "text-yellow-400 border-yellow-400/20 bg-yellow-400/5",
};

function Badge({ value }: { value: string }) {
  const color = SENTIMENT_COLORS[value?.toLowerCase()] || "text-white/40 border-white/10 bg-white/5";
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${color}`}>
      {value}
    </span>
  );
}

export default function Earnings() {
  const [user, setUser] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<EarningsAnalysis | null>(null);
  const [analyzedTicker, setAnalyzedTicker] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
      else setUser(session.user);
    });
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setAnalysis(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("ticker", ticker);

    try {
      const res = await api.post("/analyse-earnings", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      setAnalysis(res.data.analysis);
      setAnalyzedTicker(res.data.ticker);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#080808] text-white dot-grid">
      <Navbar user={user} isAdmin={user?.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL} />

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-16">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-2 print-title">
          Earnings Analyser
        </h1>
        <p className="text-white/30 mb-10 print-title">
          Upload an earnings call transcript PDF and get a structured PM-grade analysis.
        </p>

        {/* Upload */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8 no-print">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              placeholder="Ticker (e.g. AAPL)"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="sm:w-40 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/50 transition text-sm font-mono"
            />
            <label className="flex-1 flex items-center gap-3 bg-white/5 border border-white/10 border-dashed rounded-lg px-4 py-2.5 cursor-pointer hover:border-white/20 transition">
              <span className="text-white/20 text-sm">
                {file ? file.name : "Choose PDF transcript..."}
              </span>
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-semibold px-6 py-2.5 rounded-lg transition text-sm shrink-0"
            >
              {loading ? "Analysing..." : "Analyse"}
            </button>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {loading && (
            <div className="flex items-center gap-2.5 text-white/30 mt-2">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.15s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.3s]" />
              </div>
              <span className="text-sm">Reading transcript — this takes 30-60 seconds for long PDFs...</span>
            </div>
          )}
        </div>

        {/* Analysis results */}
        {analysis && (
          <div>
            {/* Print header — hidden on screen, visible when printing */}
            <div className="print-header" style={{ display: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px", paddingBottom: "16px", borderBottom: "2px solid #10b981" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981" }} />
                <span style={{ fontWeight: 600, fontSize: "18px" }}>Finclaro</span>
                <span style={{ color: "#666", fontSize: "14px", marginLeft: "8px" }}>
                  Earnings Analysis — {analyzedTicker} — {new Date().toLocaleDateString("en-SG", { year: "numeric", month: "long", day: "numeric" })}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between mb-6 no-print">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold font-mono">{analyzedTicker}</h2>
                <span className="text-white/30 text-sm">Earnings Analysis</span>
                <Badge value={analysis.bull_bear.overall} />
              </div>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 text-sm border border-white/10 hover:border-white/30 text-white/40 hover:text-white px-4 py-2 rounded-lg transition"
              >
                <span>↓</span> Export PDF
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Revenue & EPS */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 print-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-white/60 uppercase tracking-wide">Revenue & EPS</h3>
                  <Badge value={analysis.revenue_eps.beat_miss} />
                </div>
                <p className="text-sm text-white/70 leading-relaxed mb-3">{analysis.revenue_eps.summary}</p>
                <div className="space-y-1">
                  {analysis.revenue_eps.key_numbers.map((n, i) => (
                    <p key={i} className="text-xs text-white/40 font-mono">• {n}</p>
                  ))}
                </div>
              </div>

              {/* Guidance */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 print-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-white/60 uppercase tracking-wide">Forward Guidance</h3>
                  <Badge value={analysis.guidance.direction} />
                </div>
                <p className="text-sm text-white/70 leading-relaxed mb-3">{analysis.guidance.summary}</p>
                {analysis.guidance.key_quotes.map((q, i) => (
                  <p key={i} className="text-xs text-white/30 italic border-l border-white/10 pl-3 mb-1">"{q}"</p>
                ))}
              </div>

              {/* Management Tone */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 print-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-white/60 uppercase tracking-wide">Management Tone</h3>
                  <Badge value={analysis.management_tone.sentiment} />
                </div>
                <p className="text-sm text-white/70 leading-relaxed">{analysis.management_tone.summary}</p>
              </div>

              {/* Key Risks */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 print-card">
                <h3 className="font-medium text-sm text-white/60 uppercase tracking-wide mb-3">Key Risks</h3>
                <p className="text-sm text-white/70 leading-relaxed mb-3">{analysis.key_risks.summary}</p>
                <div className="space-y-1">
                  {analysis.key_risks.risks.map((r, i) => (
                    <p key={i} className="text-xs text-red-400/70">• {r}</p>
                  ))}
                </div>
              </div>

              {/* Q&A Highlights */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 print-card">
                <h3 className="font-medium text-sm text-white/60 uppercase tracking-wide mb-3">Q&A Highlights</h3>
                <p className="text-sm text-white/70 leading-relaxed mb-3">{analysis.qa_highlights.summary}</p>
                <div className="space-y-1">
                  {analysis.qa_highlights.highlights.map((h, i) => (
                    <p key={i} className="text-xs text-white/40">• {h}</p>
                  ))}
                </div>
              </div>

              {/* Bull & Bear */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 print-card">
                <h3 className="font-medium text-sm text-white/60 uppercase tracking-wide mb-3">Bull vs Bear</h3>
                <div className="mb-3">
                  <p className="text-xs text-emerald-400 mb-1 font-medium">Bull case</p>
                  <p className="text-sm text-white/70 leading-relaxed">{analysis.bull_bear.bull_case}</p>
                </div>
                <div>
                  <p className="text-xs text-red-400 mb-1 font-medium">Bear case</p>
                  <p className="text-sm text-white/70 leading-relaxed">{analysis.bull_bear.bear_case}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => { setAnalysis(null); setFile(null); setTicker(""); }}
              className="mt-6 text-sm text-white/25 hover:text-white/50 transition no-print"
            >
              ← Analyse another transcript
            </button>
          </div>
        )}
      </div>
    </main>
  );
}