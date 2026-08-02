"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface Chore {
  id: string;
  title: string;
  notes: string | null;
  recurrence: "once" | "daily" | "weekly";
  days_of_week: number[] | null;
  due_date: string | null;
  active: boolean;
  status_today: "pending" | "done" | "skipped" | null;
  due_today: boolean;
}

const inputCls =
  "w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RECURRENCE_LABEL: Record<string, string> = { once: "One-off", daily: "Daily", weekly: "Weekly" };

function ChoreModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [recurrence, setRecurrence] = useState<"once" | "daily" | "weekly">("daily");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        title,
        notes: notes || null,
        recurrence,
        days_of_week: recurrence === "weekly" ? daysOfWeek : null,
        due_date: recurrence === "once" ? dueDate || null : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between sticky top-0 bg-stone-900 z-10">
          <h2 className="text-base font-semibold text-stone-100">Add task</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200 w-8 h-8 flex items-center justify-center text-xl">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs text-stone-500 block mb-1.5">Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required
              placeholder="e.g. Mop living room" className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1.5">Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional details" className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1.5">Recurrence</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)} className={inputCls}>
              <option value="once">One-off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          {recurrence === "weekly" && (
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAYS.map((label, i) => (
                <button
                  key={label} type="button"
                  onClick={() => setDaysOfWeek((prev) => prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i])}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    daysOfWeek.includes(i) ? "bg-emerald-600 border-emerald-600 text-white" : "border-stone-700 text-stone-400 hover:bg-stone-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {recurrence === "once" && (
            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-stone-700 text-stone-300 text-sm font-medium hover:bg-stone-800 transition-colors min-h-[44px]">
              Cancel
            </button>
            <button type="submit" disabled={saving || !title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px]">
              {saving ? "Saving…" : "Add task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChoresTodayPage() {
  const [user, setUser] = useState<any>(null);
  const [chores, setChores] = useState<Chore[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
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
    (async () => {
      try {
        const profileRes = await api.get("/tasks/helper-profile");
        if (!profileRes.data?.onboarded_at) {
          router.push("/chores/setup");
          return;
        }
        const res = await api.get("/tasks");
        setChores(res.data);
      } catch {
        setChores([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, router]);

  const handleCreate = async (data: any) => {
    try {
      const res = await api.post("/tasks", data);
      setChores((prev) => [...prev, { ...res.data, status_today: null, due_today: false }]);
      setShowModal(false);
      toast.success("Task added");
    } catch { toast.error("Failed to add task"); }
  };

  const handleComplete = async (id: string, status: "done" | "skipped") => {
    try {
      await api.post(`/tasks/${id}/complete`, { status });
      setChores((prev) => prev.map((c) => (c.id === id ? { ...c, status_today: status } : c)));
    } catch { toast.error("Failed to update task"); }
  };

  if (!user) return null;

  const dueToday = chores.filter((c) => c.due_today);
  const upcoming = chores.filter((c) => !c.due_today);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Add Task
        </button>
      </div>

      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : chores.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🧹</span>
          </div>
          <h3 className="text-stone-200 font-semibold mb-2">No chores yet</h3>
          <p className="text-stone-500 text-sm mb-6">Add your first task to get started.</p>
          <button onClick={() => setShowModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-6 py-2.5 rounded-xl transition-colors min-h-[44px]">
            Add your first task
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-800">
              <span className="text-sm font-semibold text-stone-300">Today</span>
              <span className="ml-2 text-xs text-stone-500">{dueToday.length} task{dueToday.length === 1 ? "" : "s"}</span>
            </div>
            {dueToday.length === 0 ? (
              <p className="text-sm text-stone-500 px-5 py-6">Nothing scheduled for today.</p>
            ) : (
              <div className="divide-y divide-stone-800">
                {dueToday.map((c) => (
                  <div key={c.id} className="px-5 py-3.5 flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={c.status_today === "done"}
                      onChange={(e) => handleComplete(c.id, e.target.checked ? "done" : "skipped")}
                      className="w-4 h-4"
                    />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${c.status_today === "done" ? "text-stone-500 line-through" : "text-stone-100"}`}>
                        {c.title}
                      </p>
                      {c.notes && <p className="text-xs text-stone-500 mt-0.5">{c.notes}</p>}
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-stone-800 text-stone-400">
                      {RECURRENCE_LABEL[c.recurrence]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {upcoming.length > 0 && (
            <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-stone-800">
                <span className="text-sm font-semibold text-stone-300">Other chores</span>
              </div>
              <div className="divide-y divide-stone-800">
                {upcoming.map((c) => (
                  <div key={c.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-stone-300">{c.title}</p>
                      {c.notes && <p className="text-xs text-stone-500 mt-0.5">{c.notes}</p>}
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-stone-800 text-stone-400">
                      {RECURRENCE_LABEL[c.recurrence]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && <ChoreModal onClose={() => setShowModal(false)} onSave={handleCreate} />}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
