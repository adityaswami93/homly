"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CustomCommand {
  id: string;
  trigger: string;
  response: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
}

interface Reminder {
  id: string;
  message: string;
  remind_at: string;
  sender_name: string | null;
  sender_jid: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelative(isoStr: string) {
  const diff = new Date(isoStr).getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem > 0 ? `in ${h}h ${rem}m` : `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
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

// ── Blank form state ───────────────────────────────────────────────────────────

const blankCmd = { trigger: "", response: "", description: "", enabled: true };

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CommandsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<"commands" | "reminders">("commands");
  const { toasts, dismissToast, toast } = useToast();

  // Custom commands state
  const [cmds, setCmds] = useState<CustomCommand[]>([]);
  const [loadingCmds, setLoadingCmds] = useState(true);
  const [showCmdForm, setShowCmdForm] = useState(false);
  const [editingCmd, setEditingCmd] = useState<CustomCommand | null>(null);
  const [cmdForm, setCmdForm] = useState(blankCmd);
  const [savingCmd, setSavingCmd] = useState(false);
  const [deletingCmdId, setDeletingCmdId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Reminders state
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loadingReminders, setLoadingReminders] = useState(true);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderMsg, setReminderMsg] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [reminderTime, setReminderTime] = useState("");
  const [savingReminder, setSavingReminder] = useState(false);
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  // ── Fetch custom commands ──────────────────────────────────────────────────

  const fetchCmds = useCallback(async () => {
    try {
      const res = await api.get("/commands");
      setCmds(res.data || []);
    } catch { /* non-fatal */ }
    finally { setLoadingCmds(false); }
  }, []);

  // ── Fetch reminders ────────────────────────────────────────────────────────

  const fetchReminders = useCallback(async () => {
    try {
      const res = await api.get("/reminders");
      setReminders(res.data || []);
    } catch { /* non-fatal */ }
    finally { setLoadingReminders(false); }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchCmds();
    fetchReminders();
  }, [user, fetchCmds, fetchReminders]);

  // ── Custom command handlers ────────────────────────────────────────────────

  const openNewCmd = () => {
    setEditingCmd(null);
    setCmdForm(blankCmd);
    setShowCmdForm(true);
  };

  const openEditCmd = (cmd: CustomCommand) => {
    setEditingCmd(cmd);
    setCmdForm({
      trigger: cmd.trigger,
      response: cmd.response,
      description: cmd.description ?? "",
      enabled: cmd.enabled,
    });
    setShowCmdForm(true);
  };

  const closeCmdForm = () => {
    setShowCmdForm(false);
    setEditingCmd(null);
    setCmdForm(blankCmd);
  };

  const handleSaveCmd = async () => {
    if (!cmdForm.trigger.trim() || !cmdForm.response.trim()) return;
    setSavingCmd(true);
    try {
      const payload = {
        trigger: cmdForm.trigger.trim().replace(/^\//, ""),
        response: cmdForm.response.trim(),
        description: cmdForm.description.trim() || null,
        enabled: cmdForm.enabled,
      };
      if (editingCmd) {
        await api.patch(`/commands/${editingCmd.id}`, payload);
        toast.success("Command updated");
      } else {
        await api.post("/commands", payload);
        toast.success("Command created");
      }
      closeCmdForm();
      fetchCmds();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to save command");
    } finally {
      setSavingCmd(false);
    }
  };

  const handleDeleteCmd = async (id: string) => {
    setDeletingCmdId(id);
    try {
      await api.delete(`/commands/${id}`);
      setCmds((prev) => prev.filter((c) => c.id !== id));
      toast.success("Command deleted");
    } catch {
      toast.error("Failed to delete command");
    } finally {
      setDeletingCmdId(null);
    }
  };

  const handleToggleCmd = async (cmd: CustomCommand) => {
    setTogglingId(cmd.id);
    try {
      const res = await api.patch(`/commands/${cmd.id}`, {
        trigger: cmd.trigger,
        response: cmd.response,
        description: cmd.description,
        enabled: !cmd.enabled,
      });
      setCmds((prev) => prev.map((c) => (c.id === cmd.id ? res.data : c)));
    } catch {
      toast.error("Failed to update command");
    } finally {
      setTogglingId(null);
    }
  };

  // ── Reminder handlers ──────────────────────────────────────────────────────

  const openReminderForm = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    setReminderDate(d.toLocaleDateString("en-CA"));
    setReminderTime(d.toTimeString().slice(0, 5));
    setShowReminderForm(true);
  };

  const handleCreateReminder = async () => {
    if (!reminderMsg.trim() || !reminderDate || !reminderTime) return;
    setSavingReminder(true);
    try {
      const remind_at = new Date(`${reminderDate}T${reminderTime}:00`).toISOString();
      await api.post("/reminders", { message: reminderMsg.trim(), remind_at });
      toast.success("Reminder set!");
      setReminderMsg("");
      setShowReminderForm(false);
      fetchReminders();
    } catch {
      toast.error("Failed to set reminder");
    } finally {
      setSavingReminder(false);
    }
  };

  const handleDeleteReminder = async (id: string) => {
    setDeletingReminderId(id);
    try {
      await api.delete(`/reminders/${id}`);
      setReminders((prev) => prev.filter((r) => r.id !== id));
      toast.success("Reminder cancelled");
    } catch {
      toast.error("Failed to cancel reminder");
    } finally {
      setDeletingReminderId(null);
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Tabs */}
      <div className="flex gap-1 bg-stone-900 border border-stone-800 rounded-xl p-1">
        {(["commands", "reminders"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
              tab === t
                ? "bg-stone-700 text-stone-100"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            {t === "commands" ? "Custom Commands" : "Reminders"}
          </button>
        ))}
      </div>

      {/* ── Custom Commands tab ── */}
      {tab === "commands" && (
        <section className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-stone-100 font-semibold">Custom Commands</h2>
              <p className="text-stone-500 text-xs mt-1">
                Type <code className="text-emerald-400">/trigger</code> in WhatsApp and the bot replies instantly.
              </p>
            </div>
            <button
              onClick={openNewCmd}
              className="flex-shrink-0 text-sm px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors"
            >
              + New
            </button>
          </div>

          {/* Built-in hint */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
            <p className="text-stone-400 text-xs font-medium mb-2">Built-in commands</p>
            <div className="flex flex-wrap gap-2">
              {[
                { trigger: "/remind", note: "Set a timed reminder" },
              ].map(({ trigger, note }) => (
                <div key={trigger} className="flex items-center gap-2 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5">
                  <code className="text-emerald-400 text-xs font-mono">{trigger}</code>
                  <span className="text-stone-500 text-xs">{note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Create / Edit form */}
          {showCmdForm && (
            <div className="bg-stone-900 border border-emerald-800/60 rounded-xl p-4 space-y-3">
              <p className="text-stone-300 text-sm font-medium">
                {editingCmd ? "Edit command" : "New command"}
              </p>

              {/* Trigger */}
              <div>
                <label className="text-stone-500 text-xs mb-1 block">Trigger word</label>
                <div className="flex items-center bg-stone-800 border border-stone-700 rounded-lg overflow-hidden focus-within:border-stone-500">
                  <span className="pl-3 text-stone-500 text-base select-none">/</span>
                  <input
                    type="text"
                    value={cmdForm.trigger.replace(/^\//, "")}
                    onChange={(e) =>
                      setCmdForm((f) => ({ ...f, trigger: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") }))
                    }
                    placeholder="wifi"
                    maxLength={30}
                    className="flex-1 bg-transparent text-stone-200 placeholder:text-stone-600 px-2 py-2.5 text-base focus:outline-none"
                  />
                </div>
                <p className="text-stone-600 text-xs mt-1">Letters, digits, _ or - only. e.g. wifi, chores, budget</p>
              </div>

              {/* Response */}
              <div>
                <label className="text-stone-500 text-xs mb-1 block">Bot reply</label>
                <textarea
                  value={cmdForm.response}
                  onChange={(e) => setCmdForm((f) => ({ ...f, response: e.target.value }))}
                  placeholder="WiFi: Network → HomlyHome  Password → Homly2024!"
                  rows={4}
                  maxLength={2000}
                  className="w-full bg-stone-800 border border-stone-700 text-stone-200 placeholder:text-stone-600 rounded-lg px-3 py-2.5 text-base resize-none focus:outline-none focus:border-stone-500"
                />
                <p className="text-stone-600 text-xs mt-1 text-right">{cmdForm.response.length}/2000</p>
              </div>

              {/* Description (optional) */}
              <div>
                <label className="text-stone-500 text-xs mb-1 block">Description <span className="text-stone-600">(optional, shown in the app only)</span></label>
                <input
                  type="text"
                  value={cmdForm.description}
                  onChange={(e) => setCmdForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What does this command do?"
                  maxLength={200}
                  className="w-full bg-stone-800 border border-stone-700 text-stone-200 placeholder:text-stone-600 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:border-stone-500"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveCmd}
                  disabled={savingCmd || !cmdForm.trigger.trim() || !cmdForm.response.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-medium text-sm transition-colors"
                >
                  {savingCmd ? "Saving…" : editingCmd ? "Save changes" : "Create command"}
                </button>
                <button
                  onClick={closeCmdForm}
                  className="px-4 py-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Commands list */}
          {loadingCmds ? (
            <div className="text-stone-500 text-sm py-6 text-center">Loading commands…</div>
          ) : cmds.length === 0 ? (
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-8 text-center">
              <p className="text-stone-300 font-medium mb-1">No custom commands yet</p>
              <p className="text-stone-500 text-sm">
                Create one above — group members can trigger it by typing e.g.{" "}
                <code className="text-emerald-400">/wifi</code> in WhatsApp.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cmds.map((cmd) => (
                <div
                  key={cmd.id}
                  className={`bg-stone-900 border rounded-xl px-4 py-3 flex items-start gap-3 transition-opacity ${
                    cmd.enabled ? "border-stone-800" : "border-stone-800/50 opacity-60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-emerald-400 font-mono text-sm font-bold">/{cmd.trigger}</code>
                      {!cmd.enabled && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-stone-800 text-stone-500">disabled</span>
                      )}
                    </div>
                    {cmd.description && (
                      <p className="text-stone-500 text-xs mt-0.5">{cmd.description}</p>
                    )}
                    <p className="text-stone-300 text-sm mt-1 line-clamp-2 whitespace-pre-wrap">{cmd.response}</p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Toggle enabled */}
                    <button
                      onClick={() => handleToggleCmd(cmd)}
                      disabled={togglingId === cmd.id}
                      title={cmd.enabled ? "Disable" : "Enable"}
                      className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-800 text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-40"
                    >
                      {cmd.enabled ? (
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm3.707 6.293a1 1 0 00-1.414-1.414L9 10.172 7.707 8.879a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => openEditCmd(cmd)}
                      title="Edit"
                      className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-800 text-stone-400 hover:text-stone-200 transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.793 8.793-3.536.707.707-3.535 8.794-8.793z" />
                      </svg>
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => handleDeleteCmd(cmd.id)}
                      disabled={deletingCmdId === cmd.id}
                      title="Delete"
                      className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-800 text-stone-400 hover:text-red-400 transition-colors disabled:opacity-40"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Reminders tab ── */}
      {tab === "reminders" && (
        <section className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-stone-100 font-semibold">Scheduled Reminders</h2>
              <p className="text-stone-500 text-xs mt-1">
                Use <code className="text-emerald-400">/remind 2h buy milk</code> in WhatsApp, or schedule from here.
              </p>
            </div>
            <button
              onClick={openReminderForm}
              className="flex-shrink-0 text-sm px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors"
            >
              + New
            </button>
          </div>

          {/* Reminder durations reference */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
            <p className="text-stone-400 text-xs font-medium mb-2">Duration formats for /remind</p>
            <div className="flex flex-wrap gap-2">
              {["30m", "2h", "1d", "1h30m"].map((ex) => (
                <code key={ex} className="text-xs font-mono px-2 py-1 bg-stone-800 border border-stone-700 rounded text-stone-300">
                  /remind {ex} message
                </code>
              ))}
            </div>
          </div>

          {/* New reminder form */}
          {showReminderForm && (
            <div className="bg-stone-900 border border-emerald-800/60 rounded-xl p-4 space-y-3">
              <p className="text-stone-300 text-sm font-medium">New reminder</p>
              <textarea
                value={reminderMsg}
                onChange={(e) => setReminderMsg(e.target.value)}
                placeholder="Reminder message…"
                rows={2}
                className="w-full bg-stone-800 border border-stone-700 text-stone-200 placeholder:text-stone-600 rounded-lg px-3 py-2.5 text-base resize-none focus:outline-none focus:border-stone-500"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={reminderDate}
                  onChange={(e) => setReminderDate(e.target.value)}
                  className="flex-1 bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:border-stone-500"
                />
                <input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="w-32 bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:border-stone-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateReminder}
                  disabled={savingReminder || !reminderMsg.trim() || !reminderDate || !reminderTime}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-medium text-sm transition-colors"
                >
                  {savingReminder ? "Setting…" : "Set Reminder"}
                </button>
                <button
                  onClick={() => setShowReminderForm(false)}
                  className="px-4 py-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Reminders list */}
          {loadingReminders ? (
            <div className="text-stone-500 text-sm py-6 text-center">Loading reminders…</div>
          ) : reminders.length === 0 ? (
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-8 text-center">
              <p className="text-stone-300 font-medium mb-1">No upcoming reminders</p>
              <p className="text-stone-500 text-sm">
                Type <code className="text-emerald-400">/remind 30m buy milk</code> in your group, or tap + New above.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {reminders.map((r) => (
                <div
                  key={r.id}
                  className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 flex items-start gap-3"
                >
                  <span className="text-xl mt-0.5 flex-shrink-0">⏰</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-100 text-sm font-medium">{r.message}</p>
                    <p className="text-stone-500 text-xs mt-0.5">
                      {formatDateTime(r.remind_at)}{" "}
                      <span className="text-emerald-500 font-medium">({formatRelative(r.remind_at)})</span>
                      {r.sender_name && <> · {r.sender_name}</>}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteReminder(r.id)}
                    disabled={deletingReminderId === r.id}
                    className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-800 text-stone-500 hover:text-red-400 transition-colors disabled:opacity-40 flex-shrink-0"
                    aria-label="Cancel reminder"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
