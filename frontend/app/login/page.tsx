"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

type Mode = "login" | "forgot" | "magic";

export default function Login() {
  const [mode,     setMode]     = useState<Mode>("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [sent,     setSent]     = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  const reset = (newMode: Mode) => {
    setMode(newMode);
    setError("");
    setSent(false);
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // On success, browser navigates away — no need to setLoading(false)
  };

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/household");
      router.push(res.data?.id ? "/expenses" : "/onboarding");
    } catch {
      router.push("/expenses");
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!email) { setError("Enter your email address"); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
      toast.success("Reset link sent — check your inbox");
    }
    setLoading(false);
  };

  const handleMagicLink = async () => {
    if (!email) { setError("Enter your email address"); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/magic-link`,
      },
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
      toast.success("Magic link sent — check your inbox");
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
            <span className="text-sm font-bold text-white">H</span>
          </div>
          <span className="font-semibold tracking-tight text-lg">Homly</span>
        </div>

        {/* ── Password login ── */}
        {mode === "login" && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Welcome back</h1>
            <p className="text-stone-400 text-sm mb-8">Sign in to your household dashboard</p>
            <div className="space-y-3">
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-stone-100 disabled:opacity-40 text-stone-900 font-semibold py-3 rounded-xl transition text-sm"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-stone-800" />
                <span className="text-stone-600 text-xs">or</span>
                <div className="flex-1 h-px bg-stone-800" />
              </div>

              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/60 transition text-sm"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/60 transition text-sm"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition text-sm"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>

              <button
                onClick={() => reset("magic")}
                className="w-full border border-stone-700 hover:border-stone-600 text-stone-300 hover:text-stone-100 py-3 rounded-xl transition text-sm"
              >
                Sign in with magic link
              </button>

              <button
                onClick={() => reset("forgot")}
                className="w-full text-center text-xs text-stone-600 hover:text-stone-400 transition-colors py-1"
              >
                Forgot password?
              </button>
            </div>
          </>
        )}

        {/* ── Forgot password ── */}
        {mode === "forgot" && (
          <>
            <button
              onClick={() => reset("login")}
              className="text-stone-600 hover:text-stone-400 text-sm mb-6 flex items-center gap-1 transition-colors"
            >
              ← Back to login
            </button>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Reset password</h1>
            <p className="text-stone-400 text-sm mb-8">
              Enter your email and we will send you a reset link.
            </p>
            {sent ? (
              <div className="border border-stone-800 rounded-xl p-5 text-center">
                <p className="text-emerald-400 font-medium mb-1">Check your email</p>
                <p className="text-stone-500 text-sm">
                  We sent a reset link to <span className="text-stone-300">{email}</span>
                </p>
                <button
                  onClick={() => { setSent(false); setEmail(""); }}
                  className="text-xs text-stone-600 hover:text-stone-400 mt-4 transition-colors"
                >
                  Send again
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleForgotPassword()}
                  className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/60 transition text-sm"
                />
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition text-sm"
                >
                  {loading ? "Sending..." : "Send reset link"}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Magic link ── */}
        {mode === "magic" && (
          <>
            <button
              onClick={() => reset("login")}
              className="text-stone-600 hover:text-stone-400 text-sm mb-6 flex items-center gap-1 transition-colors"
            >
              ← Back to login
            </button>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Magic link</h1>
            <p className="text-stone-400 text-sm mb-8">
              We will send a one-click sign in link to your email. No password needed.
            </p>
            {sent ? (
              <div className="border border-stone-800 rounded-xl p-5 text-center">
                <p className="text-emerald-400 font-medium mb-1">Check your email</p>
                <p className="text-stone-500 text-sm">
                  We sent a magic link to <span className="text-stone-300">{email}</span>
                </p>
                <p className="text-stone-600 text-xs mt-2">Link expires in 1 hour</p>
                <button
                  onClick={() => { setSent(false); setEmail(""); }}
                  className="text-xs text-stone-600 hover:text-stone-400 mt-4 transition-colors"
                >
                  Send again
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleMagicLink()}
                  className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/60 transition text-sm"
                />
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button
                  onClick={handleMagicLink}
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition text-sm"
                >
                  {loading ? "Sending..." : "Send magic link"}
                </button>
              </div>
            )}
          </>
        )}

        <p className="text-stone-600 text-xs mt-8 text-center">
          <Link href="/" className="hover:text-stone-400 transition-colors">
            ← Back to home
          </Link>
        </p>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
