"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface RelevantPolicy {
  provider: string;
  coverage_type: string;
  policy_number: string | null;
  relevant_excerpt: string;
}

interface CoverageAnswer {
  answer: string;
  relevant_policies: RelevantPolicy[];
  confidence: "high" | "medium" | "low";
}

const EXAMPLE_QUERIES = [
  "Am I covered if I'm hospitalized overseas?",
  "Does my health insurance cover dental treatment?",
  "Is there a waiting period on my policies?",
  "What is my total death benefit?",
];

const TYPE_EMOJI: Record<string, string> = {
  health: "🏥", life: "💙", home: "🏠", car: "🚗", travel: "✈️", other: "📋",
};

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cls =
    confidence === "high"
      ? "bg-emerald-900/40 text-emerald-400"
      : confidence === "medium"
      ? "bg-amber-900/40 text-amber-400"
      : "bg-stone-800 text-stone-400";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : "Low confidence"}
    </span>
  );
}

export default function CoveragePage() {
  const [user, setUser] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CoverageAnswer | null>(null);
  const [noPoliciesError, setNoPoliciesError] = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    setNoPoliciesError(false);
    try {
      const res = await api.post("/insurance/query-coverage", { query });
      setResult(res.data);
    } catch (err: any) {
      if (err?.response?.status === 422) {
        setNoPoliciesError(true);
      } else {
        toast.error("Query failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-stone-100 font-semibold text-lg mb-1">Coverage Checker</h2>
        <p className="text-stone-500 text-sm">
          Ask a question in plain English — AI will check your household's policies and answer based on your coverage.
        </p>
      </div>

      {/* No analyzed policies notice */}
      {noPoliciesError && (
        <div className="bg-amber-900/20 border border-amber-800 rounded-xl p-4 mb-5 flex gap-3">
          <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm text-amber-300 font-medium mb-0.5">No analyzed policies found</p>
            <p className="text-xs text-stone-400">
              Upload your policy documents on the{" "}
              <button
                onClick={() => router.push("/insurance")}
                className="text-emerald-400 hover:text-emerald-300 underline"
              >
                Policies page
              </button>{" "}
              so AI can analyze your coverage details.
            </p>
          </div>
        </div>
      )}

      {/* Query form */}
      <form onSubmit={handleQuery} className="mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Am I covered for overseas hospitalization?"
            className="flex-1 border border-stone-700 bg-stone-800 rounded-xl px-4 py-3 text-stone-200 text-base placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px]"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px] shrink-0"
          >
            {loading ? "Checking…" : "Ask"}
          </button>
        </div>
      </form>

      {/* Example queries */}
      {!result && !loading && (
        <div className="mb-6">
          <p className="text-xs text-stone-500 uppercase tracking-wider mb-3">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                className="text-xs px-3 py-2 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-10 text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-stone-400 text-sm">Checking your policies…</p>
          <p className="text-stone-600 text-xs mt-1">Reviewing your coverage details with AI</p>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="space-y-4">
          {/* Answer card */}
          <div
            className={`rounded-xl p-5 border ${
              result.confidence === "high"
                ? "bg-emerald-900/10 border-emerald-800/50"
                : result.confidence === "medium"
                ? "bg-stone-900 border-stone-800"
                : "bg-stone-900 border-stone-800"
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-xs text-stone-500 uppercase tracking-wider">Answer</p>
              <ConfidenceBadge confidence={result.confidence} />
            </div>
            <p className="text-stone-100 text-sm leading-relaxed">{result.answer}</p>
          </div>

          {/* Relevant policies */}
          {result.relevant_policies?.length > 0 && (
            <div>
              <p className="text-xs text-stone-500 uppercase tracking-wider mb-3">
                Based on {result.relevant_policies.length === 1 ? "this policy" : "these policies"}
              </p>
              <div className="space-y-2">
                {result.relevant_policies.map((p, i) => (
                  <div
                    key={i}
                    className="bg-stone-900 border border-stone-800 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">{TYPE_EMOJI[p.coverage_type] ?? "📋"}</span>
                      <div>
                        <p className="text-sm font-medium text-stone-100">{p.provider}</p>
                        <p className="text-xs text-stone-500">
                          {p.coverage_type.charAt(0).toUpperCase() + p.coverage_type.slice(1)}
                          {p.policy_number ? ` · ${p.policy_number}` : ""}
                        </p>
                      </div>
                    </div>
                    {p.relevant_excerpt && (
                      <p className="text-xs text-stone-400 leading-relaxed border-l-2 border-stone-700 pl-3 italic">
                        {p.relevant_excerpt}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ask another */}
          <div className="pt-2">
            <button
              onClick={() => { setResult(null); setQuery(""); }}
              className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
            >
              ← Ask another question
            </button>
          </div>
        </div>
      )}

      {/* How it works — shown when no result and no loading */}
      {!result && !loading && !noPoliciesError && (
        <div className="mt-8 bg-stone-900 border border-stone-800 rounded-xl p-5">
          <p className="text-xs text-stone-500 uppercase tracking-wider mb-3">How it works</p>
          <div className="space-y-3">
            {[
              { step: "1", text: "Upload your insurance policy documents on the Policies page" },
              { step: "2", text: "AI extracts coverage details from each document automatically" },
              { step: "3", text: "Ask any coverage question and get an answer based on your actual policies" },
            ].map(({ step, text }) => (
              <div key={step} className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-stone-800 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] text-stone-400 font-bold">{step}</span>
                </div>
                <p className="text-xs text-stone-400 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
