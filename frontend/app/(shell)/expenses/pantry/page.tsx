"use client";

import { useState, useEffect, useMemo } from "react";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface PantryItem {
  id: string;
  canonical_name: string;
  category: string | null;
  status: "in_stock" | "low" | "out_of_stock";
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  added_by: string | null;
  last_updated: string;
}

const CATEGORY_EMOJI: Record<string, string> = {
  protein: "🥩",
  produce: "🥦",
  dairy: "🥛",
  staples: "🌾",
  condiments: "🫙",
  groceries: "🛒",
  household: "🧹",
  other: "📦",
};

const STATUS_BADGE: Record<string, string> = {
  in_stock: "bg-emerald-900/40 text-emerald-400",
  low: "bg-amber-900/40 text-amber-400",
  out_of_stock: "bg-red-900/40 text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In Stock",
  low: "Low",
  out_of_stock: "Out",
};

const CATEGORIES = ["protein", "produce", "dairy", "staples", "condiments", "other"];

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function PantryPage() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "low" | "out_of_stock">("all");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [addStatus, setAddStatus] = useState<"in_stock" | "low" | "out_of_stock">("in_stock");
  const [adding, setAdding] = useState(false);
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems() {
    try {
      const res = await api.get("/pantry");
      setItems(res.data);
    } catch {
      toast.error("Failed to load pantry");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let list = items;
    if (tab !== "all") list = list.filter((i) => i.status === tab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.canonical_name.includes(q));
    }
    return list;
  }, [items, tab, search]);

  async function updateStatus(item: PantryItem, status: "in_stock" | "low" | "out_of_stock") {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
    try {
      await api.patch(`/pantry/${encodeURIComponent(item.canonical_name)}`, { status });
    } catch {
      toast.error("Failed to update status");
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)));
    }
  }

  async function deleteItem(item: PantryItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await api.delete(`/pantry/${encodeURIComponent(item.canonical_name)}`);
      toast.success(`Removed ${item.canonical_name}`);
    } catch {
      toast.error("Failed to delete item");
      setItems((prev) => [...prev, item].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)));
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = addName.trim().toLowerCase();
    if (!name) return;
    setAdding(true);
    try {
      const res = await api.post("/pantry", {
        canonical_name: name,
        category: addCategory || null,
        status: addStatus,
      });
      setItems((prev) => [res.data, ...prev]);
      setAddName("");
      setAddCategory("");
      setAddStatus("in_stock");
      setShowAddForm(false);
      toast.success(`Added ${name}`);
    } catch {
      toast.error("Failed to add item");
    } finally {
      setAdding(false);
    }
  }

  const tabs: { key: "all" | "low" | "out_of_stock"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "low", label: "Running Low" },
    { key: "out_of_stock", label: "Out of Stock" },
  ];

  return (
    <div className="min-h-screen bg-[#0f0e0c] text-stone-100 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-100">Pantry</h1>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="text-sm px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          + Add item
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="mb-6 bg-stone-900 border border-stone-800 rounded-xl p-4 flex flex-col gap-3"
        >
          <input
            className="bg-stone-800 border border-stone-700 text-stone-200 placeholder:text-stone-600 rounded-lg px-3 py-2 text-base focus:outline-none focus:border-emerald-600"
            placeholder="Item name (e.g. jasmine rice)"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <select
              className="flex-1 bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
            >
              <option value="">Category (optional)</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_EMOJI[c]} {c}
                </option>
              ))}
            </select>
            <select
              className="flex-1 bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
              value={addStatus}
              onChange={(e) => setAddStatus(e.target.value as typeof addStatus)}
            >
              <option value="in_stock">In Stock</option>
              <option value="low">Running Low</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={adding || !addName.trim()}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      <input
        className="w-full mb-4 bg-stone-800 border border-stone-700 text-stone-200 placeholder:text-stone-600 rounded-lg px-3 py-2 text-base focus:outline-none focus:border-emerald-600"
        placeholder="Search pantry…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-emerald-600 text-white"
                : "bg-stone-800 text-stone-400 hover:bg-stone-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading pantry…</div>
      ) : filtered.length === 0 && items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-stone-400 text-sm mb-2">Your pantry is empty.</p>
          <p className="text-stone-600 text-xs max-w-xs mx-auto">
            Add items here or text the WhatsApp bot — e.g. "added rice", "used up eggs", "running low on oil".
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-stone-500 text-sm py-12 text-center">No items match your filter.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 flex items-center gap-3"
            >
              {/* Category emoji */}
              <span className="text-xl flex-shrink-0">
                {CATEGORY_EMOJI[item.category || "other"] || "📦"}
              </span>

              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                <p className="text-stone-100 text-sm font-medium capitalize truncate flex items-center gap-1.5">
                  {item.canonical_name}
                  {item.added_by === "receipt" && (
                    <span title="Added from receipt" className="text-xs">🧾</span>
                  )}
                  {item.added_by === "recipe" && (
                    <span title="Added from recipe" className="text-xs">🍽️</span>
                  )}
                </p>
                <p className="text-stone-500 text-xs mt-0.5">
                  {item.category || "uncategorised"} · {relativeDate(item.last_updated)}
                </p>
              </div>

              {/* Status badge */}
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_BADGE[item.status]}`}
              >
                {STATUS_LABEL[item.status]}
              </span>

              {/* Quick-action buttons */}
              <div className="flex gap-1 flex-shrink-0">
                {(["in_stock", "low", "out_of_stock"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(item, s)}
                    title={STATUS_LABEL[s]}
                    className={`min-h-[36px] px-2 text-xs rounded-lg transition-colors ${
                      item.status === s
                        ? s === "in_stock"
                          ? "bg-emerald-600 text-white"
                          : s === "low"
                          ? "bg-amber-600 text-white"
                          : "bg-red-700 text-white"
                        : "bg-stone-800 text-stone-400 hover:bg-stone-700"
                    }`}
                  >
                    {s === "in_stock" ? "✓" : s === "low" ? "~" : "✗"}
                  </button>
                ))}
              </div>

              {/* Delete */}
              <button
                onClick={() => deleteItem(item)}
                className="min-h-[36px] px-2 text-stone-600 hover:text-red-400 transition-colors flex-shrink-0"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
