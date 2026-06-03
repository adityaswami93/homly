"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface Reminder {
  id: string;
  message: string;
  remind_at: string;
  sender_name: string | null;
  sender_jid: string;
  created_at: string;
}

const COMMANDS = [
  {
    name: "/remind",
    syntax: "/remind <duration> <message>",
    description: "Set a reminder that the bot will send to the group at the specified time.",
    examples: [
      { input: "/remind 30m buy milk", note: "30 minutes from now" },
      { input: "/remind 2h call doctor", note: "2 hours from now" },
      { input: "/remind 1d renew car insurance", note: "1 day from now" },
      { input: "/remind 1h30m check the oven", note: "1 hour 30 minutes from now" },
    ],
    durations: ["Nm — minutes", "Nh — hours", "Nd — days", "Combined: e.g. 1h30m"],
    color: "#10B981",
    featured: true,
  },
];

function formatRelative(isoStr: string) {
  const diff = new Date(isoStr).getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem > 0 ? `in ${h}h ${rem}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

function formatDateTime(isoStr: string) {
  return new Date(isoStr).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function CommandsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loadingReminders, setLoadingReminders] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const fetchReminders = useCallback(async () => {
    try {
      const res = await api.get("/reminders");
      setReminders(res.data || []);
    } catch {
      // non-fatal
    } finally {
      setLoadingReminders(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchReminders();
  }, [user, fetchReminders]);

  const handleCreate = async () => {
    if (!newMessage.trim() || !newDate || !newTime) return;
    setSaving(true);
    try {
      const remind_at = new Date(`${newDate}T${newTime}:00`).toISOString();
      await api.post("/reminders", { message: newMessage.trim(), remind_at });
      toast.success("Reminder set!");
      setNewMessage("");
      setNewDate("");
      setNewTime("");
      setShowForm(false);
      fetchReminders();
    } catch {
      toast.error("Failed to set reminder");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/reminders/${id}`);
      setReminders((prev) => prev.filter((r) => r.id !== id));
      toast.success("Reminder cancelled");
    } catch {
      toast.error("Failed to cancel reminder");
    } finally {
      setDeletingId(null);
    }
  };

  // Default date/time to now+1h
  const defaultDateTime = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const dateStr = d.toLocaleDateString("en-CA"); // YYYY-MM-DD
    const timeStr = d.toTimeString().slice(0, 5);
    setNewDate(dateStr);
    setNewTime(timeStr);
  };

  if (!user) return null;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-8">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Commands reference */}
      <section>
        <h2 className="text-stone-100 text-lg font-semibold mb-4">Bot Commands</h2>
        <p className="text-stone-400 text-sm mb-5">
          Send these commands in your household WhatsApp group to interact with the Homly bot.
        </p>

        {COMMANDS.map((cmd) => (
          <div
            key={cmd.name}
            className="bg-stone-900 border border-stone-800 rounded-xl p-5 space-y-4"
          >
            {cmd.featured && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-400 border border-emerald-800">
                Featured
              </span>
            )}
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0 mt-0.5"
                style={{ backgroundColor: cmd.color + "22" }}
              >
                ⏰
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3">
                  <code className="text-emerald-400 font-mono text-base font-bold">{cmd.name}</code>
                </div>
                <p className="text-stone-400 text-sm mt-1">{cmd.description}</p>
                <code className="text-stone-300 text-xs font-mono mt-2 block">
                  {cmd.syntax}
                </code>
              </div>
            </div>

            <div>
              <p className="text-stone-500 text-xs uppercase tracking-wide mb-2">Duration formats</p>
              <div className="flex flex-wrap gap-2">
                {cmd.durations.map((d) => (
                  <span
                    key={d}
                    className="text-xs font-mono px-2 py-1 bg-stone-800 border border-stone-700 rounded text-stone-300"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-stone-500 text-xs uppercase tracking-wide mb-2">Examples</p>
              <div className="space-y-2">
                {cmd.examples.map((ex) => (
                  <div key={ex.input} className="flex items-center gap-3">
                    <code className="text-stone-200 text-sm font-mono bg-stone-800 px-2.5 py-1 rounded flex-shrink-0">
                      {ex.input}
                    </code>
                    <span className="text-stone-500 text-xs">{ex.note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Active reminders */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-stone-100 text-lg font-semibold">Scheduled Reminders</h2>
          <button
            onClick={() => { setShowForm((v) => !v); if (!showForm) defaultDateTime(); }}
            className="text-sm px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors"
          >
            {showForm ? "Cancel" : "+ New"}
          </button>
        </div>

        {showForm && (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 mb-4 space-y-3">
            <p className="text-stone-400 text-xs">Create a reminder from the web — it will be sent to your household WhatsApp group.</p>
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Reminder message…"
              rows={2}
              className="w-full bg-stone-800 border border-stone-700 text-stone-200 placeholder:text-stone-600 rounded-lg px-3 py-2 text-base resize-none focus:outline-none focus:border-stone-500"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="flex-1 bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:border-stone-500"
              />
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-32 bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:border-stone-500"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !newMessage.trim() || !newDate || !newTime}
              className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-medium text-sm transition-colors"
            >
              {saving ? "Setting…" : "Set Reminder"}
            </button>
          </div>
        )}

        {loadingReminders ? (
          <div className="text-stone-500 text-sm py-6 text-center">Loading reminders…</div>
        ) : reminders.length === 0 ? (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 text-center">
            <p className="text-stone-400 text-sm">No upcoming reminders.</p>
            <p className="text-stone-500 text-xs mt-1">
              Use <code className="text-emerald-400">/remind</code> in your WhatsApp group or tap + New above.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => (
              <div
                key={r.id}
                className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 flex items-start gap-3"
              >
                <span className="text-xl mt-0.5">⏰</span>
                <div className="flex-1 min-w-0">
                  <p className="text-stone-100 text-sm font-medium truncate">{r.message}</p>
                  <p className="text-stone-500 text-xs mt-0.5">
                    {formatDateTime(r.remind_at)}{" "}
                    <span className="text-emerald-500 font-medium">({formatRelative(r.remind_at)})</span>
                    {r.sender_name && <> · {r.sender_name}</>}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  disabled={deletingId === r.id}
                  className="text-stone-500 hover:text-red-400 text-lg leading-none transition-colors disabled:opacity-40 flex-shrink-0 min-h-[44px] flex items-center"
                  aria-label="Cancel reminder"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
