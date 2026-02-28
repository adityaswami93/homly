"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [waitlisted, setWaitlisted] = useState(false);
  const router = useRouter();

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      router.push("/dashboard");
    }
    setLoading(false);
  };

  const handleWaitlist = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase
      .from("waitlist")
      .insert({ email })
    if (error && error.code !== "23505") {
      setError("Something went wrong. Please try again.");
    } else {
      setWaitlisted(true);
    }
    setLoading(false);
  };

  if (waitlisted) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto mb-6">
            <span className="text-emerald-400 text-xl">✓</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">You're on the list</h1>
          <p className="text-white/40 text-sm leading-relaxed">
            Thanks for your interest in Finclaro. We'll be in touch when your access is ready.
          </p>
          <button
            onClick={() => { setWaitlisted(false); setIsSignUp(false); setEmail(""); }}
            className="mt-8 text-sm text-white/30 hover:text-white/60 transition"
          >
            ← Back to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="font-semibold tracking-tight text-lg">Finclaro</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight mb-1">
          {isSignUp ? "Request access" : "Welcome back"}
        </h1>
        <p className="text-white/40 text-sm mb-8">
          {isSignUp
            ? "Join the waitlist and we'll be in touch soon"
            : "Sign in to your research assistant"}
        </p>

        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/50 transition"
          />

          {!isSignUp && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/50 transition"
            />
          )}

          {error && <p className="text-red-400 text-sm px-1">{error}</p>}

          <button
            onClick={isSignUp ? handleWaitlist : handleLogin}
            disabled={loading}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Loading..." : isSignUp ? "Join waitlist" : "Sign in"}
          </button>
        </div>

        <p className="text-center text-sm text-white/30 mt-6">
          {isSignUp ? "Already have access?" : "Don't have an account?"}{" "}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(""); }}
            className="text-white/60 hover:text-white transition underline underline-offset-2"
          >
            {isSignUp ? "Sign in" : "Request access"}
          </button>
        </p>
      </div>
    </main>
  );
}