"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface Policy {
  id: string;
  provider: string;
  policy_number: string | null;
  coverage_type: string;
  insured_person: string | null;
  coverage_amount: number | null;
  premium_amount: number | null;
  premium_frequency: string | null;
  renewal_date: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

const COVERAGE_TYPES = ["health", "life", "home", "car", "travel", "other"];
const PREMIUM_FREQS = ["monthly", "quarterly", "annually"];

const TYPE_COLOR: Record<string, string> = {
  health: "bg-red-900/40 text-red-400",
  life: "bg-blue-900/40 text-blue-400",
  home: "bg-emerald-900/40 text-emerald-400",
  car: "bg-orange-900/40 text-orange-400",
  travel: "bg-purple-900/40 text-purple-400",
  other: "bg-stone-800 text-stone-400",
};

const TYPE_EMOJI: Record<string, string> = {
  health: "🏥", life: "💙", home: "🏠", car: "🚗", travel: "✈️", other: "📋",
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function RenewalBadge({ days }: { days: number | null }) {
  if (days == null) return <span className="text-stone-500 text-xs">—</span>;
  const cls =
    days <= 7
      ? "bg-red-900/40 text-red-400"
      : days <= 30
      ? "bg-amber-900/40 text-amber-400"
      : "bg-emerald-900/40 text-emerald-400";
  const label =
    days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
      ? "Today"
      : `${days}d`;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
  );
}

const EMPTY_FORM = {
  provider: "",
  policy_number: "",
  coverage_type: "health",
  insured_person: "",
  coverage_amount: "",
  premium_amount: "",
  premium_frequency: "annually",
  renewal_date: "",
  notes: "",
};

function PolicyModal({
  policy,
  onClose,
  onSave,
}: {
  policy?: Policy;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [form, setForm] = useState(
    policy
      ? {
          provider: policy.provider,
          policy_number: policy.policy_number ?? "",
          coverage_type: policy.coverage_type,
          insured_person: policy.insured_person ?? "",
          coverage_amount: policy.coverage_amount?.toString() ?? "",
          premium_amount: policy.premium_amount?.toString() ?? "",
          premium_frequency: policy.premium_frequency ?? "annually",
          renewal_date: policy.renewal_date?.slice(0, 10) ?? "",
          notes: policy.notes ?? "",
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);

  const update = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        coverage_amount: form.coverage_amount ? parseFloat(form.coverage_amount) : null,
        premium_amount: form.premium_amount ? parseFloat(form.premium_amount) : null,
        policy_number: form.policy_number || null,
        insured_person: form.insured_person || null,
        renewal_date: form.renewal_date || null,
        notes: form.notes || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between sticky top-0 bg-stone-900">
          <h2 className="text-base font-semibold text-stone-100">
            {policy ? "Edit Policy" : "Add Policy"}
          </h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200 w-8 h-8 flex items-center justify-center text-xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs text-stone-500 block mb-1.5">Provider *</label>
              <input type="text" value={form.provider} onChange={(e) => update("provider", e.target.value)}
                required placeholder="e.g. AIA, Prudential" className={inputCls} />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Coverage Type *</label>
              <select value={form.coverage_type} onChange={(e) => update("coverage_type", e.target.value)}
                className={inputCls}>
                {COVERAGE_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_EMOJI[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Policy Number</label>
              <input type="text" value={form.policy_number} onChange={(e) => update("policy_number", e.target.value)}
                placeholder="e.g. H-12345678" className={inputCls} />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Insured Person</label>
              <input type="text" value={form.insured_person} onChange={(e) => update("insured_person", e.target.value)}
                placeholder="e.g. John Tan" className={inputCls} />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Coverage Amount (SGD)</label>
              <input type="number" value={form.coverage_amount} onChange={(e) => update("coverage_amount", e.target.value)}
                placeholder="500000" min="0" step="any" className={inputCls} />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Premium Amount (SGD)</label>
              <input type="number" value={form.premium_amount} onChange={(e) => update("premium_amount", e.target.value)}
                placeholder="200" min="0" step="any" className={inputCls} />
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Premium Frequency</label>
              <select value={form.premium_frequency} onChange={(e) => update("premium_frequency", e.target.value)}
                className={inputCls}>
                {PREMIUM_FREQS.map((f) => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Renewal Date</label>
              <input type="date" value={form.renewal_date} onChange={(e) => update("renewal_date", e.target.value)}
                className={inputCls} />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-stone-500 block mb-1.5">Notes</label>
              <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)}
                placeholder="Optional notes…" rows={3}
                className="w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 resize-none text-base" />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-stone-700 text-stone-300 text-sm font-medium hover:bg-stone-800 transition-colors min-h-[44px]">
              Cancel
            </button>
            <button type="submit" disabled={saving || !form.provider}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px]">
              {saving ? "Saving…" : policy ? "Save changes" : "Add policy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function monthlyPremium(amount: number | null, freq: string | null): number {
  if (!amount || !freq) return 0;
  if (freq === "monthly") return amount;
  if (freq === "quarterly") return amount / 3;
  if (freq === "annually") return amount / 12;
  return 0;
}

export default function InsurancePoliciesPage() {
  const [user, setUser] = useState<any>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editPolicy, setEditPolicy] = useState<Policy | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const loadPolicies = async () => {
    try {
      const res = await api.get("/insurance");
      setPolicies(res.data);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) loadPolicies(); }, [user]);

  const handleCreate = async (data: any) => {
    try {
      const res = await api.post("/insurance", data);
      setPolicies((prev) => [res.data, ...prev]);
      setShowModal(false);
      toast.success("Policy added");
    } catch { toast.error("Failed to add policy"); }
  };

  const handleUpdate = async (data: any) => {
    if (!editPolicy) return;
    try {
      const res = await api.put(`/insurance/${editPolicy.id}`, data);
      setPolicies((prev) => prev.map((p) => (p.id === editPolicy.id ? res.data : p)));
      setEditPolicy(undefined);
      toast.success("Policy updated");
    } catch { toast.error("Failed to update policy"); }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await api.delete(`/insurance/${id}`);
      setPolicies((prev) => prev.filter((p) => p.id !== id));
      setConfirmDelete(null);
      toast.success("Policy removed");
    } catch { toast.error("Failed to remove policy"); }
  };

  if (!user) return null;

  const activeCount = policies.length;
  const renewingSoon = policies.filter((p) => {
    const d = daysUntil(p.renewal_date);
    return d != null && d <= 30 && d >= 0;
  });
  const totalMonthly = policies.reduce(
    (s, p) => s + monthlyPremium(p.premium_amount, p.premium_frequency), 0
  );
  const grouped = COVERAGE_TYPES.map((type) => ({
    type,
    policies: policies.filter((p) => p.coverage_type === type),
  })).filter((g) => g.policies.length > 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : policies.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🛡️</span>
          </div>
          <h3 className="text-stone-200 font-semibold mb-2">No policies added yet</h3>
          <p className="text-stone-500 text-sm mb-6">
            Add your household insurance policies to track renewals and coverage.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-6 py-2.5 rounded-xl transition-colors min-h-[44px]"
          >
            Add your first policy
          </button>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
              <p className="text-xs text-stone-500 font-medium mb-1">Active Policies</p>
              <p className="text-2xl font-bold text-stone-100">{activeCount}</p>
            </div>
            <div className={`border rounded-xl p-4 ${
              renewingSoon.some((p) => (daysUntil(p.renewal_date) ?? 999) <= 7)
                ? "bg-red-900/20 border-red-800"
                : renewingSoon.length > 0
                ? "bg-amber-900/20 border-amber-800"
                : "bg-stone-900 border-stone-800"
            }`}>
              <p className={`text-xs font-medium mb-1 ${
                renewingSoon.length > 0
                  ? renewingSoon.some((p) => (daysUntil(p.renewal_date) ?? 999) <= 7)
                    ? "text-red-400" : "text-amber-400"
                  : "text-stone-500"
              }`}>Renewing Soon</p>
              <p className={`text-2xl font-bold ${
                renewingSoon.length > 0
                  ? renewingSoon.some((p) => (daysUntil(p.renewal_date) ?? 999) <= 7)
                    ? "text-red-300" : "text-amber-300"
                  : "text-stone-100"
              }`}>{renewingSoon.length}</p>
            </div>
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
              <p className="text-xs text-stone-500 font-medium mb-1">Monthly Premium</p>
              <p className="text-lg font-bold text-stone-100 font-mono">
                ${totalMonthly.toFixed(0)}
              </p>
            </div>
          </div>

          {/* Add button */}
          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setEditPolicy(undefined); setShowModal(true); }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Add Policy
            </button>
          </div>

          {/* Policies by type */}
          <div className="space-y-4">
            {grouped.map(({ type, policies: typePolicies }) => (
              <div key={type} className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-stone-800 flex items-center gap-2">
                  <span className="text-lg">{TYPE_EMOJI[type]}</span>
                  <span className="text-sm font-semibold text-stone-300 uppercase tracking-wide">
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </span>
                  <span className="ml-auto text-xs text-stone-500">{typePolicies.length} {typePolicies.length === 1 ? "policy" : "policies"}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr className="text-xs text-stone-500 border-b border-stone-800">
                        <th className="text-left px-5 py-2.5 font-medium">Provider</th>
                        <th className="text-left px-4 py-2.5 font-medium">Insured</th>
                        <th className="text-right px-4 py-2.5 font-medium">Coverage</th>
                        <th className="text-right px-4 py-2.5 font-medium">Premium</th>
                        <th className="text-left px-4 py-2.5 font-medium">Renewal</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800">
                      {typePolicies.map((policy) => {
                        const days = daysUntil(policy.renewal_date);
                        return (
                          <tr key={policy.id} className="hover:bg-stone-800/50 transition-colors">
                            <td className="px-5 py-3.5">
                              <p className="text-sm font-medium text-stone-100">{policy.provider}</p>
                              {policy.policy_number && (
                                <p className="text-xs text-stone-500 mt-0.5">#{policy.policy_number}</p>
                              )}
                            </td>
                            <td className="px-4 py-3.5">
                              <p className="text-sm text-stone-400">{policy.insured_person || "—"}</p>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <p className="text-sm font-mono text-stone-200">
                                {policy.coverage_amount
                                  ? `$${Number(policy.coverage_amount).toLocaleString()}`
                                  : "—"}
                              </p>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <p className="text-sm font-mono text-stone-200">
                                {policy.premium_amount
                                  ? `$${Number(policy.premium_amount).toFixed(0)}/${policy.premium_frequency?.slice(0, 2) ?? "mo"}`
                                  : "—"}
                              </p>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex flex-col gap-1">
                                {policy.renewal_date ? (
                                  <span className="text-xs text-stone-400">
                                    {new Date(policy.renewal_date).toLocaleDateString("en-SG", {
                                      day: "numeric", month: "short", year: "numeric",
                                    })}
                                  </span>
                                ) : (
                                  <span className="text-xs text-stone-500">—</span>
                                )}
                                <RenewalBadge days={days} />
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => { setEditPolicy(policy); setShowModal(true); }}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:text-emerald-400 hover:bg-emerald-900/30 transition-colors"
                                  title="Edit"
                                >
                                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(policy.id)}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                                  title="Remove"
                                >
                                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && (
        <PolicyModal
          policy={editPolicy}
          onClose={() => { setShowModal(false); setEditPolicy(undefined); }}
          onSave={editPolicy ? handleUpdate : handleCreate}
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
            <h2 className="text-base font-semibold text-stone-100 mb-2">Remove policy?</h2>
            <p className="text-sm text-stone-400 mb-5">
              This policy will be marked as inactive and removed from your dashboard.
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
