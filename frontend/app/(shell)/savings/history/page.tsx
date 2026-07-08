"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useHousehold } from "@/lib/HouseholdContext";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

interface NetWorthPoint {
  date: string;
  net_worth: number;
}

interface NetWorthSummary {
  total: number;
  currency: string;
  by_type: Record<string, number>;
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

function DarkTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-stone-900 border border-stone-700 rounded-xl px-3 py-2.5 text-xs shadow-lg">
      <p className="text-stone-500 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-stone-400">Net worth:</span>
          <span className="text-stone-100 font-mono">
            {currency} {Number(p.value).toLocaleString()}
          </span>
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
  const { activeHousehold } = useHousehold();

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

  if (!user) return null;

  const currency = summary?.currency ?? activeHousehold?.default_currency ?? "SGD";
  const byTypeEntries = Object.entries(summary?.by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const byTypeTotal = byTypeEntries.reduce((s, [, v]) => s + v, 0);

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
              <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: "#78716c", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v) => `${currency} ${Number(v).toLocaleString()}`}
                />
                <Tooltip content={<DarkTooltip currency={currency} />} />
                <Line type="monotone" dataKey="net_worth" name="Net worth" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {byTypeEntries.length > 0 && (
            <Card title="By account type">
              <div className="space-y-3">
                {byTypeEntries.map(([type, amount]) => {
                  const pct = byTypeTotal > 0 ? Math.min(100, Math.round((amount / byTypeTotal) * 100)) : 0;
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-stone-300">{TYPE_LABEL[type] ?? type}</span>
                        <span className="text-stone-400 font-mono">
                          {currency} {amount.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-stone-800 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
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
