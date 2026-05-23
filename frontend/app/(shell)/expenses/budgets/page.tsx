"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

const CATEGORIES = [
  "groceries", "household", "personal care",
  "food & beverage", "transport", "other",
];

const CATEGORY_EMOJI: Record<string, string> = {
  groceries: "🛒", household: "🏠", "personal care": "🧴",
  "food & beverage": "🍜", transport: "🚌", other: "📦",
};

const CATEGORY_COLOR: Record<string, string> = {
  groceries: "#10b981",
  household: "#3b82f6",
  "personal care": "#a855f7",
  "food & beverage": "#f97316",
  transport: "#06b6d4",
  other: "#9ca3af",
};

interface Budget {
  id: string;
  month: string;
  category: string | null;
  amount: number;
}

interface CategoryActual {
  [cat: string]: number;
}

function toYYYYMM(d: Date) {
  return d.toISOString().slice(0, 7);
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-SG", {
    month: "long", year: "numeric",
  });
}

function fmt(n: number) {
  return `SGD ${Number(n).toFixed(2)}`;
}

function BudgetBar({
  label,
  actual,
  budget,
  color,
  emoji,
}: {
  label: string;
  actual: number;
  budget: number;
  color: string;
  emoji?: string;
}) {
  const pct = budget > 0 ? Math.min(100, Math.round((actual / budget) * 100)) : 0;
  const over = actual > budget;
  const barColor = over ? "#ef4444" : color;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-stone-300 text-sm">
          {emoji && `${emoji} `}{label}
        </span>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono ${over ? "text-red-400" : "text-stone-400"}`}>
            {fmt(actual)}
            <span className="text-stone-600"> / {fmt(budget)}</span>
          </span>
          <span className={`text-xs w-8 text-right ${over ? "text-red-400" : "text-stone-500"}`}>
            {pct}%
          </span>
        </div>
      </div>
      <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
        <div
          className="h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      {over && (
        <p className="text-red-400 text-xs mt-1">
          Over by {fmt(actual - budget)}
        </p>
      )}
    </div>
  );
}

export default function BudgetsPage() {
  const [user, setUser] = useState<any>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [actuals, setActuals] = useState<CategoryActual>({});
  const [totalActual, setTotalActual] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(toYYYYMM(new Date()));
  const [editModal, setEditModal] = useState<{
    category: string | null;
    current?: number;
  } | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [saving, setSaving] = useState(false);
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
      const [budgetsRes, analyticsRes] = await Promise.all([
        api.get("/budgets", { params: { month: selectedMonth } }),
        api.get("/analytics", {
          params: {
            date_from: `${selectedMonth}-01`,
            date_to: (() => {
              const [y, m] = selectedMonth.split("-").map(Number);
              const lastDay = new Date(y, m, 0).getDate();
              return `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
            })(),
          },
        }),
      ]);

      setBudgets(budgetsRes.data.budgets || []);
      const cats: CategoryActual = analyticsRes.data.category_totals || {};
      setActuals(cats);
      setTotalActual(analyticsRes.data.summary?.total ?? 0);
    } catch {
      toast.error("Failed to load budgets");
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const getBudget = (category: string | null) =>
    budgets.find((b) => b.category === category);

  const handleSave = async () => {
    const amount = parseFloat(amountInput);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    try {
      await api.post("/budgets", {
        month: selectedMonth,
        category: editModal?.category ?? null,
        amount,
      });
      toast.success("Budget saved");
      setEditModal(null);
      setAmountInput("");
      await load();
    } catch {
      toast.error("Failed to save budget");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/budgets/${id}`);
      toast.success("Budget removed");
      await load();
    } catch {
      toast.error("Failed to remove budget");
    }
  };

  const openEdit = (category: string | null) => {
    const existing = getBudget(category);
    setEditModal({ category, current: existing?.amount });
    setAmountInput(existing ? String(existing.amount) : "");
  };

  // Month selector: current month + 5 past months
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return toYYYYMM(d);
  });

  const overallBudget = getBudget(null);
  const hasBudgets = budgets.length > 0;

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Month selector */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
        {monthOptions.map((m) => (
          <button
            key={m}
            onClick={() => setSelectedMonth(m)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors min-h-[36px] ${
              selectedMonth === m
                ? "border-emerald-800 bg-emerald-900/30 text-emerald-400"
                : "border-stone-700 text-stone-400 hover:border-stone-600"
            }`}
          >
            {fmtMonth(m)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-stone-500 text-sm py-12 text-center">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* Overall budget card */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-stone-500 text-xs uppercase tracking-widest">Overall budget</h2>
              <button
                onClick={() => openEdit(null)}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                {overallBudget ? "Edit" : "+ Set budget"}
              </button>
            </div>

            {overallBudget ? (
              <div>
                <BudgetBar
                  label="Total spend"
                  actual={totalActual}
                  budget={overallBudget.amount}
                  color="#10b981"
                />
                <div className="mt-3 flex items-center justify-between text-xs text-stone-600">
                  <span>{fmt(Math.max(0, overallBudget.amount - totalActual))} remaining</span>
                  <button
                    onClick={() => handleDelete(overallBudget.id)}
                    className="text-red-500/50 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-stone-600 text-sm">
                No overall budget set for {fmtMonth(selectedMonth)}.{" "}
                <button
                  onClick={() => openEdit(null)}
                  className="text-emerald-500 hover:text-emerald-400 underline"
                >
                  Set one
                </button>
              </p>
            )}
          </div>

          {/* Category budgets */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
            <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">By category</h2>
            <div className="space-y-5">
              {CATEGORIES.map((cat) => {
                const budget = getBudget(cat);
                const actual = actuals[cat] ?? 0;
                const emoji = CATEGORY_EMOJI[cat];
                const color = CATEGORY_COLOR[cat] ?? "#9ca3af";

                return (
                  <div key={cat}>
                    {budget ? (
                      <div>
                        <BudgetBar
                          label={cat.charAt(0).toUpperCase() + cat.slice(1)}
                          actual={actual}
                          budget={budget.amount}
                          color={color}
                          emoji={emoji}
                        />
                        <div className="mt-1.5 flex items-center justify-between text-xs text-stone-600">
                          <span>{fmt(Math.max(0, budget.amount - actual))} remaining</span>
                          <div className="flex gap-3">
                            <button
                              onClick={() => openEdit(cat)}
                              className="text-stone-500 hover:text-stone-300 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(budget.id)}
                              className="text-red-500/50 hover:text-red-400 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500 text-sm">
                          {emoji} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                          {actual > 0 && (
                            <span className="text-stone-600 ml-2 font-mono text-xs">{fmt(actual)} spent</span>
                          )}
                        </span>
                        <button
                          onClick={() => openEdit(cat)}
                          className="text-xs text-stone-600 hover:text-emerald-400 transition-colors"
                        >
                          + Set limit
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {!hasBudgets && (
            <p className="text-stone-600 text-xs text-center">
              Set budgets above to track spending against your limits.
            </p>
          )}
        </div>
      )}

      {/* Edit modal */}
      {editModal !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-stone-100 font-semibold mb-1">
              {editModal.category
                ? `Budget for ${editModal.category}`
                : "Overall monthly budget"}
            </h3>
            <p className="text-stone-500 text-sm mb-4">{fmtMonth(selectedMonth)}</p>
            <div className="flex gap-2 mb-4">
              <span className="flex items-center px-3 bg-stone-800 border border-stone-700 rounded-xl text-stone-400 text-sm">
                SGD
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                autoFocus
                className="flex-1 bg-stone-800 border border-stone-700 rounded-xl px-3 py-2.5 text-stone-100 text-base placeholder:text-stone-600 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setEditModal(null); setAmountInput(""); }}
                className="flex-1 py-2.5 rounded-xl border border-stone-700 text-stone-400 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !amountInput}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
