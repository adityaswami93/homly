"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function Login() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) return;
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

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center">
            <span className="text-sm font-bold text-stone-900">H</span>
          </div>
          <span className="font-semibold tracking-tight text-lg">Homly</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Welcome back</h1>
        <p className="text-stone-400 text-sm mb-8">Sign in to your household dashboard</p>
        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-amber-400/60 transition text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-amber-400/60 transition text-sm"
          />
          {error && <p className="text-red-400 text-sm px-1">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold py-3 rounded-xl transition text-sm"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>
        <p className="text-stone-600 text-xs mt-8 text-center">
          Homly is a private household tool.
        </p>
      </div>
    </main>
  );
}
