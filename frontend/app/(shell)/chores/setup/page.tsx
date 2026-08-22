"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RECURRENCES = ["once", "daily", "weekly"];

interface SuggestedChore {
  title: string;
  recurrence: string;
  days_of_week: number[] | null;
  due_date: string | null;
  included: boolean;
}

const inputCls =
  "w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base";

export default function ChoresSetupPage() {
  const [user, setUser] = useState<any>(null);
  const [step, setStep] = useState<"info" | "loading" | "review" | "done">("info");
  const [hasHelper, setHasHelper] = useState(true);
  const [helperName, setHelperName] = useState("");
  const [description, setDescription] = useState("");
  const [chores, setChores] = useState<SuggestedChore[]>([]);
  const [offDays, setOffDays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const handleSuggest = async () => {
    setStep("loading");
    try {
      const res = await api.post("/tasks/onboarding/suggest", {
        description,
        helper_name: helperName || undefined,
      });
      const suggested: SuggestedChore[] = (res.data.chores || []).map((c: any) => ({
        title: c.title,
        recurrence: c.recurrence || "once",
        days_of_week: c.days_of_week ?? null,
        due_date: c.due_date ?? null,
        included: true,
      }));
      setChores(suggested);
      setOffDays(res.data.off_days || []);
      if (res.data.error) toast.error(res.data.error);
      setStep("review");
    } catch {
      toast.error("Couldn't generate suggestions — add chores manually.");
      setChores([]);
      setOffDays([]);
      setStep("review");
    }
  };

  const updateChore = (i: number, patch: Partial<SuggestedChore>) => {
    setChores((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const addBlankChore = () => {
    setChores((prev) => [
      ...prev,
      { title: "", recurrence: "daily", days_of_week: null, due_date: null, included: true },
    ]);
  };

  const toggleOffDay = (day: number) => {
    setOffDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const finalChores = chores.filter((c) => c.included && c.title.trim());
      await api.post("/tasks/onboarding/confirm", {
        has_helper: hasHelper,
        helper_name: helperName || null,
        duties_description: description || null,
        off_days: offDays,
        chores: finalChores.map((c) => ({
          title: c.title,
          recurrence: c.recurrence,
          days_of_week: c.recurrence === "weekly" ? c.days_of_week : null,
          due_date: c.recurrence === "once" ? c.due_date : null,
        })),
      });
      setStep("done");
      setTimeout(() => router.push("/chores"), 1200);
    } catch {
      toast.error("Failed to save setup. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-stone-100 mb-1">Set up household chores</h1>
        <p className="text-sm text-stone-500">
          Tell us about your helper's typical week and we'll suggest a starter chore list.
        </p>
      </div>

      {step === "info" && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 space-y-5">
          <div>
            <label className="text-xs text-stone-500 block mb-1.5">Do you have a domestic helper?</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setHasHelper(true)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-medium min-h-[44px] transition-colors ${
                  hasHelper ? "bg-emerald-600 border-emerald-600 text-white" : "border-stone-700 text-stone-300 hover:bg-stone-800"
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setHasHelper(false)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-medium min-h-[44px] transition-colors ${
                  !hasHelper ? "bg-emerald-600 border-emerald-600 text-white" : "border-stone-700 text-stone-300 hover:bg-stone-800"
                }`}
              >
                No, just family
              </button>
            </div>
          </div>

          {hasHelper && (
            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Helper's name (optional)</label>
              <input
                type="text"
                value={helperName}
                onChange={(e) => setHelperName(e.target.value)}
                placeholder="e.g. Maria"
                className={inputCls}
              />
            </div>
          )}

          <div>
            <label className="text-xs text-stone-500 block mb-1.5">
              Describe {hasHelper ? "their" : "your household's"} typical week
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Comes in Mon-Sat, does laundry every day, cooks dinner, cleans the house on Wednesdays and Saturdays, off on Sundays."
              rows={5}
              className="w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 resize-none text-base"
            />
          </div>

          <button
            onClick={handleSuggest}
            disabled={!description.trim()}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px]"
          >
            Generate chores
          </button>
        </div>
      )}

      {step === "loading" && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-stone-300 font-medium">Generating chores…</p>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-5">
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-stone-200 mb-3">Recurring off days</h2>
            <div className="flex gap-2 flex-wrap">
              {WEEKDAYS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleOffDay(i)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    offDays.includes(i)
                      ? "bg-emerald-600 border-emerald-600 text-white"
                      : "border-stone-700 text-stone-400 hover:bg-stone-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-500 mt-2">No task reminders are sent on these days.</p>
          </div>

          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-stone-200">Suggested chores</h2>
              <button onClick={addBlankChore} className="text-xs text-emerald-400 hover:text-emerald-300 font-medium">
                + Add chore
              </button>
            </div>
            {chores.length === 0 && (
              <p className="text-sm text-stone-500 py-4 text-center">No chores yet — add one above.</p>
            )}
            <div className="space-y-3">
              {chores.map((c, i) => (
                <div key={i} className="border border-stone-800 rounded-lg p-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={c.included}
                    onChange={(e) => updateChore(i, { included: e.target.checked })}
                    className="mt-2.5 w-4 h-4"
                  />
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={c.title}
                      onChange={(e) => updateChore(i, { title: e.target.value })}
                      placeholder="Chore title"
                      className={`${inputCls} sm:col-span-2`}
                    />
                    <select
                      value={c.recurrence}
                      onChange={(e) => updateChore(i, { recurrence: e.target.value })}
                      className={inputCls}
                    >
                      {RECURRENCES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {c.recurrence === "weekly" && (
                      <div className="sm:col-span-3 flex gap-1.5 flex-wrap">
                        {WEEKDAYS.map((label, di) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => {
                              const days = c.days_of_week || [];
                              updateChore(i, {
                                days_of_week: days.includes(di) ? days.filter((d) => d !== di) : [...days, di],
                              });
                            }}
                            className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                              (c.days_of_week || []).includes(di)
                                ? "bg-emerald-600 border-emerald-600 text-white"
                                : "border-stone-700 text-stone-500 hover:bg-stone-800"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    {c.recurrence === "once" && (
                      <input
                        type="date"
                        value={c.due_date ?? ""}
                        onChange={(e) => updateChore(i, { due_date: e.target.value })}
                        className={`${inputCls} sm:col-span-3`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("info")}
              className="flex-1 py-2.5 rounded-xl border border-stone-700 text-stone-300 text-sm font-medium hover:bg-stone-800 transition-colors min-h-[44px]"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {saving ? "Saving…" : "Confirm & finish"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-stone-200 font-medium">All set!</p>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
