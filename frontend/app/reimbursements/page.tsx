"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface Reimbursement {
  id: string;
  year: number;
  week_number: number;
  amount: number;
  note: string | null;
  paid_at: string;
  created_by: string;
}

interface WeekSummary {
  year: number;
  week_number: number;
  reimbursable_total: number;
  receipt_count: number;
  paid: number;
  outstanding: number;
  reimbursements: Reimbursement[];
}

function getWeekRange(year: number, week: number): { start: Date; end: Date } {
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(startOfWeek1);
  start.setDate(startOfWeek1.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function formatWeekRange(year: number, week: number): string {
  const { start, end } = getWeekRange(year, week);
  const s = start.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  const e = end.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  return `${s} – ${e}`;
}

function fmt(amount: number | null) {
  if (amount == null) return "—";
  return `SGD ${Number(amount).toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function StatusBadge({ outstanding, paid }: { outstanding: number; paid: number }) {
  if (outstanding <= 0) {
    return (
      <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
        ✓ Settled
      </span>
    );
  }
  if (paid > 0) {
    return (
      <span className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
        Partial
      </span>
    );
  }
  return (
    <span className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
      Unpaid
    </span>
  );
}

export default function ReimbursementsPage() {
  const [user,         setUser]         = useState<any>(null);
  const [weeks,        setWeeks]        = useState<WeekSummary[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [filter,       setFilter]       = useState<"all" | "unpaid" | "settled">("all");
  const [paying,       setPaying]       = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<Record<string, string>>({});
  const { toasts, dismissToast, toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load all weeks with receipts
      const weeksRes = await api.get("/weeks");
      const allReimbursements = await api.get("/reimbursements");

      // Group reimbursements by week
      const reimbMap: Record<string, Reimbursement[]> = {};
      for (const r of allReimbursements.data) {
        const key = `${r.year}-${r.week_number}`;
        if (!reimbMap[key]) reimbMap[key] = [];
        reimbMap[key].push(r);
      }

      // Build week summaries
      const summaries: WeekSummary[] = (weeksRes.data || [])
        .filter((w: any) => (w.reimbursable_total || 0) > 0)
        .map((w: any) => {
          const key   = `${w.year}-${w.week_number}`;
          const reimbs = reimbMap[key] || [];
          const paid   = reimbs.reduce((s: number, r: Reimbursement) => s + Number(r.amount), 0);
          return {
            year:               w.year,
            week_number:        w.week_number,
            reimbursable_total: w.reimbursable_total || 0,
            receipt_count:      w.receipt_count || 0,
            paid:               Math.round(paid * 100) / 100,
            outstanding:        Math.round((w.reimbursable_total - paid) * 100) / 100,
            reimbursements:     reimbs,
          };
        })
        .sort((a: WeekSummary, b: WeekSummary) =>
          b.year !== a.year ? b.year - a.year : b.week_number - a.week_number
        );

      setWeeks(summaries);
    } catch (e) {
      toast.error("Failed to load reimbursements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const handleMarkPaid = async (week: WeekSummary, amount?: number) => {
    const key = `${week.year}-${week.week_number}`;
    setPaying(key);
    try {
      const payAmount = amount ?? week.outstanding;
      await api.post("/reimbursements", {
        year:        week.year,
        week_number: week.week_number,
        amount:      payAmount,
        note:        `Week ${week.week_number} reimbursement`,
      });
      toast.success(`${fmt(payAmount)} marked as paid`);
      setCustomAmount((prev) => ({ ...prev, [key]: "" }));
      await load();
    } catch (e) {
      toast.error("Failed to record payment");
    } finally {
      setPaying(null);
    }
  };

  const handleDeleteReimbursement = async (id: string) => {
    try {
      await api.delete(`/reimbursements/${id}`);
      toast.success("Payment record removed");
      await load();
    } catch (e) {
      toast.error("Failed to remove payment");
    }
  };

  const filtered = weeks.filter((w) => {
    if (filter === "unpaid")   return w.outstanding > 0;
    if (filter === "settled")  return w.outstanding <= 0;
    return true;
  });

  const totalOutstanding = weeks.reduce((s, w) => s + Math.max(0, w.outstanding), 0);
  const totalPaid        = weeks.reduce((s, w) => s + w.paid, 0);

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 pb-24 sm:pb-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Reimbursements</h1>
          <p className="text-stone-500 text-sm">Track what has been paid and what is outstanding.</p>
        </div>

        {/* Summary cards */}
        {!loading && weeks.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-red-500/6 border border-red-500/20 rounded-xl p-4">
              <p className="text-xs text-red-400/70 mb-1">Outstanding</p>
              <p className="text-lg font-semibold font-mono text-red-300">
                {fmt(totalOutstanding)}
              </p>
            </div>
            <div className="bg-emerald-500/6 border border-emerald-500/20 rounded-xl p-4">
              <p className="text-xs text-emerald-400/70 mb-1">Total paid</p>
              <p className="text-lg font-semibold font-mono text-emerald-300">
                {fmt(totalPaid)}
              </p>
            </div>
            <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-4">
              <p className="text-xs text-stone-500 mb-1">All time</p>
              <p className="text-lg font-semibold font-mono text-stone-200">
                {fmt(totalOutstanding + totalPaid)}
              </p>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 bg-stone-900/60 border border-stone-800 rounded-xl p-1 mb-6">
          {([
            { key: "all",      label: "All" },
            { key: "unpaid",   label: `Unpaid (${weeks.filter(w => w.outstanding > 0).length})` },
            { key: "settled",  label: `Settled (${weeks.filter(w => w.outstanding <= 0).length})` },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === tab.key
                  ? "bg-stone-800 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-stone-600 text-sm py-12 text-center">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="border border-stone-800 rounded-xl p-12 text-center">
            <p className="text-stone-400 font-medium mb-2">
              {filter === "unpaid" ? "Nothing outstanding" : filter === "settled" ? "No settled weeks yet" : "No reimbursable receipts yet"}
            </p>
            <p className="text-stone-600 text-sm">
              {filter === "all" && "Receipts marked as reimbursable will appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((week) => {
              const key        = `${week.year}-${week.week_number}`;
              const isExpanded = expanded === key;
              const isPaying   = paying === key;

              return (
                <div key={key} className="border border-stone-800 rounded-xl overflow-hidden">
                  {/* Week row */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : key)}
                    className="w-full px-4 py-4 flex items-center justify-between hover:bg-stone-900/40 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-stone-200 font-medium text-sm">
                            Week {week.week_number}
                          </p>
                          <StatusBadge outstanding={week.outstanding} paid={week.paid} />
                        </div>
                        <p className="text-stone-600 text-xs mt-0.5">
                          {formatWeekRange(week.year, week.week_number)} · {week.receipt_count} receipts
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {week.outstanding > 0 && (
                          <p className="text-red-300 font-mono text-sm font-medium">
                            {fmt(week.outstanding)} due
                          </p>
                        )}
                        {week.paid > 0 && (
                          <p className="text-emerald-400/70 font-mono text-xs">
                            {fmt(week.paid)} paid
                          </p>
                        )}
                      </div>
                      <span className={`text-stone-600 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>
                        →
                      </span>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-stone-800 bg-stone-900/20">

                      {/* Payment history */}
                      {week.reimbursements.length > 0 && (
                        <div className="px-4 py-3 border-b border-stone-800/60">
                          <p className="text-stone-600 text-xs uppercase tracking-widest mb-2">
                            Payment history
                          </p>
                          <div className="space-y-1.5">
                            {week.reimbursements.map((r) => (
                              <div key={r.id} className="flex items-center justify-between">
                                <div>
                                  <p className="text-stone-300 text-sm font-mono">
                                    {fmt(r.amount)}
                                  </p>
                                  <p className="text-stone-600 text-xs">
                                    {fmtDate(r.paid_at)}{r.note ? ` · ${r.note}` : ""}
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleDeleteReimbursement(r.id)}
                                  className="text-xs text-red-400/40 hover:text-red-400 transition-colors px-2 py-1"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Total breakdown */}
                      <div className="px-4 py-3 border-b border-stone-800/60">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-stone-500">Total reimbursable</span>
                          <span className="text-stone-300 font-mono">{fmt(week.reimbursable_total)}</span>
                        </div>
                        {week.paid > 0 && (
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-stone-500">Paid</span>
                            <span className="text-emerald-400 font-mono">− {fmt(week.paid)}</span>
                          </div>
                        )}
                        {week.outstanding > 0 && (
                          <div className="flex justify-between text-sm pt-1 border-t border-stone-800/60 mt-1">
                            <span className="text-stone-400 font-medium">Outstanding</span>
                            <span className="text-red-300 font-mono font-medium">{fmt(week.outstanding)}</span>
                          </div>
                        )}
                      </div>

                      {/* Mark as paid actions */}
                      {week.outstanding > 0 && (
                        <div className="px-4 py-3 space-y-2">
                          {/* Full payment */}
                          <button
                            onClick={() => handleMarkPaid(week)}
                            disabled={!!isPaying}
                            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 disabled:opacity-40"
                          >
                            {isPaying ? "Recording..." : `Mark ${fmt(week.outstanding)} as paid`}
                          </button>

                          {/* Partial payment */}
                          <div className="flex gap-2">
                            <input
                              type="number"
                              placeholder="Custom amount"
                              value={customAmount[key] || ""}
                              onChange={(e) =>
                                setCustomAmount((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-amber-400/60"
                            />
                            <button
                              onClick={() => {
                                const amt = parseFloat(customAmount[key] || "0");
                                if (amt > 0) handleMarkPaid(week, amt);
                              }}
                              disabled={!!isPaying || !customAmount[key]}
                              className="px-4 py-2 rounded-xl text-sm border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors disabled:opacity-40"
                            >
                              Partial
                            </button>
                          </div>
                        </div>
                      )}

                      {week.outstanding <= 0 && (
                        <div className="px-4 py-3 text-center">
                          <p className="text-emerald-400/60 text-sm">✓ Fully settled</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
