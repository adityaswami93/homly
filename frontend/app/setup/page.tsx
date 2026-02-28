"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";

interface Group {
  jid: string;
  name: string;
}

export default function Setup() {
  const [user,      setUser]      = useState<any>(null);
  const [qr,        setQr]        = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [groups,    setGroups]    = useState<Group[]>([]);
  const [selected,  setSelected]  = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  // Poll state from backend
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get("/setup/state");
        const { qr, connected, groups } = res.data;
        setQr(qr);
        setConnected(connected);
        setGroups(groups || []);
      } catch (e) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [user]);

  const handleSaveGroup = async () => {
    if (!selected) return;
    setSaving(true);
    await api.post("/setup/group", { group_name: selected });
    setSaving(false);
    setSaved(true);
  };

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-lg mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">WhatsApp Setup</h1>
        <p className="text-stone-500 text-sm mb-8">
          Connect your WhatsApp account and select the expense group.
        </p>

        {/* Step 1 — QR */}
        <div className="border border-stone-800 rounded-xl p-6 mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
            <h2 className="font-medium text-sm">
              {connected ? "WhatsApp connected" : "Step 1 — Scan QR code"}
            </h2>
          </div>

          {connected ? (
            <p className="text-stone-500 text-sm">
              Your WhatsApp account is linked and the bot is running.
            </p>
          ) : qr ? (
            <div className="flex flex-col items-center gap-4">
              <img src={qr} alt="WhatsApp QR Code" className="w-56 h-56 rounded-lg bg-white p-2" />
              <p className="text-stone-500 text-xs text-center">
                Open WhatsApp → Linked Devices → Link a Device → scan this code
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-stone-500 text-sm">Waiting for QR code from bot...</p>
            </div>
          )}
        </div>

        {/* Step 2 — Group selection */}
        {connected && (
          <div className="border border-stone-800 rounded-xl p-6">
            <h2 className="font-medium text-sm mb-4">Step 2 — Select expense group</h2>
            {groups.length === 0 ? (
              <p className="text-stone-500 text-sm">Loading your groups...</p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  {groups.map((g) => (
                    <button
                      key={g.jid}
                      onClick={() => setSelected(g.name)}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                        selected === g.name
                          ? "border-amber-400/50 bg-amber-400/8 text-amber-300"
                          : "border-stone-800 hover:border-stone-700 text-stone-300"
                      }`}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleSaveGroup}
                  disabled={!selected || saving || saved}
                  className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold py-3 rounded-xl transition text-sm"
                >
                  {saved ? "✓ Group saved" : saving ? "Saving..." : "Save group"}
                </button>
                {saved && (
                  <p className="text-emerald-400 text-xs text-center">
                    Bot will now monitor &quot;{selected}&quot; for receipt images.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
