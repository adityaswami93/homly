"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface Member {
  user_id: string;
  role: "admin" | "member";
  email?: string;
  joined_at?: string;
}

interface Household {
  id: string;
  name: string;
  members: Member[];
}

export default function MembersPage() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      try {
        const res = await api.get("/household");
        setHousehold(res.data);
        const myMember = res.data.members?.find((m: any) => m.user_id === session.user.id);
        const isSuperAdmin = session.user.user_metadata?.is_super_admin === true;
        setIsAdmin(myMember?.role === "admin" || isSuperAdmin);
      } catch {
        router.push("/onboarding");
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.post("/household/members", { email: inviteEmail.trim() });
      toast.success(`Invite sent to ${inviteEmail}`);
      setInviteEmail("");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await api.patch(`/household/members/${userId}`, { role });
      setHousehold((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.map((m) =>
                m.user_id === userId ? { ...m, role: role as "admin" | "member" } : m
              ),
            }
          : prev
      );
      toast.success("Role updated");
    } catch {
      toast.error("Failed to update role");
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm("Remove this member from the household?")) return;
    try {
      await api.delete(`/household/members/${userId}`);
      setHousehold((prev) =>
        prev
          ? { ...prev, members: prev.members.filter((m) => m.user_id !== userId) }
          : prev
      );
      toast.success("Member removed");
    } catch {
      toast.error("Failed to remove member");
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
      ) : !household ? (
        <div className="text-gray-400 text-sm">No household found.</div>
      ) : (
        <>
          {/* Household info */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Household</p>
            <h2 className="text-lg font-semibold text-gray-900">{household.name}</h2>
          </div>

          {/* Members list */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-4">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h3 className="text-sm font-medium text-gray-700">
                Members ({household.members.length})
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {household.members.map((member) => {
                const isMe = member.user_id === user.id;
                return (
                  <div key={member.user_id} className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shrink-0">
                        <span className="text-sm font-medium text-gray-600">
                          {(member.email || member.user_id).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {member.email || member.user_id.slice(0, 8) + "…"}
                          {isMe && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {member.joined_at
                            ? new Date(member.joined_at).toLocaleDateString("en-SG", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "Joined"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdmin && !isMe ? (
                        <>
                          <select
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:border-emerald-400 min-h-[36px] text-base"
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            onClick={() => handleRemove(member.user_id)}
                            className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 min-h-[36px]"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            member.role === "admin"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {member.role}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Invite */}
          {isAdmin && (
            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Invite a member</h3>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                  placeholder="email@example.com"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-emerald-400 min-h-[44px] text-base"
                />
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] shrink-0"
                >
                  {inviting ? "Sending…" : "Invite"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                They will receive an email with a link to join your household.
              </p>
            </div>
          )}
        </>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
