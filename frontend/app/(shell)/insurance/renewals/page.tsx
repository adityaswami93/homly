"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";

interface Policy {
  id: string;
  provider: string;
  policy_number: string | null;
  coverage_type: string;
  insured_person: string | null;
  premium_amount: number | null;
  premium_frequency: string | null;
  renewal_date: string | null;
}

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

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-SG", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function RenewalsPage() {
  const [user, setUser] = useState<any>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    api
      .get("/insurance")
      .then((res) => {
        const sorted = [...res.data].sort((a, b) => {
          if (!a.renewal_date) return 1;
          if (!b.renewal_date) return -1;
          return new Date(a.renewal_date).getTime() - new Date(b.renewal_date).getTime();
        });
        setPolicies(sorted);
      })
      .catch(() => setPolicies([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const withDates = policies.filter((p) => p.renewal_date);
  const noDates = policies.filter((p) => !p.renewal_date);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : policies.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">📅</span>
          </div>
          <h3 className="text-stone-200 font-semibold mb-2">No renewals to track</h3>
          <p className="text-stone-500 text-sm">
            Add policies with renewal dates and they will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {withDates.map((policy) => {
            const days = daysUntil(policy.renewal_date);
            const isOverdue = days != null && days < 0;
            const isUrgent = days != null && days >= 0 && days <= 7;
            const isSoon = days != null && days > 7 && days <= 30;

            const daysColor = isOverdue || isUrgent
              ? "text-red-400 bg-red-900/40"
              : isSoon
              ? "text-amber-400 bg-amber-900/40"
              : "text-emerald-400 bg-emerald-900/40";

            const borderColor = isOverdue || isUrgent
              ? "border-red-800"
              : isSoon
              ? "border-amber-800"
              : "border-stone-800";

            return (
              <div
                key={policy.id}
                className={`bg-stone-900 border rounded-xl p-4 flex items-center gap-4 ${borderColor}`}
              >
                <div className={`w-16 h-16 rounded-xl flex flex-col items-center justify-center shrink-0 text-center ${daysColor}`}>
                  <span className="text-lg font-bold leading-none">
                    {days != null ? Math.abs(days) : "—"}
                  </span>
                  <span className="text-xs leading-none mt-0.5">
                    {days != null && days < 0 ? "overdue" : "days"}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-stone-100 font-medium text-sm">{policy.provider}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLOR[policy.coverage_type] || TYPE_COLOR.other}`}>
                      {TYPE_EMOJI[policy.coverage_type]} {policy.coverage_type}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                    <span>Renews {fmtDate(policy.renewal_date)}</span>
                    {policy.insured_person && <span>· {policy.insured_person}</span>}
                    {policy.policy_number && (
                      <span className="hidden sm:inline">· #{policy.policy_number}</span>
                    )}
                  </div>
                  {policy.premium_amount && (
                    <p className="text-xs text-stone-600 mt-1 font-mono">
                      ${Number(policy.premium_amount).toFixed(0)} / {policy.premium_frequency}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {noDates.length > 0 && (
            <div className="bg-stone-900/50 border border-stone-800 rounded-xl p-4">
              <p className="text-xs text-stone-500 uppercase tracking-widest mb-3">No Renewal Date</p>
              <div className="space-y-2">
                {noDates.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="text-base">{TYPE_EMOJI[p.coverage_type]}</span>
                    <div>
                      <p className="text-sm text-stone-200 font-medium">{p.provider}</p>
                      <p className="text-xs text-stone-500">{p.coverage_type}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
