"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";

interface WeekSummary {
  year: number;
  week_number: number;
  week_start: string;
  week_end: string;
}

interface WeekDetail {
  year: number;
  week_number: number;
  total: number;
  receipt_count: number;
  flagged_count: number;
  receipts: any[];
  category_totals: Record<string, number>;
}

const CATEGORY_EMOJI: Record<string, string> = {
  "groceries": "🛒", "household": "🏠", "personal care": "🧴",
  "food & beverage": "🍜", "transport": "🚌", "other": "📦",
};

function fmt(amount: number | null) {
  if (amount == null) return "—";
  return `SGD ${Number(amount).toFixed(2)}`;
}

function fmtDateRange(start: string, end: string) {
  const s = new Date(start).toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  const e = new Date(end).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

export default function History() {
  const [user,     setUser]     = useState<any>(null);
  const [weeks,    setWeeks]    = useState<WeekSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details,  setDetails]  = useState<Record<string, WeekDetail>>({});
  const [loading,  setLoading]  = useState(true);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const loadWeeks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/weeks");
      setWeeks(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadWeeks();
  }, [user, loadWeeks]);

  const toggleWeek = async (week: WeekSummary) => {
    const key = `${week.year}-${week.week_number}`;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!details[key]) {
      const res = await api.get(`/weeks/${week.year}/${week.week_number}`);
      setDetails((prev) => ({ ...prev, [key]: res.data }));
    }
  };

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-6">History</h1>

        {loading ? (
          <p className="text-stone-600 text-sm">Loading...</p>
        ) : weeks.length === 0 ? (
          <div className="border border-stone-800 rounded-xl p-12 text-center">
            <p className="text-stone-500 text-sm">No weeks recorded yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {weeks.map((week) => {
              const key    = `${week.year}-${week.week_number}`;
              const isOpen = expanded === key;
              const detail = details[key];

              return (
                <div key={key} className="border border-stone-800 rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleWeek(week)}
                    className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-stone-900/40 transition-colors text-left"
                  >
                    <div>
                      <p className="text-stone-200 font-medium text-sm">Week {week.week_number}</p>
                      <p className="text-stone-600 text-xs mt-0.5">
                        {fmtDateRange(week.week_start, week.week_end)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {detail && (
                        <span className="text-stone-200 font-mono text-sm">{fmt(detail.total)}</span>
                      )}
                      <span className={`text-stone-600 text-sm transition-transform ${isOpen ? "rotate-90" : ""}`}>
                        →
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-stone-800 bg-stone-900/20 px-4 py-4">
                      {!detail ? (
                        <p className="text-stone-600 text-sm">Loading...</p>
                      ) : (
                        <>
                          {Object.keys(detail.category_totals).length > 0 && (
                            <div className="mb-4">
                              <p className="text-stone-600 text-xs uppercase tracking-widest mb-2">By Category</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                {Object.entries(detail.category_totals)
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([cat, amt]) => (
                                    <div key={cat} className="flex items-center justify-between bg-stone-900/60 rounded-lg px-3 py-2">
                                      <span className="text-stone-400 text-xs">{CATEGORY_EMOJI[cat]} {cat}</span>
                                      <span className="text-stone-300 text-xs font-mono">{fmt(amt)}</span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}

                          <div className="space-y-1.5">
                            {detail.receipts.map((r: any) => (
                              <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-stone-800/50 last:border-0">
                                <div>
                                  <p className="text-stone-300 text-sm">{r.vendor || "Unknown vendor"}</p>
                                  <p className="text-stone-600 text-xs">
                                    {r.date ? new Date(r.date).toLocaleDateString("en-SG", {
                                      weekday: "short", day: "numeric", month: "short"
                                    }) : "—"}
                                    {r.flagged && <span className="text-amber-400 ml-2">⚠ flagged</span>}
                                  </p>
                                </div>
                                <span className="text-stone-300 text-sm font-mono">{fmt(r.total)}</span>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 pt-3 border-t border-stone-800 flex justify-between">
                            <span className="text-stone-500 text-sm">{detail.receipt_count} receipts</span>
                            <span className="text-stone-200 font-semibold font-mono text-sm">{fmt(detail.total)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
