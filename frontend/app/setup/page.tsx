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
  const [user,        setUser]        = useState<any>(null);
  const [qr,          setQr]          = useState<string | null>(null);
  const [connected,   setConnected]   = useState(false);
  const [groups,      setGroups]      = useState<Group[]>([]);
  const [savedGroup,  setSavedGroup]  = useState<Group | null>(null);
  const [selected,    setSelected]    = useState<Group | null>(null);
  const [changing,    setChanging]    = useState(false);
  const [search,      setSearch]      = useState("");
  const [saving,      setSaving]      = useState(false);
  const [regenerating,setRegenerating]= useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  // Load saved group from settings on mount
  useEffect(() => {
    if (!user) return;
    api.get("/settings").then((res) => {
      const { group_jid, group_name } = res.data;
      if (group_jid && group_name) {
        setSavedGroup({ jid: group_jid, name: group_name });
      }
    }).catch(() => {});
  }, [user]);

  // Poll WhatsApp connection state from backend
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

  const handleRegenerateQr = async () => {
    setRegenerating(true);
    setQr(null);
    try {
      await api.post("/setup/reset-qr");
    } catch (e) {}
    setRegenerating(false);
  };

  const handleSaveGroup = async () => {
    if (!selected) return;
    setSaving(true);
    await api.patch("/settings", { group_jid: selected.jid, group_name: selected.name });
    setSaving(false);
    setSavedGroup(selected);
    setChanging(false);
    setSelected(null);
    setSearch("");
  };

  const handleChangeGroup = () => {
    setChanging(true);
    setSelected(null);
    setSearch("");
  };

  const filteredGroups = search.trim()
    ? groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
    : groups;

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-10 py-12 pb-24 sm:pb-12">
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
              <img src={qr} alt="WhatsApp QR Code" className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg bg-white p-2" />
              <p className="text-stone-500 text-xs text-center">
                Open WhatsApp → Linked Devices → Link a Device → scan this code
              </p>
              <button
                onClick={handleRegenerateQr}
                disabled={regenerating}
                className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2 transition disabled:opacity-40"
              >
                {regenerating ? "Clearing..." : "QR expired? Generate a new one"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-stone-500 text-sm">Waiting for QR code from bot...</p>
              </div>
              <button
                onClick={handleRegenerateQr}
                disabled={regenerating}
                className="self-start text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2 transition disabled:opacity-40"
              >
                {regenerating ? "Requesting..." : "Generate QR code"}
              </button>
            </div>
          )}
        </div>

        {/* Step 2 — Group selection */}
        {connected && (
          <div className="border border-stone-800 rounded-xl p-6">
            <h2 className="font-medium text-sm mb-4">Step 2 — Select expense group</h2>

            {/* Saved group display */}
            {savedGroup && !changing ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-emerald-400/30 bg-emerald-400/5">
                  <div>
                    <p className="text-sm text-stone-200">{savedGroup.name}</p>
                    <p className="text-xs text-stone-500 mt-0.5">Active group</p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <button
                  onClick={handleChangeGroup}
                  className="w-full text-sm text-stone-500 hover:text-stone-300 border border-stone-800 hover:border-stone-700 py-2.5 rounded-xl transition"
                >
                  Change group
                </button>
              </div>
            ) : groups.length === 0 ? (
              <p className="text-stone-500 text-sm">Loading your groups...</p>
            ) : (
              <div className="space-y-3">
                {/* Search */}
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search groups..."
                  className="w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-600"
                />

                {/* Group list */}
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {filteredGroups.length === 0 ? (
                    <p className="text-stone-500 text-sm px-1">No groups match &quot;{search}&quot;</p>
                  ) : (
                    filteredGroups.map((g) => (
                      <button
                        key={g.jid}
                        onClick={() => setSelected(g)}
                        className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                          selected?.jid === g.jid
                            ? "border-amber-400/50 bg-amber-400/8 text-amber-300"
                            : "border-stone-800 hover:border-stone-700 text-stone-300"
                        }`}
                      >
                        {g.name}
                      </button>
                    ))
                  )}
                </div>

                <div className="flex gap-2">
                  {changing && (
                    <button
                      onClick={() => { setChanging(false); setSelected(null); setSearch(""); }}
                      className="flex-1 border border-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-300 py-3 rounded-xl transition text-sm"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleSaveGroup}
                    disabled={!selected || saving}
                    className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold py-3 rounded-xl transition text-sm"
                  >
                    {saving ? "Saving..." : "Save group"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
