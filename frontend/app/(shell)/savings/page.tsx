"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";
import { useHousehold } from "@/lib/HouseholdContext";

interface Account {
  id: string;
  account_type: string;
  scheme_name: string | null;
  institution: string | null;
  account_name: string;
  current_balance: number;
  currency: string;
  interest_rate: number | null;
  maturity_date: string | null;
  notes: string | null;
}

const ACCOUNT_TYPES = [
  { value: "bank_savings", label: "Bank Savings" },
  { value: "fixed_deposit", label: "Fixed Deposit" },
  { value: "retirement_fund", label: "Retirement Fund" },
  { value: "stocks", label: "Stocks" },
  { value: "mutual_fund", label: "Mutual Fund" },
  { value: "bonds", label: "Bonds" },
  { value: "property", label: "Property" },
  { value: "other", label: "Other" },
];

const TYPE_EMOJI: Record<string, string> = {
  bank_savings: "🏦",
  fixed_deposit: "🔒",
  retirement_fund: "🧓",
  stocks: "📈",
  mutual_fund: "📊",
  bonds: "📜",
  property: "🏠",
  other: "💼",
};

const SCHEME_PLACEHOLDER: Record<string, string> = {
  retirement_fund: "e.g. CPF, SRS, EPF, PPF, NPS",
  mutual_fund: "e.g. fund/scheme name",
};

const EMPTY_FORM = {
  account_type: "bank_savings",
  scheme_name: "",
  institution: "",
  account_name: "",
  current_balance: "",
  currency: "",
  interest_rate: "",
  maturity_date: "",
  notes: "",
};

function AccountModal({
  account,
  defaultCurrency,
  onClose,
  onSave,
}: {
  account?: Account;
  defaultCurrency: string;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [form, setForm] = useState(
    account
      ? {
          account_type: account.account_type,
          scheme_name: account.scheme_name ?? "",
          institution: account.institution ?? "",
          account_name: account.account_name,
          current_balance: account.current_balance?.toString() ?? "",
          currency: account.currency ?? defaultCurrency,
          interest_rate: account.interest_rate?.toString() ?? "",
          maturity_date: account.maturity_date?.slice(0, 10) ?? "",
          notes: account.notes ?? "",
        }
      : { ...EMPTY_FORM, currency: defaultCurrency }
  );
  const [saving, setSaving] = useState(false);

  const update = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        current_balance: form.current_balance ? parseFloat(form.current_balance) : 0,
        interest_rate: form.interest_rate ? parseFloat(form.interest_rate) : null,
        scheme_name: form.scheme_name || null,
        institution: form.institution || null,
        maturity_date: form.maturity_date || null,
        notes: form.notes || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base";

  const showScheme = form.account_type === "retirement_fund" || form.account_type === "mutual_fund";
  const showMaturity = form.account_type === "fixed_deposit";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between sticky top-0 bg-stone-900 z-10">
          <h2 className="text-base font-semibold text-stone-100">
            {account ? "Edit Account" : "Add Account"}
          </h2>
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-stone-200 w-8 h-8 flex items-center justify-center text-xl"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs text-stone-500 block mb-1.5">Account Name *</label>
              <input
                type="text"
                value={form.account_name}
                onChange={(e) => update("account_name", e.target.value)}
                required
                placeholder="e.g. DBS Multiplier, CPF Ordinary Account"
                className={inputCls}
              />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Account Type *</label>
              <select
                value={form.account_type}
                onChange={(e) => update("account_type", e.target.value)}
                className={inputCls}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {TYPE_EMOJI[t.value]} {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Institution</label>
              <input
                type="text"
                value={form.institution}
                onChange={(e) => update("institution", e.target.value)}
                placeholder="e.g. DBS, HDFC Bank, CPF Board"
                className={inputCls}
              />
            </div>

            {showScheme && (
              <div className="sm:col-span-2">
                <label className="text-xs text-stone-500 block mb-1.5">Scheme Name</label>
                <input
                  type="text"
                  value={form.scheme_name}
                  onChange={(e) => update("scheme_name", e.target.value)}
                  placeholder={SCHEME_PLACEHOLDER[form.account_type] ?? ""}
                  className={inputCls}
                />
              </div>
            )}

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Current Balance *</label>
              <input
                type="number"
                value={form.current_balance}
                onChange={(e) => update("current_balance", e.target.value)}
                required
                placeholder="10000"
                min="0"
                step="any"
                className={inputCls}
              />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={(e) => update("currency", e.target.value.toUpperCase())}
                placeholder={defaultCurrency}
                maxLength={3}
                className={inputCls}
              />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Interest Rate (%)</label>
              <input
                type="number"
                value={form.interest_rate}
                onChange={(e) => update("interest_rate", e.target.value)}
                placeholder="3.5"
                min="0"
                step="any"
                className={inputCls}
              />
            </div>

            {showMaturity && (
              <div>
                <label className="text-xs text-stone-500 block mb-1.5">Maturity Date</label>
                <input
                  type="date"
                  value={form.maturity_date}
                  onChange={(e) => update("maturity_date", e.target.value)}
                  className={inputCls}
                />
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="text-xs text-stone-500 block mb-1.5">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Optional notes…"
                rows={3}
                className="w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 resize-none text-base"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-stone-700 text-stone-300 text-sm font-medium hover:bg-stone-800 transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.account_name || !form.current_balance}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {saving ? "Saving…" : account ? "Save changes" : "Add account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SavingsPage() {
  const [user, setUser] = useState<any>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();
  const { activeHousehold } = useHousehold();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const loadAccounts = async () => {
    try {
      const res = await api.get("/savings");
      setAccounts(res.data);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) loadAccounts(); }, [user]);

  const handleCreate = async (data: any) => {
    try {
      const res = await api.post("/savings", data);
      setAccounts((prev) => [res.data, ...prev]);
      setShowModal(false);
      toast.success("Account added");
    } catch { toast.error("Failed to add account"); }
  };

  const handleUpdate = async (data: any) => {
    if (!editAccount) return;
    try {
      const res = await api.put(`/savings/${editAccount.id}`, data);
      setAccounts((prev) => prev.map((a) => (a.id === editAccount.id ? res.data : a)));
      setEditAccount(undefined);
      toast.success("Account updated");
    } catch { toast.error("Failed to update account"); }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await api.delete(`/savings/${id}`);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      setConfirmDelete(null);
      toast.success("Account removed");
    } catch { toast.error("Failed to remove account"); }
  };

  if (!user) return null;

  const defaultCurrency = activeHousehold?.default_currency ?? "SGD";
  // Balances are never summed across currencies — a household can hold
  // accounts in more than one, so totals are grouped by currency.
  const totalsByCurrency = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.currency] = (acc[a.currency] || 0) + (a.current_balance || 0);
    return acc;
  }, {});
  const grouped = ACCOUNT_TYPES.map((t) => ({
    type: t.value,
    label: t.label,
    accounts: accounts.filter((a) => a.account_type === t.value),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🐷</span>
          </div>
          <h3 className="text-stone-200 font-semibold mb-2">No savings accounts added yet</h3>
          <p className="text-stone-500 text-sm mb-6">
            Add bank accounts, fixed deposits, retirement funds and investments to track net worth.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-6 py-2.5 rounded-xl transition-colors min-h-[44px]"
          >
            Add your first account
          </button>
        </div>
      ) : (
        <>
          {/* Net worth summary */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 mb-6">
            <p className="text-xs text-stone-500 font-medium mb-1">Net Worth</p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {Object.entries(totalsByCurrency).map(([cur, amt]) => (
                <p key={cur} className="text-3xl font-bold text-stone-100 font-mono">
                  {cur} {amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              ))}
            </div>
            <p className="text-xs text-stone-500 mt-1">
              across {accounts.length} account{accounts.length === 1 ? "" : "s"}
              {Object.keys(totalsByCurrency).length > 1 ? " (multiple currencies)" : ""}
            </p>
          </div>

          {/* Add button */}
          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setEditAccount(undefined); setShowModal(true); }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
              Add Account
            </button>
          </div>

          {/* Accounts by type */}
          <div className="space-y-4">
            {grouped.map(({ type, label, accounts: typeAccounts }) => (
              <div
                key={type}
                className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-stone-800 flex items-center gap-2">
                  <span className="text-lg">{TYPE_EMOJI[type]}</span>
                  <span className="text-sm font-semibold text-stone-300 uppercase tracking-wide">
                    {label}
                  </span>
                  <span className="ml-auto text-xs text-stone-500">
                    {typeAccounts.length} {typeAccounts.length === 1 ? "account" : "accounts"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr className="text-xs text-stone-500 border-b border-stone-800">
                        <th className="text-left px-5 py-2.5 font-medium">Account</th>
                        <th className="text-left px-4 py-2.5 font-medium">Institution</th>
                        <th className="text-right px-4 py-2.5 font-medium">Balance</th>
                        <th className="text-right px-4 py-2.5 font-medium">Rate</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800">
                      {typeAccounts.map((account) => (
                        <tr
                          key={account.id}
                          className="hover:bg-stone-800/50 transition-colors"
                        >
                          <td className="px-5 py-3.5 max-w-[220px]">
                            <p className="text-sm font-medium text-stone-100">{account.account_name}</p>
                            {account.scheme_name && (
                              <p className="text-xs text-stone-500 mt-0.5">{account.scheme_name}</p>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="text-sm text-stone-400">{account.institution || "—"}</p>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <p className="text-sm font-mono text-stone-200">
                              {account.currency} {Number(account.current_balance).toLocaleString()}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <p className="text-sm font-mono text-stone-400">
                              {account.interest_rate ? `${account.interest_rate}%` : "—"}
                            </p>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setEditAccount(account);
                                  setShowModal(true);
                                }}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:text-emerald-400 hover:bg-emerald-900/30 transition-colors"
                                title="Edit"
                              >
                                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setConfirmDelete(account.id)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                                title="Remove"
                              >
                                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path
                                    fillRule="evenodd"
                                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && (
        <AccountModal
          account={editAccount}
          defaultCurrency={defaultCurrency}
          onClose={() => { setShowModal(false); setEditAccount(undefined); }}
          onSave={editAccount ? handleUpdate : handleCreate}
        />
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full sm:max-w-sm bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-stone-100 mb-2">Remove account?</h2>
            <p className="text-sm text-stone-400 mb-5">
              This account will be marked as inactive and removed from your dashboard.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl border border-stone-700 text-stone-300 text-sm font-medium min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeactivate(confirmDelete)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors min-h-[44px]"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
