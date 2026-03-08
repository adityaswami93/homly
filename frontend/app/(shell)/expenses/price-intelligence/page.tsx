"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

interface PriceComparisonRow {
  canonical_name: string;
  brand: string | null;
  variant: string | null;
  vendor: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  purchase_count: number;
}
interface CheapestStoreRow {
  category: string;
  vendor: string;
  wins: number;
  avg_saving_vs_most_expensive: number;
}
interface PriceTrendRow {
  canonical_name: string;
  brand: string | null;
  vendor: string;
  month: string;
  avg_price: number;
  purchase_count: number;
}
interface PriceIntelligenceSummary {
  total_items_tracked: number;
  total_price_records: number;
  total_households_contributing: number;
  most_tracked_item: string | null;
  most_expensive_category: string | null;
}
interface PriceIntelligenceData {
  price_comparison: PriceComparisonRow[];
  cheapest_store_by_category: CheapestStoreRow[];
  price_trends: PriceTrendRow[];
  summary: PriceIntelligenceSummary;
}

const CATEGORY_EMOJI: Record<string, string> = {
  "groceries": "🛒", "household": "🏠", "personal care": "🧴",
  "food & beverage": "🍜", "transport": "🚌", "other": "📦",
};

const TREND_COLORS = ["#fbbf24", "#10b981", "#3b82f6", "#a855f7", "#f97316", "#06b6d4"];

function fmtPrice(n: number | null) {
  if (n == null) return "—";
  return `$${Number(n).toFixed(2)}`;
}

function fmtMonth(ym: string) {
  const [year, month] = ym.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-SG", { month: "short", year: "2-digit" });
}

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-stone-900 border border-stone-700 rounded-xl px-3 py-2.5 text-xs shadow-xl">
      <p className="text-stone-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-stone-300">{p.name}:</span>
          <span className="text-stone-100 font-mono">{fmtPrice(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function InsightsPage() {
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<PriceIntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    api.get("/admin/price-intelligence")
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <div className="text-stone-500 text-sm py-12 text-center">Loading insights…</div>
      </div>
    );
  }

  if (!data || data.price_comparison.length === 0) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">📊</span>
          </div>
          <h3 className="text-stone-200 font-semibold mb-2">Not enough data yet</h3>
          <p className="text-stone-500 text-sm">
            Price intelligence becomes available once your household has tracked multiple purchases of the same items.
          </p>
        </div>
      </div>
    );
  }

  const { summary, price_comparison, cheapest_store_by_category, price_trends } = data;

  const filtered = price_comparison.filter((r) =>
    r.canonical_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const itemMinMax: Record<string, { min: number; max: number }> = {};
  filtered.forEach((r) => {
    if (!itemMinMax[r.canonical_name]) {
      itemMinMax[r.canonical_name] = { min: r.avg_price, max: r.avg_price };
    } else {
      itemMinMax[r.canonical_name].min = Math.min(itemMinMax[r.canonical_name].min, r.avg_price);
      itemMinMax[r.canonical_name].max = Math.max(itemMinMax[r.canonical_name].max, r.avg_price);
    }
  });

  let lastItemName = "";

  const trendItems = Array.from(new Set(price_trends.map((r) => r.canonical_name))).sort();
  const activeTrendItem = selectedItem || trendItems[0] || "";
  const trendRows = price_trends.filter((r) => r.canonical_name === activeTrendItem);
  const trendVendors = Array.from(new Set(trendRows.map((r) => r.vendor)));
  const trendMonths = Array.from(new Set(trendRows.map((r) => r.month))).sort();

  const trendChartData = trendMonths.map((month) => {
    const point: Record<string, any> = { month: fmtMonth(month) };
    trendVendors.forEach((vendor) => {
      const row = trendRows.find((r) => r.month === month && r.vendor === vendor);
      if (row) point[vendor || "unknown"] = row.avg_price;
    });
    return point;
  });

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Items tracked", value: summary.total_items_tracked.toString() },
          { label: "Price records", value: summary.total_price_records.toString() },
          { label: "Most tracked", value: summary.most_tracked_item ?? "—" },
          { label: "Priciest category", value: summary.most_expensive_category ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-stone-900 border border-stone-800 rounded-xl p-4">
            <p className="text-xs text-stone-500 mb-1">{label}</p>
            <p className="text-sm font-semibold text-stone-200 truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Price comparison */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
        <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">Price comparison by store</h2>
        <input
          type="text"
          placeholder="Search item..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full sm:w-72 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-emerald-500/60 mb-4"
        />
        {filtered.length === 0 ? (
          <p className="text-stone-600 text-sm">No items match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-xs text-stone-500 border-b border-stone-800">
                  <th className="pb-2 font-medium pr-4">Item</th>
                  <th className="pb-2 font-medium pr-4">Store</th>
                  <th className="pb-2 font-medium pr-4 text-right">Avg price</th>
                  <th className="pb-2 font-medium text-right">Purchases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800">
                {filtered.map((r, idx) => {
                  const isFirst = r.canonical_name !== lastItemName;
                  if (isFirst) lastItemName = r.canonical_name;
                  const mm = itemMinMax[r.canonical_name];
                  const isCheapest = mm && r.avg_price === mm.min && mm.min !== mm.max;
                  const isMostExpensive = mm && r.avg_price === mm.max && mm.min !== mm.max;

                  return (
                    <tr key={idx} className={isCheapest ? "bg-emerald-500/5" : isMostExpensive ? "bg-red-500/5" : ""}>
                      <td className="py-2 pr-4">
                        {isFirst ? (
                          <span className="text-stone-200 font-medium">{r.canonical_name}</span>
                        ) : (
                          <span className="text-stone-600 text-xs pl-3">↳</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-stone-400">{r.vendor || "—"}</td>
                      <td className={`py-2 pr-4 text-right font-mono ${
                        isCheapest ? "text-emerald-400" : isMostExpensive ? "text-red-400" : "text-stone-200"
                      }`}>
                        {fmtPrice(r.avg_price)}
                      </td>
                      <td className="py-2 text-right text-stone-500">{r.purchase_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cheapest stores */}
      {cheapest_store_by_category.length > 0 && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
          <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">Best value store by category</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cheapest_store_by_category.map((row) => (
              <div key={row.category} className="bg-stone-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{CATEGORY_EMOJI[row.category] ?? "📦"}</span>
                  <span className="text-stone-300 text-sm font-medium capitalize">{row.category}</span>
                </div>
                <p className="text-emerald-300 font-semibold text-sm">{row.vendor || "—"}</p>
                {row.avg_saving_vs_most_expensive > 0 && (
                  <p className="text-emerald-400/80 text-xs mt-1">
                    saves ~{fmtPrice(row.avg_saving_vs_most_expensive)} avg
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price trends */}
      {trendItems.length > 0 && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
          <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">Price trends over time</h2>
          <select
            value={activeTrendItem}
            onChange={(e) => setSelectedItem(e.target.value)}
            className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:border-emerald-500/60 mb-4"
          >
            {trendItems.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          {trendChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<DarkTooltip />} />
                {trendVendors.map((vendor, i) => (
                  <Line
                    key={vendor}
                    type="monotone"
                    dataKey={vendor || "unknown"}
                    name={vendor || "unknown"}
                    stroke={TREND_COLORS[i % TREND_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-stone-600 text-sm">Not enough trend data for this item.</p>
          )}
        </div>
      )}
    </div>
  );
}
