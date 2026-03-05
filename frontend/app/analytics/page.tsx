"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────

interface Summary {
  total: number;
  avg_weekly: number;
  wow_pct: number | null;
  flagged_rate: number;
  receipt_count: number;
}

interface WeekPoint {
  label: string;
  week: number;
  year: number;
  total: number;
  reimbursable_total: number;
}

interface VolumePoint {
  label: string;
  count: number;
}

interface Vendor {
  vendor: string;
  count: number;
  total: number;
}

interface Purchase {
  id: string;
  vendor: string | null;
  date: string | null;
  total: number;
  reimbursable: boolean;
  flagged: boolean;
}

interface SenderRow {
  sender_name: string;
  total: number;
  reimbursable_total: number;
  receipt_count: number;
}

interface AnalyticsData {
  date_from: string;
  date_to: string;
  summary: Summary;
  weekly_spending: WeekPoint[];
  category_totals: Record<string, number>;
  receipt_volume: VolumePoint[];
  top_vendors: Vendor[];
  biggest_purchases: Purchase[];
  sender_breakdown: SenderRow[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  "groceries":       "#10b981",
  "household":       "#3b82f6",
  "personal care":   "#a855f7",
  "food & beverage": "#f97316",
  "transport":       "#06b6d4",
  "other":           "#78716c",
};

const CATEGORY_EMOJI: Record<string, string> = {
  "groceries": "🛒", "household": "🏠", "personal care": "🧴",
  "food & beverage": "🍜", "transport": "🚌", "other": "📦",
};

const PRESETS = [
  { label: "7d",   days: 7 },
  { label: "30d",  days: 30 },
  { label: "90d",  days: 90 },
  { label: "180d", days: 180 },
  { label: "1y",   days: 365 },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (n == null) return "—";
  return `SGD ${Number(n).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ── Custom tooltip ───────────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1814] border border-stone-700 rounded-xl px-3 py-2.5 text-xs shadow-xl">
      <p className="text-stone-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-stone-300">{p.name ?? p.dataKey}:</span>
          <span className="text-stone-100 font-mono">
            {typeof p.value === "number" && p.name !== "receipts"
              ? `SGD ${p.value.toFixed(2)}`
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Section card ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-4 sm:p-5">
      <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [activePreset, setActivePreset] = useState(90);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      try {
        const res = await api.get("/household");
        if (!res.data?.id) { router.push("/onboarding"); return; }
      } catch { router.push("/onboarding"); return; }
    });
  }, [router]);

  const fetchData = async (from: string, to: string) => {
    setLoading(true);
    try {
      const res = await api.get("/analytics", { params: { date_from: from, date_to: to } });
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (useCustom) {
      if (customFrom && customTo) fetchData(customFrom, customTo);
    } else {
      const to = toISO(new Date());
      const from = toISO(addDays(new Date(), -(activePreset - 1)));
      fetchData(from, to);
    }
  }, [user, activePreset, useCustom, customFrom, customTo]);

  if (!user) return null;

  const handlePreset = (days: number) => {
    setActivePreset(days);
    setUseCustom(false);
  };

  const handleCustomApply = () => {
    if (customFrom && customTo) setUseCustom(true);
  };

  const catEntries = data
    ? Object.entries(data.category_totals).sort(([, a], [, b]) => b - a)
    : [];
  const catTotal = catEntries.reduce((s, [, v]) => s + v, 0);

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-10 py-8 pb-24 sm:pb-8">

        {/* Header + controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
            {data && (
              <p className="text-stone-500 text-sm mt-0.5">
                {fmtDate(data.date_from)} – {fmtDate(data.date_to)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                onClick={() => handlePreset(p.days)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  !useCustom && activePreset === p.days
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                    : "border-stone-800 text-stone-500 hover:text-stone-300 hover:border-stone-700"
                }`}
              >
                {p.label}
              </button>
            ))}
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-stone-900 border border-stone-800 rounded-lg px-2 py-1.5 text-xs text-stone-300 focus:outline-none focus:border-amber-400/60 w-32"
              />
              <span className="text-stone-600 text-xs">–</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-stone-900 border border-stone-800 rounded-lg px-2 py-1.5 text-xs text-stone-300 focus:outline-none focus:border-amber-400/60 w-32"
              />
              <button
                onClick={handleCustomApply}
                disabled={!customFrom || !customTo}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  useCustom
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                    : "border-stone-800 text-stone-500 hover:text-stone-300 disabled:opacity-30"
                }`}
              >
                Apply
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-stone-600 text-sm py-12">Loading...</p>
        ) : !data ? (
          <p className="text-stone-600 text-sm py-12">No data available.</p>
        ) : (
          <div className="space-y-4">

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {[
                { label: "Total spend",    value: fmt(data.summary.total),         accent: true },
                { label: "Avg per week",   value: fmt(data.summary.avg_weekly) },
                {
                  label: "Week-on-week",
                  value: data.summary.wow_pct != null
                    ? `${data.summary.wow_pct > 0 ? "+" : ""}${data.summary.wow_pct}%`
                    : "—",
                  warn: (data.summary.wow_pct ?? 0) > 0,
                  positive: (data.summary.wow_pct ?? 0) < 0,
                },
                {
                  label: "Flagged rate",
                  value: `${Math.round(data.summary.flagged_rate * 100)}%`,
                  warn: data.summary.flagged_rate > 0.1,
                },
              ].map(({ label, value, accent, warn, positive }) => (
                <div
                  key={label}
                  className={`rounded-xl border p-3 sm:p-4 ${
                    accent   ? "bg-amber-400/8 border-amber-400/20"
                    : warn   ? "bg-red-500/6 border-red-500/20"
                    :          "bg-stone-900/60 border-stone-800"
                  }`}
                >
                  <p className={`text-xs mb-1 ${accent ? "text-amber-400/70" : warn ? "text-red-400/70" : "text-stone-500"}`}>
                    {label}
                  </p>
                  <p className={`text-sm sm:text-lg font-semibold font-mono tracking-tight ${
                    accent    ? "text-amber-300"
                    : warn    ? "text-red-300"
                    : positive ? "text-emerald-400"
                    :           "text-stone-200"
                  }`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {/* Weekly spending chart */}
            {data.weekly_spending.length > 0 && (
              <Section title="Weekly spending">
                <div className="flex gap-2 mb-4">
                  {(["bar", "line"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setChartType(t)}
                      className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                        chartType === t
                          ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                          : "border-stone-800 text-stone-600 hover:text-stone-400"
                      }`}
                    >
                      {t === "bar" ? "Bar" : "Line"}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  {chartType === "bar" ? (
                    <BarChart data={data.weekly_spending} barCategoryGap="30%" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${v}`} />
                      <Tooltip content={<DarkTooltip />} cursor={{ fill: "#292524" }} />
                      <Bar dataKey="total" name="total" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="reimbursable_total" name="reimbursable" fill="#fbbf2440" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={data.weekly_spending} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${v}`} />
                      <Tooltip content={<DarkTooltip />} />
                      <Line type="monotone" dataKey="total" name="total" stroke="#fbbf24" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="reimbursable_total" name="reimbursable" stroke="#fbbf2460" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </Section>
            )}

            {/* Category breakdown */}
            {catEntries.length > 0 && (
              <Section title="By category">
                <div className="space-y-3">
                  {catEntries.map(([cat, amount]) => {
                    const pct = catTotal > 0 ? Math.min(100, Math.round((amount / catTotal) * 100)) : 0;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-stone-300 text-sm">
                            {CATEGORY_EMOJI[cat] ?? "📦"} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                          </span>
                          <div className="flex items-center gap-2.5">
                            <span className="text-stone-500 text-xs">{pct}%</span>
                            <span className="text-stone-200 text-sm font-mono w-24 text-right">{fmt(amount)}</span>
                          </div>
                        </div>
                        <div className="h-1 bg-stone-800 rounded-full">
                          <div
                            className="h-1 rounded-full transition-all"
                            style={{ width: `${pct}%`, background: CATEGORY_COLOR[cat] ?? "#78716c" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Top vendors + Biggest purchases + Receipt volume */}
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">

              {/* Top vendors */}
              {data.top_vendors.length > 0 && (
                <Section title="Top vendors">
                  <div className="space-y-2">
                    {data.top_vendors.map((v) => (
                      <div key={v.vendor} className="flex items-center justify-between py-1.5 border-b border-stone-800/60 last:border-0">
                        <div>
                          <p className="text-stone-200 text-sm">{v.vendor}</p>
                          <p className="text-stone-600 text-xs mt-0.5">{v.count} receipt{v.count !== 1 ? "s" : ""}</p>
                        </div>
                        <span className="text-stone-200 font-mono text-sm">{fmt(v.total)}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Biggest purchases */}
              {data.biggest_purchases.length > 0 && (
                <Section title="Biggest purchases">
                  <div className="space-y-2">
                    {data.biggest_purchases.map((p) => (
                      <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-stone-800/60 last:border-0">
                        <div>
                          <p className="text-stone-200 text-sm">{p.vendor || "Unknown vendor"}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-stone-600 text-xs">{fmtDate(p.date)}</p>
                            {p.reimbursable && <span className="text-emerald-400/70 text-xs">reimburse</span>}
                            {p.flagged && <span className="text-amber-400/70 text-xs">⚠ flagged</span>}
                          </div>
                        </div>
                        <span className="text-stone-200 font-mono text-sm">{fmt(p.total)}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Receipt volume */}
              {data.receipt_volume.length > 0 && (
                <Section title="Receipt volume">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={data.receipt_volume} barCategoryGap="30%" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
                      <Tooltip content={<DarkTooltip />} cursor={{ fill: "#292524" }} />
                      <Bar dataKey="count" name="receipts" fill="#44403c" radius={[4, 4, 0, 0]}>
                        {data.receipt_volume.map((_, i) => (
                          <Cell key={i} fill="#a8a29e40" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Section>
              )}
            </div>

            {/* Sender breakdown */}
            {data.sender_breakdown.length > 0 && (
              <Section title="By sender">
                <div className="space-y-3">
                  {data.sender_breakdown.map((s) => {
                    const ownTotal = s.total - s.reimbursable_total;
                    return (
                      <div key={s.sender_name} className="py-1.5 border-b border-stone-800/60 last:border-0">
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <p className="text-stone-200 text-sm">{s.sender_name}</p>
                            <p className="text-stone-600 text-xs mt-0.5">
                              {s.receipt_count} receipt{s.receipt_count !== 1 ? "s" : ""}
                            </p>
                          </div>
                          <span className="text-stone-200 font-mono text-sm">{fmt(s.total)}</span>
                        </div>
                        {s.reimbursable_total > 0 && (
                          <div className="flex gap-3 text-xs mt-1">
                            <span className="text-emerald-400/80">↑ {fmt(s.reimbursable_total)} reimburse</span>
                            {ownTotal > 0 && <span className="text-stone-500">own {fmt(ownTotal)}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

          </div>
        )}
      </div>
    </main>
  );
}
