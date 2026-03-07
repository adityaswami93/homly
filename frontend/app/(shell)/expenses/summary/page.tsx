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

interface AnalyticsData {
  date_from: string;
  date_to: string;
  summary: Summary;
  weekly_spending: WeekPoint[];
  category_totals: Record<string, number>;
  top_vendors: Vendor[];
  biggest_purchases: Purchase[];
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

function LightTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs shadow-lg">
      <p className="text-gray-500 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-gray-600">{p.name ?? p.dataKey}:</span>
          <span className="text-gray-900 font-mono">
            {typeof p.value === "number" && p.name !== "receipts"
              ? `SGD ${p.value.toFixed(2)}`
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5">
      <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function SummaryPage() {
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

  const catEntries = data
    ? Object.entries(data.category_totals).sort(([, a], [, b]) => b - a)
    : [];
  const catTotal = catEntries.reduce((s, [, v]) => s + v, 0);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Date range controls */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => { setActivePreset(p.days); setUseCustom(false); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors min-h-[36px] ${
              !useCustom && activePreset === p.days
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
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
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-emerald-400 w-32 text-base"
          />
          <span className="text-gray-400 text-xs">–</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-emerald-400 w-32 text-base"
          />
          <button
            onClick={() => { if (customFrom && customTo) setUseCustom(true); }}
            disabled={!customFrom || !customTo}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors min-h-[36px] ${
              useCustom
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-gray-200 text-gray-500 disabled:opacity-40"
            }`}
          >
            Apply
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
      ) : !data ? (
        <div className="text-gray-400 text-sm py-12 text-center">No data available.</div>
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
                className={`rounded-xl border p-4 bg-white ${
                  accent ? "border-emerald-200" : warn ? "border-red-200" : "border-gray-100"
                }`}
              >
                <p className={`text-xs mb-1 font-medium ${accent ? "text-emerald-600" : warn ? "text-red-500" : "text-gray-500"}`}>
                  {label}
                </p>
                <p className={`text-lg font-semibold font-mono ${accent ? "text-emerald-700" : warn ? "text-red-600" : "text-gray-900"}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Weekly spending chart */}
          {data.weekly_spending.length > 0 && (
            <Card title="Weekly spending">
              <div className="flex gap-2 mb-4">
                {(["bar", "line"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartType(t)}
                    className={`px-3 py-1 rounded-lg text-xs border transition-colors min-h-[32px] ${
                      chartType === t
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {t === "bar" ? "Bar" : "Line"}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                {chartType === "bar" ? (
                  <BarChart data={data.weekly_spending} barCategoryGap="30%" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${v}`} />
                    <Tooltip content={<LightTooltip />} cursor={{ fill: "#f9fafb" }} />
                    <Bar dataKey="total" name="total" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="reimbursable_total" name="reimbursable" fill="#10b98140" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <LineChart data={data.weekly_spending} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${v}`} />
                    <Tooltip content={<LightTooltip />} />
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
                        <span className="text-gray-700 text-sm">
                          {CATEGORY_EMOJI[cat] ?? "📦"} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </span>
                        <div className="flex items-center gap-2.5">
                          <span className="text-gray-400 text-xs">{pct}%</span>
                          <span className="text-gray-900 text-sm font-mono w-24 text-right">{fmt(amount)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full">
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

          <div className="grid md:grid-cols-2 gap-4">
            {/* Top vendors */}
            {data.top_vendors.length > 0 && (
              <Card title="Top vendors">
                <div className="space-y-2">
                  {data.top_vendors.map((v) => (
                    <div key={v.vendor} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="text-gray-800 text-sm">{v.vendor}</p>
                        <p className="text-gray-400 text-xs mt-0.5">{v.count} receipt{v.count !== 1 ? "s" : ""}</p>
                      </div>
                      <span className="text-gray-900 font-mono text-sm">{fmt(v.total)}</span>
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
                    <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="text-gray-800 text-sm">{p.vendor || "Unknown vendor"}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-gray-400 text-xs">{fmtDate(p.date)}</p>
                          {p.reimbursable && <span className="text-emerald-600 text-xs">reimburse</span>}
                          {p.flagged && <span className="text-amber-500 text-xs">⚠ flagged</span>}
                        </div>
                      </div>
                      <span className="text-gray-900 font-mono text-sm">{fmt(p.total)}</span>
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
