"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface HouseholdProfile {
  primary_age?: number | null;
  marital_status?: string | null;
  num_children?: number | null;
  has_elderly_dependants?: boolean | null;
  employment_type?: string | null;
  has_mortgage?: boolean | null;
  owns_car?: boolean | null;
  residency_status?: string | null;
}

interface GapCard {
  id: string;
  label: string;
  coverage_type: string;
  priority: "critical" | "recommended" | "optional";
  explanation: string;
  starter_question: string;
}

interface GapsResponse {
  profile_complete: boolean;
  gaps: GapCard[];
}

const TYPE_EMOJI: Record<string, string> = {
  health: "🏥",
  life: "💙",
  home: "🏠",
  car: "🚗",
  travel: "✈️",
  other: "📋",
};

const PRIORITY_STYLES: Record<string, { border: string; bg: string; badge: string; dot: string }> = {
  critical: {
    border: "border-red-800",
    bg: "bg-red-900/20",
    badge: "bg-red-900/40 text-red-400",
    dot: "bg-red-400",
  },
  recommended: {
    border: "border-amber-800",
    bg: "bg-amber-900/20",
    badge: "bg-amber-900/40 text-amber-400",
    dot: "bg-amber-400",
  },
  optional: {
    border: "border-stone-700",
    bg: "bg-stone-900",
    badge: "bg-stone-800 text-stone-400",
    dot: "bg-stone-500",
  },
};

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors min-h-[24px] ${
        checked ? "bg-emerald-600" : "bg-stone-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function GapsPage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<HouseholdProfile>({});
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [gapsData, setGapsData] = useState<GapsResponse | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
      loadProfile();
      loadGaps();
    });
  }, [router]);

  async function loadProfile() {
    try {
      const res = await api.get("/insurance/profile");
      setProfile(res.data || {});
    } catch {
      // no profile yet — start empty
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadGaps() {
    setGapsLoading(true);
    try {
      const res = await api.get("/insurance/gaps");
      setGapsData(res.data);
    } catch {
      toast.error("Failed to load gap analysis.");
    } finally {
      setGapsLoading(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/insurance/profile", profile);
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2500);
      // Refresh gaps after saving profile
      loadGaps();
    } catch {
      toast.error("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof HouseholdProfile>(key: K, value: HouseholdProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  if (!user) return null;

  const hasNoProfile =
    !profile.primary_age &&
    !profile.marital_status &&
    !profile.residency_status &&
    !profile.employment_type;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-stone-100 font-semibold text-lg mb-1">Coverage Gap Analysis</h2>
        <p className="text-stone-500 text-sm">
          Tell us about your household to get personalised coverage recommendations.
        </p>
      </div>

      {/* Section A — Life Stage Profile */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-stone-500 uppercase tracking-wider">Life Stage Profile</p>
          {saveFeedback && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>

        {profileLoading ? (
          <div className="flex items-center gap-3 py-4">
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-stone-500 text-sm">Loading profile…</p>
          </div>
        ) : (
          <>
            {hasNoProfile && (
              <div className="mb-4 p-3 rounded-lg bg-stone-800 border border-stone-700">
                <p className="text-stone-300 text-sm">
                  Tell us about your household to see personalised coverage recommendations.
                </p>
              </div>
            )}

            <form onSubmit={saveProfile}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Age */}
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">Age</label>
                  <input
                    type="number"
                    min={18}
                    max={120}
                    value={profile.primary_age ?? ""}
                    onChange={(e) =>
                      setField("primary_age", e.target.value ? parseInt(e.target.value) : null)
                    }
                    placeholder="e.g. 35"
                    className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-base text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px]"
                  />
                </div>

                {/* Marital status */}
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">Marital Status</label>
                  <select
                    value={profile.marital_status ?? ""}
                    onChange={(e) => setField("marital_status", e.target.value || null)}
                    className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-base text-stone-200 focus:outline-none focus:border-emerald-600 min-h-[44px]"
                  >
                    <option value="">Select…</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                    <option value="widowed">Widowed</option>
                  </select>
                </div>

                {/* Children */}
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">Number of Children</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={profile.num_children ?? 0}
                    onChange={(e) => setField("num_children", parseInt(e.target.value) || 0)}
                    className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-base text-stone-200 focus:outline-none focus:border-emerald-600 min-h-[44px]"
                  />
                </div>

                {/* Employment */}
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">Employment</label>
                  <select
                    value={profile.employment_type ?? ""}
                    onChange={(e) => setField("employment_type", e.target.value || null)}
                    className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-base text-stone-200 focus:outline-none focus:border-emerald-600 min-h-[44px]"
                  >
                    <option value="">Select…</option>
                    <option value="employed">Employed</option>
                    <option value="self_employed">Self-employed</option>
                    <option value="unemployed">Unemployed</option>
                    <option value="retired">Retired</option>
                  </select>
                </div>

                {/* Residency */}
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">Residency</label>
                  <select
                    value={profile.residency_status ?? ""}
                    onChange={(e) => setField("residency_status", e.target.value || null)}
                    className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-base text-stone-200 focus:outline-none focus:border-emerald-600 min-h-[44px]"
                  >
                    <option value="">Select…</option>
                    <option value="citizen">Citizen</option>
                    <option value="pr">Permanent Resident</option>
                    <option value="expat">Expat</option>
                  </select>
                </div>
              </div>

              {/* Toggles */}
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between min-h-[44px]">
                  <div>
                    <p className="text-sm text-stone-200">Elderly dependants</p>
                    <p className="text-xs text-stone-500">Parents or relatives you support</p>
                  </div>
                  <Toggle
                    checked={!!profile.has_elderly_dependants}
                    onChange={(v) => setField("has_elderly_dependants", v)}
                  />
                </div>
                <div className="flex items-center justify-between min-h-[44px]">
                  <div>
                    <p className="text-sm text-stone-200">Mortgage</p>
                    <p className="text-xs text-stone-500">Currently paying a home loan</p>
                  </div>
                  <Toggle
                    checked={!!profile.has_mortgage}
                    onChange={(v) => setField("has_mortgage", v)}
                  />
                </div>
                <div className="flex items-center justify-between min-h-[44px]">
                  <div>
                    <p className="text-sm text-stone-200">Own a car</p>
                    <p className="text-xs text-stone-500">Vehicle registered to household</p>
                  </div>
                  <Toggle
                    checked={!!profile.owns_car}
                    onChange={(v) => setField("owns_car", v)}
                  />
                </div>
              </div>

              <div className="mt-5">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  {saving ? "Saving…" : "Save Profile"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* Section B — Gap cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-stone-500 uppercase tracking-wider">Coverage Gaps</p>
          {gapsData && !gapsLoading && (
            <span className="text-xs text-stone-500">
              {gapsData.gaps.length === 0
                ? "No gaps found"
                : `${gapsData.gaps.length} gap${gapsData.gaps.length !== 1 ? "s" : ""} identified`}
            </span>
          )}
        </div>

        {/* Profile incomplete notice */}
        {gapsData && !gapsData.profile_complete && (
          <div className="mb-4 p-3 rounded-lg bg-stone-800 border border-stone-700 flex gap-2.5">
            <svg className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-stone-400">
              Complete your profile above for personalised results. Showing general recommendations for now.
            </p>
          </div>
        )}

        {gapsLoading ? (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-10 text-center">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-stone-400 text-sm">Analysing your coverage…</p>
          </div>
        ) : gapsData?.gaps.length === 0 ? (
          <div className="bg-emerald-900/10 border border-emerald-800/50 rounded-xl p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-900/40 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-emerald-300 font-medium text-sm">Your coverage looks complete</p>
              <p className="text-stone-400 text-xs mt-0.5">
                No significant gaps identified for your life stage. Keep your policies up to date.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {gapsData?.gaps.map((gap) => {
              const styles = PRIORITY_STYLES[gap.priority] ?? PRIORITY_STYLES.optional;
              const learnMoreUrl = `/insurance/coverage?q=${encodeURIComponent(gap.starter_question)}`;
              const addPolicyUrl = `/insurance?type=${encodeURIComponent(gap.coverage_type)}`;
              return (
                <div
                  key={gap.id}
                  className={`rounded-xl border p-4 flex flex-col gap-3 ${styles.border} ${styles.bg}`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{TYPE_EMOJI[gap.coverage_type] ?? "📋"}</span>
                      <p className="text-sm font-medium text-stone-100">{gap.label}</p>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles.badge}`}
                    >
                      {gap.priority}
                    </span>
                  </div>

                  {/* Explanation */}
                  <p className="text-xs text-stone-400 leading-relaxed">{gap.explanation}</p>

                  {/* Actions */}
                  <div className="flex gap-2 mt-auto">
                    <Link
                      href={learnMoreUrl}
                      className="flex-1 text-center px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 hover:border-stone-600 text-stone-300 text-xs font-medium transition-colors min-h-[36px] flex items-center justify-center"
                    >
                      Learn more
                    </Link>
                    <Link
                      href={addPolicyUrl}
                      className="flex-1 text-center px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors min-h-[36px] flex items-center justify-center"
                    >
                      Add policy
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
