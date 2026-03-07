"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Link from "next/link";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const ampm = i < 12 ? "AM" : "PM";
  return { value: i, label: `${h}:00 ${ampm}` };
});
const TIMEZONES = [
  "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Jakarta", "Asia/Manila",
  "Asia/Hong_Kong", "Asia/Tokyo", "Europe/London", "America/New_York", "America/Los_Angeles",
];

interface Settings {
  summary_day: number;
  summary_hour: number;
  summary_timezone: string;
  cutoff_mode: "last7days" | "isoweek";
  group_name: string | null;
  reimbursement_mode: "all" | "none" | "helpers_only";
  helper_identifiers: string;
}

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [form, setForm] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      try {
        const res = await api.get("/household");
        const myMember = res.data.members?.find((m: any) => m.user_id === session.user.id);
        const isSuperAdmin = session.user.user_metadata?.is_super_admin === true;
        setIsAdmin(myMember?.role === "admin" || isSuperAdmin);
      } catch { /* non-blocking */ }
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    api.get("/settings").then((res) => {
      setForm(res.data);
      setLoading(false);
    });
  }, [user]);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await api.patch("/settings", form);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof Settings, value: any) => {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  if (!user || !form) return null;

  const TABS = [
    { key: "general", label: "General" },
    { key: "reimbursement", label: "Reimbursement" },
    { key: "whatsapp", label: "WhatsApp" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
      ) : (
        <>
          {activeTab === "general" && (
            <div className="space-y-4">
              <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">Summary Schedule</h2>
                <div>
                  <label className="text-xs text-gray-500 block mb-2">Send summary on</label>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                    {DAYS.map((day, i) => (
                      <button
                        key={day}
                        onClick={() => update("summary_day", i)}
                        className={`py-2 rounded-lg text-xs font-medium transition-colors border min-h-[44px] ${
                          form.summary_day === i
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        {day.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-2">At time</label>
                  <select
                    value={form.summary_hour}
                    onChange={(e) => update("summary_hour", Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-emerald-400 min-h-[44px] text-base"
                  >
                    {HOURS.map((h) => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-2">Timezone</label>
                  <select
                    value={form.summary_timezone}
                    onChange={(e) => update("summary_timezone", e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-emerald-400 min-h-[44px] text-base"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">Summary Period</h2>
                <p className="text-xs text-gray-400">Which receipts to include in the summary</p>
                <div className="space-y-2">
                  {[
                    { value: "last7days", label: "Last 7 days", desc: "Includes receipts from the past 7 days regardless of week boundary" },
                    { value: "isoweek", label: "Current ISO week", desc: "Includes receipts from Monday to Sunday of the current week" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => update("cutoff_mode", opt.value)}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors min-h-[60px] ${
                        form.cutoff_mode === opt.value
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      <p className="font-medium">{opt.label}</p>
                      <p className="text-xs opacity-70 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {isAdmin && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition text-sm min-h-[48px]"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              )}
            </div>
          )}

          {activeTab === "reimbursement" && (
            <div className="space-y-4">
              <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">Reimbursement Mode</h2>
                <p className="text-xs text-gray-400">Which receipts count as reimbursable expenses</p>
                <div className="space-y-2">
                  {[
                    { value: "all", label: "Reimburse all", desc: "Every receipt is reimbursable by default" },
                    { value: "none", label: "Track only", desc: "No receipts are reimbursable — track spending only" },
                    { value: "helpers_only", label: "Helpers only", desc: "Only receipts from identified helpers are reimbursable" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => update("reimbursement_mode", opt.value)}
                      disabled={!isAdmin}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors min-h-[60px] disabled:opacity-50 ${
                        form.reimbursement_mode === opt.value
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      <p className="font-medium">{opt.label}</p>
                      <p className="text-xs opacity-70 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {form.reimbursement_mode === "helpers_only" && (
                <div className="bg-white border border-gray-100 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-1">Helper identifiers</h2>
                  <p className="text-xs text-gray-400 mb-3">
                    Comma-separated names or phone numbers. Receipts from these senders will be marked reimbursable.
                  </p>
                  <input
                    type="text"
                    value={form.helper_identifiers || ""}
                    onChange={(e) => update("helper_identifiers", e.target.value)}
                    placeholder="e.g. Maria, +6591234567"
                    disabled={!isAdmin}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-800 text-sm placeholder:text-gray-400 focus:outline-none focus:border-emerald-400 disabled:opacity-50 min-h-[44px] text-base"
                  />
                </div>
              )}

              {isAdmin && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition text-sm min-h-[48px]"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              )}
            </div>
          )}

          {activeTab === "whatsapp" && (
            <div className="space-y-4">
              <div className="bg-white border border-gray-100 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-1">WhatsApp Group</h2>
                <p className="text-xs text-gray-400 mb-3">
                  Display name of the connected WhatsApp group
                </p>
                <input
                  type="text"
                  value={form.group_name || ""}
                  onChange={(e) => update("group_name", e.target.value || null)}
                  placeholder="e.g. Household Expenses"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-800 text-sm placeholder:text-gray-400 focus:outline-none focus:border-emerald-400 min-h-[44px] text-base mb-3"
                />
                <Link
                  href="/setup"
                  className="block w-full text-center py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors min-h-[44px] flex items-center justify-center"
                >
                  Manage WhatsApp connection →
                </Link>
              </div>

              {isAdmin && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition text-sm min-h-[48px]"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              )}
            </div>
          )}
        </>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
