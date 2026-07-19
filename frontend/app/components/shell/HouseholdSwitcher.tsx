"use client";

import { useState } from "react";
import { useHousehold } from "@/lib/HouseholdContext";
import api from "@/lib/axios";

const CURRENCY_OPTIONS = ["SGD", "INR", "USD", "MYR", "AUD", "GBP", "EUR"];

export default function HouseholdSwitcher() {
  const { households, activeHousehold, switchHousehold, refreshHouseholds } = useHousehold();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("SGD");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!households.length) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post("/household", { name: name.trim(), default_currency: currency });
      await refreshHouseholds();
      switchHousehold(res.data.id);
    } catch {
      setError("Failed to create household");
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-stone-300 hover:text-stone-100 hover:bg-stone-800 border border-stone-700 hover:border-stone-600 transition-colors min-h-[36px]"
      >
        <span className="truncate max-w-[120px]">{activeHousehold?.name ?? "Household"}</span>
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setCreating(false); }} />
          <div className="absolute right-0 mt-2 w-64 rounded-lg border border-stone-700 bg-stone-900 shadow-xl z-30 py-1">
            {households.map((h) => (
              <button
                key={h.id}
                onClick={() => { setOpen(false); if (h.id !== activeHousehold?.id) switchHousehold(h.id); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-stone-800 min-h-[44px] ${
                  h.id === activeHousehold?.id ? "text-stone-100" : "text-stone-300"
                }`}
              >
                <span className="truncate">{h.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-stone-500 shrink-0 ml-2">
                  {h.role} · {h.default_currency}
                </span>
              </button>
            ))}

            <div className="border-t border-stone-800 mt-1 pt-1">
              {!creating ? (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full text-left px-3 py-2 text-sm text-stone-400 hover:text-stone-100 hover:bg-stone-800 min-h-[44px]"
                >
                  + Add household
                </button>
              ) : (
                <div className="px-3 py-2 space-y-2">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. My Parents"
                    className="w-full text-base bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-stone-200 placeholder:text-stone-600"
                  />
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full text-base bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-stone-200"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleCreate}
                    disabled={saving || !name.trim()}
                    className="w-full px-2 py-1.5 rounded bg-emerald-600 text-white text-sm font-medium disabled:opacity-50 min-h-[36px]"
                  >
                    {saving ? "Creating..." : "Create"}
                  </button>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
