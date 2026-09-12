"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface SetupState {
  connected: boolean;
  qr: string | null;
  groups: { id: string; name: string }[];
  group_jid: string | null;
  group_name: string | null;
  // False for non-admins. Pairing the bot affects every household sharing it,
  // so the backend withholds the QR and the group list from members and says
  // so here rather than returning a 403 and blanking the page.
  can_manage: boolean;
}

export default function SetupPage() {
  const [user, setUser] = useState<any>(null);
  const [state, setState] = useState<SetupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const fetchState = async () => {
    try {
      const res = await api.get("/setup/state");
      setState(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchState();
    pollRef.current = setInterval(fetchState, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user]);

  // Stop polling once connected
  useEffect(() => {
    if (state?.connected && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [state?.connected]);

  const handleResetQR = async () => {
    setResetting(true);
    try {
      await api.post("/setup/reset-qr");
      setState((prev) => prev ? { ...prev, qr: null } : prev);
    } catch {
      toast.error("Failed to request new QR code");
    } finally {
      setResetting(false);
    }
  };

  const handleSelectGroup = async (group: { id: string; name: string }) => {
    setSaving(true);
    try {
      await api.patch("/settings", { group_jid: group.id, group_name: group.name });
      setState((prev) => prev ? { ...prev, group_jid: group.id, group_name: group.name } : prev);
      toast.success(`Connected to "${group.name}"`);
    } catch {
      toast.error("Failed to save group");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  const filteredGroups = (state?.groups ?? []).filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto">
      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : (
        <div className="space-y-4">

          {/* Connection status + QR */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`w-3 h-3 rounded-full shrink-0 ${
                  state?.connected ? "bg-emerald-500 animate-none" : "bg-stone-600"
                }`}
              />
              <h2 className="text-sm font-semibold text-stone-100">
                {state?.connected ? "WhatsApp connected" : "WhatsApp disconnected"}
              </h2>
            </div>

            {state?.connected && state.group_name && (
              <div className="flex items-center gap-2 text-sm text-stone-400 mb-4">
                <span>📲</span>
                <span>
                  Connected to <strong className="text-stone-200">{state.group_name}</strong>
                </span>
              </div>
            )}

            {!state?.connected && !state?.can_manage && (
              <div className="text-center py-6">
                <p className="text-sm text-stone-400">
                  WhatsApp isn&apos;t connected yet. Ask a household admin to set it up.
                </p>
              </div>
            )}

            {!state?.connected && state?.can_manage && (
              <>
                {state?.qr ? (
                  <div className="text-center mb-4">
                    <p className="text-sm text-stone-400 mb-4">
                      Scan this QR code in WhatsApp → Linked Devices → Link a device
                    </p>
                    <div className="inline-block p-3 bg-white border-2 border-stone-300 rounded-xl">
                      <img src={state.qr} alt="WhatsApp QR code" className="w-56 h-56" />
                    </div>
                    <p className="text-xs text-stone-500 mt-3">
                      Waiting for scan…
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-6 mb-4">
                    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm text-stone-400">
                      {resetting ? "Generating new QR code…" : "Waiting for bot to start…"}
                    </p>
                  </div>
                )}

                <button
                  onClick={handleResetQR}
                  disabled={resetting}
                  className="w-full py-2.5 rounded-xl border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  {resetting ? "Requesting…" : "Generate new QR code"}
                </button>
              </>
            )}
          </div>

          {/* Group selection */}
          {state?.connected && state.groups.length > 0 && (
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-stone-100 mb-1">Select WhatsApp Group</h2>
              <p className="text-xs text-stone-500 mb-3">
                Choose the group where receipts are sent.
              </p>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search groups…"
                className="w-full border border-stone-700 bg-stone-800 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 mb-3 min-h-[44px] text-base"
              />
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {filteredGroups.map((group) => {
                  const isSelected = state.group_jid === group.id;
                  return (
                    <button
                      key={group.id}
                      onClick={() => handleSelectGroup(group)}
                      disabled={saving}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors min-h-[44px] flex items-center justify-between ${
                        isSelected
                          ? "bg-emerald-900/30 border border-emerald-800 text-emerald-300"
                          : "border border-stone-800 text-stone-300 hover:bg-stone-800"
                      }`}
                    >
                      <span>{group.name}</span>
                      {isSelected && (
                        <span className="text-emerald-400 text-xs font-medium">✓ Selected</span>
                      )}
                    </button>
                  );
                })}
                {filteredGroups.length === 0 && (
                  <p className="text-xs text-stone-500 px-3 py-2">No groups match.</p>
                )}
              </div>
            </div>
          )}

          {state?.connected && state.groups.length === 0 && (
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 text-center text-sm text-stone-400">
              No WhatsApp groups found. Make sure this WhatsApp account is a member of your household group.
            </div>
          )}
        </div>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
