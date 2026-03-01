"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";

function OnboardingInner() {
  const [step,         setStep]         = useState<"loading"|"create"|"done">("loading");
  const [householdName,setHouseholdName]= useState("Home");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const router      = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      // Check if user already has a household
      const res = await api.get("/household");
      if (res.data?.id) {
        router.push("/dashboard");
        return;
      }

      // Check for invite token in URL
      const token = searchParams.get("invite_token");
      if (token) {
        try {
          await api.post("/auth/accept-invite", {
            token,
            user_id: session.user.id,
          });
          router.push("/dashboard");
          return;
        } catch (e) {
          setError("Invalid or expired invite link.");
        }
      }

      setStep("create");
    };
    init();
  }, [router, searchParams]);

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      await api.post("/household", { name: householdName });
      setStep("done");
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Failed to create household");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center">
            <span className="text-sm font-bold text-stone-900">H</span>
          </div>
          <span className="font-semibold tracking-tight text-lg">Homly</span>
        </div>

        {step === "loading" && (
          <p className="text-stone-500 text-sm">Setting up your account...</p>
        )}

        {step === "create" && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Welcome to Homly</h1>
            <p className="text-stone-400 text-sm mb-8">Give your household a name to get started.</p>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="e.g. The Swami Household"
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-amber-400/60 transition text-sm"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                onClick={handleCreate}
                disabled={saving || !householdName}
                className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold py-3 rounded-xl transition text-sm"
              >
                {saving ? "Creating..." : "Create household"}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <div className="text-center">
            <p className="text-emerald-400 text-lg font-medium">✓ Household created</p>
            <p className="text-stone-500 text-sm mt-2">Taking you to your dashboard...</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function Onboarding() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}
