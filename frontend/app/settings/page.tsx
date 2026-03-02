"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const ampm = i < 12 ? "AM" : "PM";
  return { value: i, label: `${h}:00 ${ampm}` };
});
const TIMEZONES = [
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

interface Settings {
  summary_day: number;
  summary_hour: number;
  summary_timezone: string;
  cutoff_mode: "last7days" | "isoweek";
  group_name: string | null;
}

export default function SettingsPage() {
  const [user,    setUser]    = useState<any>(null);
  const [form,    setForm]    = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
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
    setSaved(false);
    try {
      await api.patch("/settings", form);
      setSaved(true);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof Settings, value: any) => {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    setSaved(false);
  };

  if (!user || !form) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-lg mx-auto px-4 py-12 pb-24 sm:pb-12">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Settings</h1>
        <p className="text-stone-500 text-sm mb-8">Configure your weekly summary schedule.</p>

        {loading ? (
          <p className="text-stone-600 text-sm">Loading...</p>
        ) : (
          <div className="space-y-4">

            {/* Summary schedule */}
            <div className="border border-stone-800 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-medium text-stone-300">Summary Schedule</h2>

              <div>
                <label className="text-xs text-stone-500 block mb-2">Send summary on</label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {DAYS.map((day, i) => (
                    <button
                      key={day}
                      onClick={() => update("summary_day", i)}
                      className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                        form.summary_day === i
                          ? "bg-amber-400/15 border-amber-400/40 text-amber-300"
                          : "border-stone-800 text-stone-500 hover:text-stone-300 hover:border-stone-700"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-stone-500 block mb-2">At time</label>
                <select
                  value={form.summary_hour}
                  onChange={(e) => update("summary_hour", Number(e.target.value))}
                  className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm focus:outline-none focus:border-amber-400/60"
                >
                  {HOURS.map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-stone-500 block mb-2">Timezone</label>
                <select
                  value={form.summary_timezone}
                  onChange={(e) => update("summary_timezone", e.target.value)}
                  className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm focus:outline-none focus:border-amber-400/60"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Cutoff mode */}
            <div className="border border-stone-800 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-medium text-stone-300">Summary Period</h2>
              <p className="text-xs text-stone-500">Which receipts to include in the summary</p>
              <div className="space-y-2">
                <button
                  onClick={() => update("cutoff_mode", "last7days")}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                    form.cutoff_mode === "last7days"
                      ? "border-amber-400/40 bg-amber-400/8 text-amber-300"
                      : "border-stone-800 text-stone-400 hover:border-stone-700"
                  }`}
                >
                  <p className="font-medium">Last 7 days</p>
                  <p className="text-xs opacity-60 mt-0.5">Includes receipts from the past 7 days regardless of week boundary</p>
                </button>
                <button
                  onClick={() => update("cutoff_mode", "isoweek")}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                    form.cutoff_mode === "isoweek"
                      ? "border-amber-400/40 bg-amber-400/8 text-amber-300"
                      : "border-stone-800 text-stone-400 hover:border-stone-700"
                  }`}
                >
                  <p className="font-medium">Current ISO week</p>
                  <p className="text-xs opacity-60 mt-0.5">Includes receipts from Monday to Sunday of the current week</p>
                </button>
              </div>
            </div>

            {/* Group name */}
            <div className="border border-stone-800 rounded-xl p-5">
              <h2 className="text-sm font-medium text-stone-300 mb-1">WhatsApp Group</h2>
              <p className="text-xs text-stone-500 mb-3">Override the group set on the setup page</p>
              <input
                type="text"
                value={form.group_name || ""}
                onChange={(e) => update("group_name", e.target.value || null)}
                placeholder="e.g. Household Expenses"
                className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-amber-400/60"
              />
            </div>

            {/* Save */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold py-3 rounded-xl transition text-sm"
            >
              {saved ? "✓ Saved" : saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        )}
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
