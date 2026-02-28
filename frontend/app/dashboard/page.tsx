"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";

interface Source {
  title: string;
  url: string;
  source: string;
}
interface ChatResponse {
  answer: string;
  sources: Source[];
  confidence: string;  // add this
  iterations: number;  // add this
}

interface HistoryItem {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  created_at: string;
}

const SUGGESTED_QUESTIONS = [
  "What is happening with interest rates?",
  "How are Singapore markets performing?",
  "What is the outlook for oil prices?",
  "What are the latest Fed decisions?",
];

export default function Dashboard() {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
      else {
        setUser(session.user);
        fetchHistory();
      }
    });
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await api.get("/history");
      setHistory(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const ask = async (q?: string) => {
    const query = q || question;
    if (!query.trim()) return;
    setQuestion(query);
    setLoading(true);
    setResponse(null);
    setShowHistory(false);
    try {
      const res = await api.post("/ask", {
        question: query,
      });
      setResponse(res.data);
      if (user) fetchHistory();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setQuestion(item.question);
    setResponse({ answer: item.answer, sources: item.sources, confidence: "", iterations: 0 });
    setShowHistory(false);
  };

  return (
    <main className="min-h-screen bg-[#080808] text-white dot-grid">
      {/* Header */}
      <Navbar user={user} isAdmin={user?.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL}>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`text-sm transition px-3 py-1.5 rounded-lg border ${
            showHistory
              ? "border-emerald-400/30 text-emerald-400 bg-emerald-400/5"
              : "border-white/10 text-white/40 hover:text-white"
          }`}
        >
          <span className="hidden sm:inline">History </span>
          {history.length > 0 && `(${history.length})`}
        </button>
      </Navbar>

      <div className="flex" style={{ height: "calc(100vh - 57px)" }}>
        {/* History sidebar */}
        {showHistory && (
          <aside className="w-64 md:w-72 border-r border-white/5 overflow-y-auto p-4 shrink-0">
            <p className="text-xs text-white/20 uppercase tracking-widest mb-4 px-1">
              Recent
            </p>
            {history.length === 0 ? (
              <p className="text-white/20 text-sm px-1">No history yet</p>
            ) : (
              <div className="space-y-1">
                {history.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => loadHistoryItem(item)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition group"
                  >
                    <p className="text-sm text-white/60 group-hover:text-white/90 transition line-clamp-2 leading-snug">
                      {item.question}
                    </p>
                    <p className="text-xs text-white/20 mt-1 font-mono">
                      {new Date(item.created_at).toLocaleDateString("en-SG", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </aside>
        )}

        {/* Main */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-16">

            {/* Empty state - replace the current one */}
            {!response && !loading && (
              <div className="flex flex-col items-center justify-center min-h-[40vh] mb-8">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center mb-6">
                  <div className="w-3 h-3 rounded-full bg-emerald-400" />
                </div>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3 text-center">
                  What would you like to know?
                </h1>
                <p className="text-white/30 text-base text-center max-w-sm">
                  Ask about markets, macro trends, or Singapore economy.
                </p>
              </div>
            )}

            {/* Input */}
            <div className="relative mb-4">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask anything about markets..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 md:px-5 py-3.5 md:py-4 pr-20 md:pr-24 text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/40 focus:bg-white/7 transition text-sm md:text-base"
              />
              <button
                onClick={() => ask()}
                disabled={loading}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black text-sm font-semibold px-3 md:px-4 py-2 rounded-lg transition"
              >
                {loading ? "..." : "Ask"}
              </button>
            </div>

            {/* Suggested questions */}
            {!response && !loading && (
              <div className="flex flex-wrap gap-2 mb-10 md:mb-12">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    className="text-xs md:text-sm text-white/30 border border-white/8 hover:border-white/20 hover:text-white/60 px-3 py-1.5 rounded-lg transition"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center gap-2.5 text-white/30 py-8">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.15s]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.3s]" />
                </div>
                <span className="text-sm">Researching markets...</span>
              </div>
            )}

            {/* Response */}
            {response && (
              <div className="mt-6 md:mt-8">
                {/* Question echo */}
                <div className="flex items-start gap-3 mb-6">
                  <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs text-white/60">You</span>
                  </div>
                  <p className="text-white/70 text-sm md:text-base pt-1">{question}</p>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    response.confidence === "high" 
                      ? "text-emerald-400 border-emerald-400/20 bg-emerald-400/5"
                      : response.confidence === "medium"
                      ? "text-yellow-400 border-yellow-400/20 bg-yellow-400/5"
                      : "text-red-400 border-red-400/20 bg-red-400/5"
                  }`}>
                    {response.confidence} confidence
                  </span>
                  <span className="text-xs text-white/20">
                    {response.iterations} {response.iterations === 1 ? "iteration" : "iterations"}
                  </span>
                </div>

                {/* Answer */}
                <div className="flex items-start gap-3 mb-6">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-400/20 flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 md:p-6">
                      <p className="text-white/80 leading-relaxed text-sm md:text-[15px]">
                        {response.answer}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Sources */}
                <div className="ml-10">
                  <p className="text-xs text-white/20 uppercase tracking-widest mb-3">
                    Sources
                  </p>
                  <div className="space-y-2">
                    {response.sources.map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between border border-white/8 hover:border-white/20 hover:bg-white/5 rounded-lg px-3 md:px-4 py-2.5 md:py-3 transition group"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-white/60 group-hover:text-white/90 transition line-clamp-1">
                            {s.title}
                          </p>
                          <p className="text-xs text-white/25 mt-0.5">{s.source}</p>
                        </div>
                        <span className="text-white/20 group-hover:text-white/40 transition ml-3 shrink-0">
                          →
                        </span>
                      </a>
                    ))}
                  </div>

                  <button
                    onClick={() => { setResponse(null); setQuestion(""); }}
                    className="mt-5 text-sm text-white/25 hover:text-white/50 transition"
                  >
                    ← New question
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}