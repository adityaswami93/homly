"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

const CATEGORY_EMOJI: Record<string, string> = {
  "groceries":       "🛒",
  "household":       "🏠",
  "personal care":   "🧴",
  "food & beverage": "🍜",
  "transport":       "🚌",
  "other":           "📦",
};

function fmt(n: number | null) {
  if (n == null) return "—";
  return `SGD ${Number(n).toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", {
    day: "numeric", month: "short",
  });
}

interface Suggestion {
  canonical_name: string;
  brand:          string | null;
  variant:        string | null;
  category:       string | null;
  last_bought:    string;
  avg_interval:   number;
  days_since:     number;
  days_until:     number;
  urgency:        "overdue" | "due_soon";
  buy_count:      number;
}

interface ShoppingItem {
  canonical_name: string;
  brand:          string | null;
  variant:        string | null;
  category:       string | null;
  added_by:       string;
  checked:        boolean;
}

interface PriceAlert {
  canonical_name: string;
  brand:          string | null;
  variant:        string | null;
  paid_price:     number;
  avg_price:      number;
  pct_above:      number;
  vendor:         string;
  bought_at:      string;
}

function UrgencyBadge({ urgency, daysUntil }: { urgency: string; daysUntil: number }) {
  if (urgency === "overdue") {
    return (
      <span className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
        Overdue {Math.abs(daysUntil)}d
      </span>
    );
  }
  return (
    <span className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
      Due in {daysUntil}d
    </span>
  );
}

function Section({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-stone-900/40 border border-stone-800 rounded-2xl p-5">
      <div className="mb-4">
        <h2 className="text-stone-300 text-sm font-medium">{title}</h2>
        {subtitle && <p className="text-stone-600 text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default function InsightsPage() {
  const [user,         setUser]         = useState<any>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [suggestions,  setSuggestions]  = useState<Suggestion[]>([]);
  const [alerts,       setAlerts]       = useState<PriceAlert[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [newItem,      setNewItem]      = useState("");
  const [adding,       setAdding]       = useState(false);
  const [activeTab,    setActiveTab]    = useState<"shopping"|"alerts">("shopping");
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
      const [listRes, alertRes] = await Promise.all([
        api.get("/insights/shopping-list"),
        api.get("/insights/price-alerts"),
      ]);
      setShoppingList(listRes.data.items       || []);
      setSuggestions( listRes.data.suggestions || []);
      setAlerts(      alertRes.data            || []);
    } catch {
      toast.error("Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const handleAddItem = async () => {
    if (!newItem.trim()) return;
    setAdding(true);
    try {
      await api.post("/insights/shopping-list", {
        canonical_name: newItem.trim(),
        added_by:       "manual",
      });
      toast.success("Added to shopping list");
      setNewItem("");
      await load();
    } catch {
      toast.error("Failed to add item");
    } finally {
      setAdding(false);
    }
  };

  const handleCheck = async (name: string, checked: boolean) => {
    try {
      await api.patch(`/insights/shopping-list/${encodeURIComponent(name)}`, { checked });
      await load();
    } catch {
      toast.error("Failed to update item");
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.delete(`/insights/shopping-list/${encodeURIComponent(name)}`);
      toast.success("Removed from list");
      await load();
    } catch {
      toast.error("Failed to remove item");
    }
  };

  const handleAddSuggestion = async (s: Suggestion) => {
    try {
      await api.post("/insights/shopping-list", {
        canonical_name: s.canonical_name,
        brand:          s.brand,
        variant:        s.variant,
        category:       s.category,
        added_by:       "manual",
      });
      toast.success(`${s.canonical_name} added to list`);
      await load();
    } catch {
      toast.error("Failed to add item");
    }
  };

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-10 py-8 pb-24 sm:pb-8">

        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Insights</h1>
          <p className="text-stone-500 text-sm">Shopping list and price intelligence.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-stone-900/60 border border-stone-800 rounded-xl p-1 mb-6 max-w-sm">
          {[
            { key: "shopping", label: `Shopping list` },
            { key: "alerts",   label: `Price alerts (${alerts.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as "shopping" | "alerts")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-stone-800 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Shopping list tab */}
            {activeTab === "shopping" && (
              <div className="grid lg:grid-cols-2 gap-5">

                {/* Manual list */}
                <Section
                  title="Your list"
                  subtitle='Type "shopping list" in WhatsApp to see this'
                >
                  {/* Add item */}
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="Add item e.g. Milo, cooking oil"
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                      className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-amber-400/60"
                    />
                    <button
                      onClick={handleAddItem}
                      disabled={adding || !newItem.trim()}
                      className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold px-4 py-2 rounded-xl transition text-sm"
                    >
                      Add
                    </button>
                  </div>

                  {shoppingList.length === 0 ? (
                    <p className="text-stone-600 text-sm py-4 text-center">
                      Your list is empty. Add items above or they&apos;ll appear automatically when running low.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {shoppingList.map((item) => (
                        <div
                          key={item.canonical_name}
                          className="flex items-center gap-3 py-2.5 border-b border-stone-800/40 last:border-0"
                        >
                          <button
                            onClick={() => handleCheck(item.canonical_name, !item.checked)}
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                              item.checked
                                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                : "border-stone-600 hover:border-stone-400"
                            }`}
                          >
                            {item.checked && <span className="text-xs">✓</span>}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${item.checked ? "line-through text-stone-600" : "text-stone-200"}`}>
                              {item.canonical_name}
                              {item.variant && (
                                <span className="text-stone-500 ml-1 text-xs">({item.variant})</span>
                              )}
                            </p>
                            {item.category && (
                              <p className="text-stone-600 text-xs mt-0.5">
                                {CATEGORY_EMOJI[item.category]} {item.category}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {item.added_by === "auto" && (
                              <span className="text-xs text-stone-600">auto</span>
                            )}
                            <button
                              onClick={() => handleDelete(item.canonical_name)}
                              className="text-stone-700 hover:text-red-400 transition-colors text-sm"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* Suggestions */}
                <Section
                  title="Running low"
                  subtitle="Based on your purchase history"
                >
                  {suggestions.length === 0 ? (
                    <p className="text-stone-600 text-sm py-4 text-center">
                      No suggestions yet — need more purchase history.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {suggestions.map((s) => {
                        const alreadyAdded = shoppingList.some(
                          i => i.canonical_name === s.canonical_name
                        );
                        return (
                          <div
                            key={s.canonical_name}
                            className="flex items-center justify-between py-2.5 border-b border-stone-800/40 last:border-0"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-stone-200 text-sm">
                                  {s.canonical_name}
                                  {s.variant && (
                                    <span className="text-stone-500 ml-1 text-xs">({s.variant})</span>
                                  )}
                                </p>
                                <UrgencyBadge urgency={s.urgency} daysUntil={s.days_until} />
                              </div>
                              <p className="text-stone-600 text-xs mt-0.5">
                                Last bought {fmtDate(s.last_bought)} · every ~{s.avg_interval}d
                              </p>
                            </div>
                            <button
                              onClick={() => handleAddSuggestion(s)}
                              disabled={alreadyAdded}
                              className="ml-3 text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                            >
                              {alreadyAdded ? "Added" : "+ Add"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Section>
              </div>
            )}

            {/* Price alerts tab */}
            {activeTab === "alerts" && (
              <div className="space-y-3 max-w-2xl">
                {alerts.length === 0 ? (
                  <div className="border border-stone-800 rounded-2xl p-12 text-center">
                    <p className="text-stone-400 font-medium mb-2">No price alerts</p>
                    <p className="text-stone-600 text-sm">
                      We&apos;ll alert you when you pay more than 15% above your average for an item.
                      Need at least 3 purchases per item to detect patterns.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-stone-500 text-xs mb-4">
                      Items purchased in the last 30 days at above-average prices.
                    </p>
                    {alerts.map((alert) => (
                      <div
                        key={alert.canonical_name}
                        className="border border-red-500/20 bg-red-500/5 rounded-xl px-4 py-3.5 flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-stone-200 text-sm font-medium">
                              {alert.canonical_name}
                              {alert.variant && (
                                <span className="text-stone-500 ml-1 text-xs">({alert.variant})</span>
                              )}
                            </p>
                            <span className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                              +{alert.pct_above}% above avg
                            </span>
                          </div>
                          <p className="text-stone-600 text-xs mt-0.5">
                            Paid {fmt(alert.paid_price)} at {alert.vendor} on {fmtDate(alert.bought_at)}
                            {" · "}avg {fmt(alert.avg_price)}
                          </p>
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <p className="text-red-300 font-mono text-sm">
                            {fmt(alert.paid_price)}
                          </p>
                          <p className="text-stone-600 text-xs font-mono">
                            avg {fmt(alert.avg_price)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
