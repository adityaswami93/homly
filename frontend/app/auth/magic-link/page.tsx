"use client";

import { useState, useEffect, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

function MagicLinkHandler() {
  const [status, setStatus] = useState<"loading"|"success"|"error">("loading");
  const router = useRouter();

  useEffect(() => {
    // Supabase handles the magic link token in the URL hash automatically
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        setStatus("success");
        // Check household
        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/household`,
            { headers: { Authorization: `Bearer ${session.access_token}` } }
          );
          const data = await res.json();
          if (data?.id) {
            router.push("/dashboard");
          } else {
            router.push("/onboarding");
          }
        } catch {
          router.push("/dashboard");
        }
      } else if (event === "SIGNED_OUT") {
        setStatus("error");
      }
    });

    // Timeout fallback
    setTimeout(() => {
      if (status === "loading") setStatus("error");
    }, 8000);
  }, [router]);

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
            <span className="text-sm font-bold text-white">H</span>
          </div>
          <span className="font-semibold tracking-tight text-lg">Homly</span>
        </div>

        {status === "loading" && (
          <>
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-stone-400 text-sm">Signing you in...</p>
          </>
        )}

        {status === "success" && (
          <>
            <p className="text-emerald-400 text-lg font-medium mb-2">✓ Signed in</p>
            <p className="text-stone-500 text-sm">Taking you to your dashboard...</p>
          </>
        )}

        {status === "error" && (
          <>
            <p className="text-red-400 font-medium mb-2">Link expired or invalid</p>
            <p className="text-stone-500 text-sm mb-6">Magic links expire after 1 hour.</p>
            <button
              onClick={() => router.push("/login")}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-2.5 rounded-xl transition text-sm"
            >
              Back to login
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense>
      <MagicLinkHandler />
    </Suspense>
  );
}
