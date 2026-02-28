"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";

interface Item {
  id: string;
  name: string;
  qty: number;
  unit_price: number | null;
  line_total: number | null;
  category: string;
}

interface Receipt {
  id: string;
  vendor: string | null;
  date: string | null;
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  confidence: "high" | "medium" | "low";
  flagged: boolean;
  notes: string | null;
  currency: string;
  items?: Item[];
}

interface WeekData {
  year: number;
  week_number: number;
  total: number;
  receipt_count: number;
  flagged_count: number;
  receipts: Receipt[];
  category_totals: Record<string, number>;
}

const CATEGORY_EMOJI: Record<string, string> = {
  "groceries": "🛒", "household": "🏠", "personal care": "🧴",
  "food & beverage": "🍜", "transport": "🚌", "other": "📦",
};

const CATEGORY_COLOR: Record<string, string> = {
  "groceries":      "bg-emerald-500/20 text-emerald-300",
  "household":      "bg-blue-500/20 text-blue-300",
  "personal care":  "bg-purple-500/20 text-purple-300",
  "food & beverage":"bg-orange-500/20 text-orange-300",
  "transport":      "bg-cyan-500/20 text-cyan-300",
  "other":          "bg-stone-600/30 text-stone-400",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "text-emerald-400", medium: "text-amber-400", low: "text-red-400",
};

function fmt(amount: number | null, currency = "SGD") {
  if (amount == null) return "—";
  return `${currency} ${Number(amount).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleDateString("en-SG", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function ReceiptDrawer({
  receipt, onClose, onToggleFlag,
}: {
  receipt: Receipt;
  onClose: () => void;
  onToggleFlag: (id: string, flagged: boolean) => void;
}) {
  const [items,    setItems]    = useState<Item[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get(`/receipts/${receipt.id}`).then((res) => {
      setItems(res.data.items || []);
      setLoading(false);
    });
  }, [receipt.id]);

  const handleFlag = async () => {
    setToggling(true);
    await api.patch(`/receipts/${receipt.id}/flag`, { flagged: !receipt.flagged });
    onToggleFlag(receipt.id, !receipt.flagged);
    setToggling(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-[#1a1814] border-l border-stone-800 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-stone-800 flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-stone-100 text-lg">
              {receipt.vendor || "Unknown vendor"}
            </h2>
            <p className="text-stone-500 text-sm mt-0.5">{fmtDate(receipt.date)}</p>
          </div>
          <button onClick={onClose} className="text-stone-600 hover:text-stone-300 text-xl transition-colors">×</button>
        </div>

        <div className="p-5 border-b border-stone-800 flex items-center justify-between">
          <div>
            <p className="text-3xl font-semibold text-stone-100 font-mono">
              {fmt(receipt.total, receipt.currency)}
            </p>
            {receipt.tax != null && receipt.tax > 0 && (
              <p className="text-stone-500 text-xs mt-1">
                Subtotal {fmt(receipt.subtotal)} + GST {fmt(receipt.tax)}
              </p>
            )}
          </div>
          <div className="text-right">
            <span className={`text-xs font-medium ${CONFIDENCE_STYLE[receipt.confidence] || "text-stone-400"}`}>
              {receipt.confidence} confidence
            </span>
            {receipt.notes && (
              <p className="text-stone-500 text-xs mt-1 max-w-[140px] text-right">{receipt.notes}</p>
            )}
          </div>
        </div>

        <div className="p-5">
          <h3 className="text-stone-500 text-xs uppercase tracking-widest mb-3">Line Items</h3>
          {loading ? (
            <p className="text-stone-600 text-sm">Loading items...</p>
          ) : items.length === 0 ? (
            <p className="text-stone-600 text-sm italic">No items extracted</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-stone-800/60">
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-200 text-sm truncate">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLOR[item.category] || CATEGORY_COLOR["other"]}`}>
                        {CATEGORY_EMOJI[item.category]} {item.category}
                      </span>
                      {item.qty !== 1 && (
                        <span className="text-stone-600 text-xs">×{item.qty}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-stone-300 text-sm font-mono ml-4 shrink-0">
                    {fmt(item.line_total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-stone-800">
          <button
            onClick={handleFlag}
            disabled={toggling}
            className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors border ${
              receipt.flagged
                ? "border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600"
                : "border-amber-500/40 text-amber-400 hover:bg-amber-400/5"
            }`}
          >
            {toggling ? "..." : receipt.flagged ? "✓ Mark as reviewed" : "⚠ Flag for review"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent, warn }: {
  label: string; value: string; accent?: boolean; warn?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${
      accent ? "bg-amber-400/8 border-amber-400/20"
      : warn  ? "bg-red-500/6 border-red-500/20"
      :         "bg-stone-900/60 border-stone-800"
    }`}>
      <p className={`text-xs mb-1 ${accent ? "text-amber-400/70" : warn ? "text-red-400/70" : "text-stone-500"}`}>
        {label}
      </p>
      <p className={`text-lg font-semibold font-mono tracking-tight ${
        accent ? "text-amber-300" : warn ? "text-red-300" : "text-stone-200"
      }`}>
        {value}
      </p>
    </div>
  );
}

function EmptyWeek() {
  return (
    <div className="border border-stone-800 rounded-xl p-12 text-center">
      <div className="w-12 h-12 rounded-full bg-stone-900 border border-stone-800 flex items-center justify-center mx-auto mb-4">
        <span className="text-xl">🧾</span>
      </div>
      <h3 className="text-stone-400 font-medium mb-2">No receipts this week</h3>
      <p className="text-stone-600 text-sm">
        Send receipt photos to the WhatsApp group and they will appear here automatically.
      </p>
    </div>
  );
}

export default function Dashboard() {
  const [user,             setUser]            = useState<any>(null);
  const [week,             setWeek]            = useState<WeekData | null>(null);
  const [loading,          setLoading]         = useState(true);
  const [selectedReceipt,  setSelectedReceipt] = useState<Receipt | null>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/this-week");
      setWeek(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadWeek();
  }, [user, loadWeek]);

  const handleToggleFlag = (id: string, flagged: boolean) => {
    if (!week) return;
    setWeek((prev) => prev ? {
      ...prev,
      flagged_count: flagged ? prev.flagged_count + 1 : Math.max(0, prev.flagged_count - 1),
      receipts: prev.receipts.map((r) => r.id === id ? { ...r, flagged } : r),
    } : prev);
    if (selectedReceipt?.id === id) {
      setSelectedReceipt((prev) => prev ? { ...prev, flagged } : prev);
    }
  };

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">This Week</h1>
            {week && (
              <p className="text-stone-500 text-sm mt-0.5">Week {week.week_number}, {week.year}</p>
            )}
          </div>
          <button
            onClick={loadWeek}
            className="text-xs text-stone-600 hover:text-stone-400 border border-stone-800 hover:border-stone-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-stone-600 text-sm py-12">Loading...</p>
        ) : !week || week.receipt_count === 0 ? (
          <EmptyWeek />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <SummaryCard label="Total to pay"  value={fmt(week.total)} accent />
              <SummaryCard label="Receipts"      value={String(week.receipt_count)} />
              <SummaryCard label="Need review"   value={String(week.flagged_count)} warn={week.flagged_count > 0} />
            </div>

            {Object.keys(week.category_totals).length > 0 && (
              <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-4 mb-6">
                <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">By Category</h2>
                <div className="space-y-3">
                  {Object.entries(week.category_totals)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amount]) => {
                      const pct = week.total > 0 ? Math.round((amount / week.total) * 100) : 0;
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-stone-300 text-sm">
                              {CATEGORY_EMOJI[cat]} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className="text-stone-500 text-xs">{pct}%</span>
                              <span className="text-stone-200 text-sm font-mono">{fmt(amount)}</span>
                            </div>
                          </div>
                          <div className="h-1 bg-stone-800 rounded-full">
                            <div className="h-1 bg-amber-400/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div>
              <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-3">Receipts</h2>
              <div className="space-y-2">
                {week.receipts.map((receipt) => (
                  <button
                    key={receipt.id}
                    onClick={() => setSelectedReceipt(receipt)}
                    className="w-full bg-stone-900/40 border border-stone-800 hover:border-stone-700 rounded-xl px-4 py-3.5 flex items-center justify-between transition-colors group text-left"
                  >
                    <div className="flex items-center gap-3">
                      {receipt.flagged && <span className="text-amber-400 text-sm">⚠</span>}
                      <div>
                        <p className="text-stone-200 font-medium text-sm group-hover:text-stone-100 transition-colors">
                          {receipt.vendor || "Unknown vendor"}
                        </p>
                        <p className="text-stone-600 text-xs mt-0.5">{fmtDate(receipt.date)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs ${CONFIDENCE_STYLE[receipt.confidence] || "text-stone-500"}`}>
                        {receipt.confidence}
                      </span>
                      <span className="text-stone-200 font-mono text-sm">{fmt(receipt.total, receipt.currency)}</span>
                      <span className="text-stone-700 group-hover:text-stone-500 transition-colors">→</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {selectedReceipt && (
        <ReceiptDrawer
          receipt={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
          onToggleFlag={handleToggleFlag}
        />
      )}
    </main>
  );
}
