"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";

const CATEGORY_EMOJI: Record<string, string> = {
  groceries: "🛒", household: "🏠", "personal care": "🧴",
  "food & beverage": "🍜", transport: "🚌", other: "📦",
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
  reimbursable_total: number;
  receipt_count: number;
  flagged_count: number;
  receipts: any[];
  category_totals: Record<string, number>;
}

export default function TransactionsPage() {
  const [user, setUser] = useState<any>(null);
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, WeekDetail>>({});
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(true);
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
      try {
        const res = await api.get(`/weeks/${week.year}/${week.week_number}`);
        setDetails((prev) => ({ ...prev, [key]: res.data }));
      } catch {
        setExpanded(null);
      }
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <p className="text-gray-500 text-sm">All recorded weeks</p>
        <button
          onClick={() => setShowAll(!showAll)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${
            showAll
              ? "border-gray-200 text-gray-500 hover:border-gray-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {showAll ? "All expenses" : "Reimbursable only"}
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
      ) : weeks.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
          <p className="text-gray-500 text-sm">No weeks recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {weeks.map((week) => {
            const key = `${week.year}-${week.week_number}`;
            const isOpen = expanded === key;
            const detail = details[key];

            return (
              <div key={key} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleWeek(week)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left min-h-[64px]"
                >
                  <div>
                    <p className="text-gray-900 font-medium text-sm">Week {week.week_number}, {week.year}</p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {fmtDateRange(week.week_start, week.week_end)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {detail && (
                      <span className="text-gray-900 font-mono text-sm font-semibold">{fmt(detail.total)}</span>
                    )}
                    <span className={`text-gray-400 text-sm transition-transform ${isOpen ? "rotate-90" : ""}`}>
                      →
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                    {!detail ? (
                      <p className="text-gray-400 text-sm">Loading…</p>
                    ) : (
                      <>
                        {Object.keys(detail.category_totals).length > 0 && (
                          <div className="mb-4">
                            <p className="text-gray-400 text-xs uppercase tracking-widest mb-2">By Category</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {Object.entries(detail.category_totals)
                                .sort(([, a], [, b]) => b - a)
                                .map(([cat, amt]) => (
                                  <div
                                    key={cat}
                                    className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2"
                                  >
                                    <span className="text-gray-600 text-xs">{CATEGORY_EMOJI[cat]} {cat}</span>
                                    <span className="text-gray-900 text-xs font-mono">{fmt(amt)}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          {detail.receipts
                            .filter((r: any) => showAll || r.reimbursable !== false)
                            .map((r: any) => (
                              <div
                                key={r.id}
                                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                              >
                                <div>
                                  <p className="text-gray-800 text-sm">{r.vendor || "Unknown vendor"}</p>
                                  <p className="text-gray-400 text-xs">
                                    {r.date
                                      ? new Date(r.date).toLocaleDateString("en-SG", {
                                          weekday: "short",
                                          day: "numeric",
                                          month: "short",
                                        })
                                      : "—"}
                                    {r.flagged && (
                                      <span className="text-amber-500 ml-2">⚠ flagged</span>
                                    )}
                                  </p>
                                </div>
                                <span className="text-gray-900 text-sm font-mono">{fmt(r.total)}</span>
                              </div>
                            ))}
                        </div>

                        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                          <span className="text-gray-500 text-sm">{detail.receipt_count} receipts</span>
                          <span className="text-gray-900 font-semibold font-mono text-sm">{fmt(detail.total)}</span>
                        </div>
                        {detail.reimbursable_total != null &&
                          detail.reimbursable_total !== detail.total && (
                            <div className="flex justify-between mt-1">
                              <span className="text-gray-400 text-xs">To reimburse</span>
                              <span className="text-emerald-600 font-mono text-xs">{fmt(detail.reimbursable_total)}</span>
                            </div>
                          )}
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
  );
}
