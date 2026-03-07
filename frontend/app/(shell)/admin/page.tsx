"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Member { user_id: string; role: string; }
interface Household {
  id: string;
  name: string;
  plan: string;
  active: boolean;
  created_at: string;
  member_count: number;
  receipt_count: number;
  members: Member[];
}
interface Invite {
  id: string;
  email: string;
  household_id: string | null;
  role: string;
  accepted: boolean;
  created_at: string;
  expires_at: string;
}
interface PriceComparisonRow {
  canonical_name: string;
  brand: string | null;
  variant: string | null;
  category: string | null;
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

const TREND_COLORS = [
  "#fbbf24", "#10b981", "#3b82f6", "#a855f7", "#f97316", "#06b6d4",
  "#ec4899", "#84cc16",
];

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
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-stone-300">{p.name ?? p.dataKey}:</span>
          <span className="text-stone-100 font-mono">{fmtPrice(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-4 sm:p-5">
      <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">{title}</h2>
      {children}
    </div>
  );
}

function PriceIntelligenceTab() {
  const [data, setData] = useState<PriceIntelligenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [searchComparison, setSearchComparison] = useState("");
  const [minCount, setMinCount] = useState<3 | 5 | 10>(3);
  const [selectedItem, setSelectedItem] = useState("");

  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    setLoading(true);
    api.get("/admin/price-intelligence")
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, [fetched]);

  if (loading) return <p className="text-stone-500 text-sm py-12">Loading price intelligence...</p>;
  if (!data) return <p className="text-stone-500 text-sm py-12">No data available.</p>;

  const { summary, price_comparison, cheapest_store_by_category, price_trends } = data;

  const filteredComparison = price_comparison.filter((r) => {
    const matchSearch = r.canonical_name.toLowerCase().includes(searchComparison.toLowerCase());
    const matchCount = r.purchase_count >= minCount;
    return matchSearch && matchCount;
  });

  const itemMinMax: Record<string, { min: number; max: number }> = {};
  filteredComparison.forEach((r) => {
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
  const trendTotalCount = trendRows.reduce((s, r) => s + r.purchase_count, 0);

  const trendChartData = trendMonths.map((month) => {
    const point: Record<string, any> = { month: fmtMonth(month) };
    trendVendors.forEach((vendor) => {
      const row = trendRows.find((r) => r.month === month && r.vendor === vendor);
      if (row) point[vendor || "unknown"] = row.avg_price;
    });
    return point;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: "Items tracked", value: summary.total_items_tracked.toString() },
          { label: "Price records", value: summary.total_price_records.toString() },
          { label: "Households", value: summary.total_households_contributing.toString() },
          { label: "Most tracked", value: summary.most_tracked_item ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-stone-900/60 border border-stone-800 rounded-xl p-3 sm:p-4">
            <p className="text-xs text-stone-500 mb-1">{label}</p>
            <p className="text-sm sm:text-base font-semibold text-stone-200 truncate">{value}</p>
          </div>
        ))}
      </div>

      <Section title="Price comparison">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by item..."
            value={searchComparison}
            onChange={(e) => setSearchComparison(e.target.value)}
            className="flex-1 bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-amber-400/60"
          />
          <div className="flex items-center gap-2">
            <span className="text-stone-500 text-xs shrink-0">Min purchases:</span>
            {([3, 5, 10] as const).map((n) => (
              <button
                key={n}
                onClick={() => setMinCount(n)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  minCount === n
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                    : "border-stone-800 text-stone-500 hover:text-stone-300"
                }`}
              >
                {n === 10 ? "10+" : n}
              </button>
            ))}
          </div>
        </div>

        {filteredComparison.length === 0 ? (
          <p className="text-stone-600 text-sm">No items match filters.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-stone-500 border-b border-stone-800">
                  <th className="pb-2 font-medium pr-4">Item</th>
                  <th className="pb-2 font-medium pr-4">Brand</th>
                  <th className="pb-2 font-medium pr-4">Variant</th>
                  <th className="pb-2 font-medium pr-4">Vendor</th>
                  <th className="pb-2 font-medium pr-4 text-right">Avg</th>
                  <th className="pb-2 font-medium pr-4 text-right">Min</th>
                  <th className="pb-2 font-medium pr-4 text-right">Max</th>
                  <th className="pb-2 font-medium text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800">
                {filteredComparison.map((r, idx) => {
                  const isFirst = r.canonical_name !== lastItemName;
                  if (isFirst) lastItemName = r.canonical_name;
                  const mm = itemMinMax[r.canonical_name];
                  const isCheapest = mm && r.avg_price === mm.min && mm.min !== mm.max;
                  const isMostExpensive = mm && r.avg_price === mm.max && mm.min !== mm.max;

                  return (
                    <tr key={idx} className={`${
                      isCheapest ? "bg-emerald-500/5" : isMostExpensive ? "bg-red-500/5" : ""
                    }`}>
                      <td className="py-2 pr-4">
                        {isFirst ? (
                          <span className="text-stone-200 font-medium">{r.canonical_name}</span>
                        ) : (
                          <span className="text-stone-600 text-xs pl-3">↳</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-stone-500">{r.brand ?? "—"}</td>
                      <td className="py-2 pr-4 text-stone-500">{r.variant ?? "—"}</td>
                      <td className="py-2 pr-4 text-stone-300">{r.vendor || "—"}</td>
                      <td className={`py-2 pr-4 text-right font-mono ${
                        isCheapest ? "text-emerald-400" : isMostExpensive ? "text-red-400" : "text-stone-200"
                      }`}>
                        {fmtPrice(r.avg_price)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-stone-400">{fmtPrice(r.min_price)}</td>
                      <td className="py-2 pr-4 text-right font-mono text-stone-400">{fmtPrice(r.max_price)}</td>
                      <td className="py-2 text-right text-stone-500">{r.purchase_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {cheapest_store_by_category.length > 0 && (
        <Section title="Cheapest store by category">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cheapest_store_by_category.map((row) => (
              <div key={row.category} className="bg-stone-900 border border-stone-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{CATEGORY_EMOJI[row.category] ?? "📦"}</span>
                  <span className="text-stone-300 text-sm font-medium capitalize">{row.category}</span>
                </div>
                <p className="text-amber-300 font-semibold text-sm">{row.vendor || "—"}</p>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-500">
                  {row.wins > 0 && <span>{row.wins} item win{row.wins !== 1 ? "s" : ""}</span>}
                  {row.avg_saving_vs_most_expensive > 0 && (
                    <span className="text-emerald-400/80">saves ~{fmtPrice(row.avg_saving_vs_most_expensive)} avg</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {trendItems.length > 0 && (
        <Section title="Price trends">
          <div className="flex flex-col sm:flex-row gap-3 mb-4 items-start sm:items-center">
            <select
              value={activeTrendItem}
              onChange={(e) => setSelectedItem(e.target.value)}
              className="bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:border-amber-400/60"
            >
              {trendItems.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            {activeTrendItem && (
              <span className="text-stone-500 text-xs">
                {trendTotalCount} purchase{trendTotalCount !== 1 ? "s" : ""} total
              </span>
            )}
          </div>

          {trendChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#292524" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#78716c", fontSize: 10 }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<DarkTooltip />} />
                {trendVendors.length > 1 && (
                  <Legend wrapperStyle={{ fontSize: 11, color: "#78716c", paddingTop: 8 }} />
                )}
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
            <p className="text-stone-600 text-sm">Not enough data for this item.</p>
          )}
        </Section>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [user, setUser] = useState<any>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteHousehold, setInviteHousehold] = useState("");
  const [inviteRole, setInviteRole] = useState("admin");
  const [sending, setSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "price-intelligence">("overview");
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      const meta = session.user.user_metadata;
      if (!meta?.is_super_admin) { router.push("/expenses"); return; }
      setUser(session.user);
    });
  }, [router]);

  const load = async () => {
    setLoading(true);
    const [h, i] = await Promise.all([
      api.get("/admin/households"),
      api.get("/admin/invites"),
    ]);
    setHouseholds(h.data);
    setInvites(i.data);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setSending(true);
    setInviteSent(false);
    try {
      await api.post("/admin/invite", {
        email: inviteEmail,
        household_id: inviteHousehold || null,
        role: inviteRole,
      });
      setInviteSent(true);
      setInviteEmail("");
      setInviteHousehold("");
      toast.success(`Invite sent to ${inviteEmail}`);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await api.patch(`/admin/households/${id}`, { active: !active });
    await load();
  };

  const handleDeleteInvite = async (id: string) => {
    await api.delete(`/admin/invites/${id}`);
    await load();
  };

  if (!user) return null;

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "price-intelligence", label: "Price Intelligence" },
  ] as const;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xs bg-amber-400/15 border border-amber-400/30 text-amber-300 px-2 py-0.5 rounded-full">
          Platform view
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-stone-800">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? "border-amber-400 text-amber-300"
                : "border-transparent text-stone-500 hover:text-stone-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <>
          {/* Invite */}
          <div className="border border-stone-800 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-medium text-stone-300 mb-4">Invite User</h2>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
              <input
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full sm:flex-1 sm:min-w-48 bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-amber-400/60"
              />
              <select
                value={inviteHousehold}
                onChange={(e) => setInviteHousehold(e.target.value)}
                className="w-full sm:w-auto bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm focus:outline-none focus:border-amber-400/60"
              >
                <option value="">New household</option>
                {households.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full sm:w-auto bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm focus:outline-none focus:border-amber-400/60"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
              <button
                onClick={handleInvite}
                disabled={sending || !inviteEmail}
                className="w-full sm:w-auto bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold px-5 py-2.5 rounded-xl transition text-sm"
              >
                {inviteSent ? "✓ Sent" : sending ? "Sending..." : "Send invite"}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-stone-600 text-sm">Loading...</p>
          ) : (
            <div className="grid lg:grid-cols-2 gap-6 items-start">
              {/* Households */}
              <div>
                <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-3">
                  Households ({households.length})
                </h2>
                <div className="space-y-2">
                  {households.map((h) => (
                    <div key={h.id} className="border border-stone-800 rounded-xl px-4 py-3.5 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-stone-200 font-medium text-sm">{h.name}</p>
                          {!h.active && (
                            <span className="text-xs bg-red-500/15 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded">inactive</span>
                          )}
                          <span className="text-xs bg-stone-800 text-stone-500 px-1.5 py-0.5 rounded">{h.plan}</span>
                        </div>
                        <p className="text-stone-600 text-xs mt-0.5">
                          {h.member_count} member{h.member_count !== 1 ? "s" : ""} · {h.receipt_count} receipts · joined {new Date(h.created_at).toLocaleDateString("en-SG")}
                        </p>
                      </div>
                      <button
                        onClick={() => handleToggleActive(h.id, h.active)}
                        className="text-xs border border-stone-700 hover:border-stone-600 text-stone-500 hover:text-stone-300 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {h.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  ))}
                  {households.length === 0 && <p className="text-stone-600 text-sm py-4">No households yet.</p>}
                </div>
              </div>

              {/* Invites */}
              <div>
                <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-3">
                  Invites ({invites.filter(i => !i.accepted).length} pending)
                </h2>
                <div className="space-y-2">
                  {invites.map((inv) => (
                    <div key={inv.id} className="border border-stone-800 rounded-xl px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-stone-300 text-sm">{inv.email}</p>
                        <p className="text-stone-600 text-xs mt-0.5">
                          {inv.role} · {inv.household_id ? "existing household" : "new household"} · {inv.accepted ? "✓ accepted" : `expires ${new Date(inv.expires_at).toLocaleDateString("en-SG")}`}
                        </p>
                      </div>
                      {!inv.accepted && (
                        <button
                          onClick={() => handleDeleteInvite(inv.id)}
                          className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                  {invites.length === 0 && <p className="text-stone-600 text-sm py-4">No invites sent yet.</p>}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "price-intelligence" && <PriceIntelligenceTab />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
