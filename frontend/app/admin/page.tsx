"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";

interface Member { user_id: string; role: string; }
interface Household {
  id: string;
  name: string;
  plan: string;
  active: boolean;
  created_at: string;
  member_count: number;
  receipt_count: number;
  members: Member[];
}
interface Invite {
  id: string;
  email: string;
  household_id: string | null;
  role: string;
  accepted: boolean;
  created_at: string;
  expires_at: string;
}

export default function AdminPage() {
  const [user,        setUser]        = useState<any>(null);
  const [households,  setHouseholds]  = useState<Household[]>([]);
  const [invites,     setInvites]     = useState<Invite[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteHousehold, setInviteHousehold] = useState("");
  const [inviteRole,  setInviteRole]  = useState("admin");
  const [sending,     setSending]     = useState(false);
  const [inviteSent,  setInviteSent]  = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      const meta = session.user.user_metadata;
      if (!meta?.is_super_admin) { router.push("/dashboard"); return; }
      setUser(session.user);
    });
  }, [router]);

  const load = async () => {
    setLoading(true);
    const [h, i] = await Promise.all([
      api.get("/admin/households"),
      api.get("/admin/invites"),
    ]);
    setHouseholds(h.data);
    setInvites(i.data);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setSending(true);
    setInviteSent(false);
    try {
      await api.post("/admin/invite", {
        email:        inviteEmail,
        household_id: inviteHousehold || null,
        role:         inviteRole,
      });
      setInviteSent(true);
      setInviteEmail("");
      setInviteHousehold("");
      await load();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await api.patch(`/admin/households/${id}`, { active: !active });
    await load();
  };

  const handleDeleteInvite = async (id: string) => {
    await api.delete(`/admin/invites/${id}`);
    await load();
  };

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0f0e0c] text-stone-100">
      <Navbar user={user} />
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
          <span className="text-xs bg-amber-400/15 border border-amber-400/30 text-amber-300 px-2 py-0.5 rounded-full">
            Platform view
          </span>
        </div>

        {/* Invite */}
        <div className="border border-stone-800 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-medium text-stone-300 mb-4">Invite User</h2>
          <div className="flex gap-3 flex-wrap">
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 min-w-48 bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-amber-400/60"
            />
            <select
              value={inviteHousehold}
              onChange={(e) => setInviteHousehold(e.target.value)}
              className="bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm focus:outline-none focus:border-amber-400/60"
            >
              <option value="">New household</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="bg-stone-900 border border-stone-700 rounded-xl px-4 py-2.5 text-stone-200 text-sm focus:outline-none focus:border-amber-400/60"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={sending || !inviteEmail}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-900 font-semibold px-5 py-2.5 rounded-xl transition text-sm"
            >
              {inviteSent ? "✓ Sent" : sending ? "Sending..." : "Send invite"}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-stone-600 text-sm">Loading...</p>
        ) : (
          <>
            {/* Households */}
            <div className="mb-8">
              <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-3">
                Households ({households.length})
              </h2>
              <div className="space-y-2">
                {households.map((h) => (
                  <div key={h.id} className="border border-stone-800 rounded-xl px-4 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-stone-200 font-medium text-sm">{h.name}</p>
                          {!h.active && (
                            <span className="text-xs bg-red-500/15 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded">
                              inactive
                            </span>
                          )}
                          <span className="text-xs bg-stone-800 text-stone-500 px-1.5 py-0.5 rounded">
                            {h.plan}
                          </span>
                        </div>
                        <p className="text-stone-600 text-xs mt-0.5">
                          {h.member_count} member{h.member_count !== 1 ? "s" : ""} · {h.receipt_count} receipts · joined {new Date(h.created_at).toLocaleDateString("en-SG")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(h.id, h.active)}
                        className="text-xs border border-stone-700 hover:border-stone-600 text-stone-500 hover:text-stone-300 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {h.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                ))}
                {households.length === 0 && (
                  <p className="text-stone-600 text-sm py-4">No households yet.</p>
                )}
              </div>
            </div>

            {/* Pending invites */}
            <div>
              <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-3">
                Invites ({invites.filter(i => !i.accepted).length} pending)
              </h2>
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="border border-stone-800 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-stone-300 text-sm">{inv.email}</p>
                      <p className="text-stone-600 text-xs mt-0.5">
                        {inv.role} · {inv.household_id ? "existing household" : "new household"} · {inv.accepted ? "✓ accepted" : `expires ${new Date(inv.expires_at).toLocaleDateString("en-SG")}`}
                      </p>
                    </div>
                    {!inv.accepted && (
                      <button
                        onClick={() => handleDeleteInvite(inv.id)}
                        className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
                {invites.length === 0 && (
                  <p className="text-stone-600 text-sm py-4">No invites sent yet.</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
