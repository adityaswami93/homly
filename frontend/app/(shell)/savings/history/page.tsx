"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface NetWorthPoint {
  date: string;
  totals_by_currency: Record<string, number>;
}

interface NetWorthSummary {
  totals_by_currency: Record<string, number>;
  by_type: Record<string, Record<string, number>>;
  account_count: number;
}

const TYPE_LABEL: Record<string, string> = {
  bank_savings: "Bank Savings",
  fixed_deposit: "Fixed Deposit",
  retirement_fund: "Retirement Fund",
  stocks: "Stocks",
  mutual_fund: "Mutual Fund",
  bonds: "Bonds",
  property: "Property",
  other: "Other",
};

const LINE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444"];

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-stone-900 border border-stone-700 rounded-xl px-3 py-2.5 text-xs shadow-lg">
      <p className="text-stone-500 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-stone-400">{p.dataKey}:</span>
          <span className="text-stone-100 font-mono">{Number(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-stone-300 mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function SavingsHistoryPage() {
  const [user, setUser] = useState<any>(null);
  const [points, setPoints] = useState<NetWorthPoint[]>([]);
  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.get("/savings/history"), api.get("/savings/networth")])
      .then(([historyRes, networthRes]) => {
        setPoints(historyRes.data.points || []);
        setSummary(networthRes.data);
      })
      .catch(() => {
        setPoints([]);
        setSummary(null);
      })
      .finally(() => setLoading(false));
  }, [user]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    points.forEach((p) => Object.keys(p.totals_by_currency || {}).forEach((c) => set.add(c)));
    Object.keys(summary?.totals_by_currency ?? {}).forEach((c) => set.add(c));
    return Array.from(set).sort();
  }, [points, summary]);

  // Flatten each point's per-currency totals into top-level keys so recharts
  // can plot one Line per currency (e.g. { date, SGD: 1000, INR: 50000 }).
  const chartData = useMemo(
    () => points.map((p) => ({ date: p.date, ...p.totals_by_currency })),
    [points]
  );

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : points.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <h3 className="text-stone-200 font-semibold mb-2">No history yet</h3>
          <p className="text-stone-500 text-sm">
            Add accounts and update balances on the Overview page to start building a net worth trend.
          </p>
        </div>
      ) : (
        <>
          <Card title="Net worth over time">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: "#78716c", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v) => Number(v).toLocaleString()}
                />
                <Tooltip content={<DarkTooltip />} />
                {currencies.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "#a8a29e" }} />}
                {currencies.map((cur, i) => (
                  <Line
                    key={cur}
                    type="monotone"
                    dataKey={cur}
                    name={cur}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {summary && Object.keys(summary.by_type).length > 0 && (
            <Card title="By account type">
              <div className="space-y-5">
                {Object.entries(summary.by_type).map(([cur, types]) => {
                  const entries = Object.entries(types).sort((a, b) => b[1] - a[1]);
                  const curTotal = entries.reduce((s, [, v]) => s + v, 0);
                  return (
                    <div key={cur}>
                      {Object.keys(summary.by_type).length > 1 && (
                        <p className="text-xs font-medium text-stone-400 mb-2">{cur}</p>
                      )}
                      <div className="space-y-3">
                        {entries.map(([type, amount]) => {
                          const pct = curTotal > 0 ? Math.min(100, Math.round((amount / curTotal) * 100)) : 0;
                          return (
                            <div key={type}>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-stone-300">{TYPE_LABEL[type] ?? type}</span>
                                <span className="text-stone-400 font-mono">
                                  {cur} {amount.toLocaleString()} ({pct}%)
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-stone-800 overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
