"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

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

interface MonthPoint {
  label: string;
  month: string;
  total: number;
  reimbursable_total: number;
  receipt_count: number;
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

interface RecurringVendor {
  vendor: string;
  week_count: number;
  receipt_count: number;
  total: number;
  avg_per_occurrence: number;
}

interface AnalyticsData {
  date_from: string;
  date_to: string;
  summary: Summary;
  weekly_spending: WeekPoint[];
  monthly_spending: MonthPoint[];
  category_totals: Record<string, number>;
  top_vendors: Vendor[];
  biggest_purchases: Purchase[];
  sender_breakdown: SenderRow[];
  recurring_vendors: RecurringVendor[];
}

const CATEGORY_COLOR: Record<string, string> = {
  groceries: "#10b981",
  household: "#3b82f6",
  "personal care": "#a855f7",
  "food & beverage": "#f97316",
  transport: "#06b6d4",
  other: "#9ca3af",
};

const CATEGORY_EMOJI: Record<string, string> = {
  groceries: "🛒", household: "🏠", "personal care": "🧴",
  "food & beverage": "🍜", transport: "🚌", other: "📦",
};

const SENDER_COLORS = ["#10b981", "#3b82f6", "#a855f7", "#f97316", "#06b6d4", "#f59e0b"];

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "1y", days: 365 },
];

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

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-stone-900 border border-stone-700 rounded-xl px-3 py-2.5 text-xs shadow-lg">
      <p className="text-stone-500 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-stone-400">{p.name ?? p.dataKey}:</span>
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

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-stone-500 text-xs uppercase tracking-widest">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function AnalyticsPage() {
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [groupBy, setGroupBy] = useState<"week" | "month">("week");
  const [activePreset, setActivePreset] = useState(90);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [exporting, setExporting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const getDateRange = () => {
    if (useCustom && customFrom && customTo) return { from: customFrom, to: customTo };
    const to = toISO(new Date());
    const from = toISO(addDays(new Date(), -(activePreset - 1)));
    return { from, to };
  };

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
    const { from, to } = getDateRange();
    fetchData(from, to);
  }, [user, activePreset, useCustom, customFrom, customTo]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { from, to } = getDateRange();
      const res = await api.get("/analytics/export", {
        params: { date_from: from, date_to: to },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `homly-expenses-${from}-to-${to}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      // silently fail
    } finally {
      setExporting(false);
    }
  };

  if (!user) return null;

  const catEntries = data
    ? Object.entries(data.category_totals).sort(([, a], [, b]) => b - a)
    : [];
  const catTotal = catEntries.reduce((s, [, v]) => s + v, 0);

  const chartData: (WeekPoint | MonthPoint)[] | undefined = groupBy === "week" ? data?.weekly_spending : data?.monthly_spending;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {/* Presets */}
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => { setActivePreset(p.days); setUseCustom(false); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors min-h-[36px] ${
              !useCustom && activePreset === p.days
                ? "border-emerald-800 bg-emerald-900/30 text-emerald-400"
                : "border-stone-700 text-stone-400 hover:border-stone-600"
            }`}
          >
            {p.label}
          </button>
        ))}

        {/* Custom date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="border border-stone-700 bg-stone-900 rounded-lg px-2 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-emerald-600 w-32 text-base"
          />
          <span className="text-stone-500 text-xs">–</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="border border-stone-700 bg-stone-900 rounded-lg px-2 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-emerald-600 w-32 text-base"
          />
          <button
            onClick={() => { if (customFrom && customTo) setUseCustom(true); }}
            disabled={!customFrom || !customTo}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors min-h-[36px] ${
              useCustom
                ? "border-emerald-800 bg-emerald-900/30 text-emerald-400"
                : "border-stone-700 text-stone-400 disabled:opacity-40"
            }`}
          >
            Apply
          </button>
        </div>

        {/* Export CSV */}
        <button
          onClick={handleExport}
          disabled={exporting || loading || !data}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-700 text-stone-400 hover:border-stone-600 hover:text-stone-200 transition-colors min-h-[36px] disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : !data ? (
        <div className="text-stone-500 text-sm py-12 text-center">No data available.</div>
      ) : (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total spend", value: fmt(data.summary.total), accent: true },
              { label: "Avg per week", value: fmt(data.summary.avg_weekly) },
              {
                label: "Week-on-week",
                value: data.summary.wow_pct != null
                  ? `${data.summary.wow_pct > 0 ? "+" : ""}${data.summary.wow_pct}%`
                  : "—",
              },
              {
                label: "Flagged rate",
                value: `${Math.round(data.summary.flagged_rate * 100)}%`,
                warn: data.summary.flagged_rate > 0.1,
              },
            ].map(({ label, value, accent, warn }) => (
              <div
                key={label}
                className={`rounded-xl border p-4 bg-stone-900 ${
                  accent ? "border-emerald-800" : warn ? "border-red-800" : "border-stone-800"
                }`}
              >
                <p className={`text-xs mb-1 font-medium ${accent ? "text-emerald-400" : warn ? "text-red-400" : "text-stone-500"}`}>
                  {label}
                </p>
                <p className={`text-lg font-semibold font-mono ${accent ? "text-emerald-400" : warn ? "text-red-400" : "text-stone-100"}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Spending chart */}
          {chartData && chartData.length > 0 && (
            <Card title={groupBy === "week" ? "Weekly spending" : "Monthly spending"}>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setGroupBy("week")}
                  className={`px-3 py-1 rounded-lg text-xs border transition-colors min-h-[32px] ${
                    groupBy === "week"
                      ? "border-emerald-800 bg-emerald-900/30 text-emerald-400"
                      : "border-stone-700 text-stone-400 hover:border-stone-600"
                  }`}
                >
                  Weekly
                </button>
                <button
                  onClick={() => setGroupBy("month")}
                  className={`px-3 py-1 rounded-lg text-xs border transition-colors min-h-[32px] ${
                    groupBy === "month"
                      ? "border-emerald-800 bg-emerald-900/30 text-emerald-400"
                      : "border-stone-700 text-stone-400 hover:border-stone-600"
                  }`}
                >
                  Monthly
                </button>
                <div className="w-px bg-stone-800 mx-1" />
                {(["bar", "line"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartType(t)}
                    className={`px-3 py-1 rounded-lg text-xs border transition-colors min-h-[32px] ${
                      chartType === t
                        ? "border-emerald-800 bg-emerald-900/30 text-emerald-400"
                        : "border-stone-700 text-stone-400 hover:border-stone-600"
                    }`}
                  >
                    {t === "bar" ? "Bar" : "Line"}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                {chartType === "bar" ? (
                  <BarChart data={chartData} barCategoryGap="30%" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${v}`} />
                    <Tooltip content={<DarkTooltip />} cursor={{ fill: "#1c1917" }} />
                    <Bar dataKey="total" name="total" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="reimbursable_total" name="reimbursable" fill="#10b98140" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${v}`} />
                    <Tooltip content={<DarkTooltip />} />
                    <Line type="monotone" dataKey="total" name="total" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="reimbursable_total" name="reimbursable" stroke="#10b98160" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </Card>
          )}

          {/* Category breakdown */}
          {catEntries.length > 0 && (
            <Card title="By category">
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
                          <span className="text-stone-100 text-sm font-mono w-24 text-right">{fmt(amount)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-stone-800 rounded-full">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{ width: `${pct}%`, background: CATEGORY_COLOR[cat] ?? "#9ca3af" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* By person */}
          {data.sender_breakdown.length > 1 && (
            <Card title="By person">
              <div className="space-y-3">
                {data.sender_breakdown.map((row, i) => {
                  const total = data.summary.total;
                  const pct = total > 0 ? Math.min(100, Math.round((row.total / total) * 100)) : 0;
                  const color = SENDER_COLORS[i % SENDER_COLORS.length];
                  return (
                    <div key={row.sender_name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: color }}
                          />
                          <span className="text-stone-300 text-sm">{row.sender_name}</span>
                          <span className="text-stone-600 text-xs">{row.receipt_count} receipts</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-stone-500 text-xs">{pct}%</span>
                          <span className="text-stone-100 text-sm font-mono w-24 text-right">{fmt(row.total)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-stone-800 rounded-full">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                      {row.reimbursable_total > 0 && (
                        <p className="text-stone-600 text-xs mt-1 ml-4">
                          {fmt(row.reimbursable_total)} reimbursable
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Recurring vendors */}
          {data.recurring_vendors.length > 0 && (
            <Card title="Recurring spend">
              <p className="text-stone-600 text-xs mb-3">
                Vendors you shop at consistently (3+ different weeks)
              </p>
              <div className="space-y-2">
                {data.recurring_vendors.map((v) => (
                  <div key={v.vendor} className="flex items-center justify-between py-2 border-b border-stone-800 last:border-0">
                    <div>
                      <p className="text-stone-200 text-sm">{v.vendor}</p>
                      <p className="text-stone-500 text-xs mt-0.5">
                        {v.week_count} weeks · {v.receipt_count} receipts · {fmt(v.avg_per_occurrence)} avg
                      </p>
                    </div>
                    <span className="text-stone-100 font-mono text-sm">{fmt(v.total)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {/* Top vendors */}
            {data.top_vendors.length > 0 && (
              <Card title="Top vendors">
                <div className="space-y-2">
                  {data.top_vendors.map((v) => (
                    <div key={v.vendor} className="flex items-center justify-between py-2 border-b border-stone-800 last:border-0">
                      <div>
                        <p className="text-stone-200 text-sm">{v.vendor}</p>
                        <p className="text-stone-500 text-xs mt-0.5">{v.count} receipt{v.count !== 1 ? "s" : ""}</p>
                      </div>
                      <span className="text-stone-100 font-mono text-sm">{fmt(v.total)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Biggest purchases */}
            {data.biggest_purchases.length > 0 && (
              <Card title="Biggest purchases">
                <div className="space-y-2">
                  {data.biggest_purchases.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2 border-b border-stone-800 last:border-0">
                      <div>
                        <p className="text-stone-200 text-sm">{p.vendor || "Unknown vendor"}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-stone-500 text-xs">{fmtDate(p.date)}</p>
                          {p.reimbursable && <span className="text-emerald-400 text-xs">reimburse</span>}
                          {p.flagged && <span className="text-amber-400 text-xs">⚠ flagged</span>}
                        </div>
                      </div>
                      <span className="text-stone-100 font-mono text-sm">{fmt(p.total)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
