"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

interface LeaveRequest {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  requested_by_name: string | null;
  source: "dashboard" | "whatsapp";
  created_at: string;
}

const inputCls =
  "w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 text-sm placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-900/40 text-amber-400",
  approved: "bg-emerald-900/40 text-emerald-400",
  denied: "bg-red-900/40 text-red-400",
};

export default function ChoresLeavePage() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      try {
        const res = await api.get("/household");
        const myMember = res.data.members?.find((m: any) => m.user_id === session.user.id);
        const isSuperAdmin = session.user.user_metadata?.is_super_admin === true;
        setIsAdmin(myMember?.role === "admin" || isSuperAdmin);
      } catch {
        // non-fatal — approve/deny buttons just won't be usable
      }
    });
  }, [router]);

  const load = async () => {
    try {
      const res = await api.get("/tasks/leave-requests");
      setRequests(res.data);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post("/tasks/leave-requests", {
        start_date: startDate,
        end_date: endDate || startDate,
        reason: reason || null,
        source: "dashboard",
      });
      setRequests((prev) => [res.data, ...prev]);
      setShowForm(false);
      setStartDate(""); setEndDate(""); setReason("");
      toast.success("Leave request logged");
    } catch {
      toast.error("Failed to log leave request");
    } finally {
      setSaving(false);
    }
  };

  const handleDecide = async (id: string, status: "approved" | "denied") => {
    try {
      const res = await api.patch(`/tasks/leave-requests/${id}`, { status });
      setRequests((prev) => prev.map((r) => (r.id === id ? res.data : r)));
      toast.success(status === "approved" ? "Leave approved" : "Leave denied");
    } catch {
      toast.error("Failed to update leave request");
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
        >
          {showForm ? "Cancel" : "Log leave request"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-stone-900 border border-stone-800 rounded-xl p-5 mb-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-stone-500 block mb-1.5">Start date *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1.5">End date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1.5">Reason</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" className={inputCls} />
          </div>
          <button type="submit" disabled={saving || !startDate}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 min-h-[44px]">
            {saving ? "Saving…" : "Submit"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <p className="text-stone-500 text-sm">No leave requests yet.</p>
        </div>
      ) : (
        <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden divide-y divide-stone-800">
          {requests.map((r) => (
            <div key={r.id} className="px-5 py-3.5 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-stone-100">
                  {new Date(r.start_date).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                  {r.end_date !== r.start_date &&
                    ` – ${new Date(r.end_date).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}`}
                </p>
                {r.reason && <p className="text-xs text-stone-500 mt-0.5">{r.reason}</p>}
                {r.requested_by_name && <p className="text-xs text-stone-600 mt-0.5">Requested by {r.requested_by_name}</p>}
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[r.status]}`}>
                {r.status}
              </span>
              {isAdmin && r.status === "pending" && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleDecide(r.id, "approved")}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:text-emerald-400 hover:bg-emerald-900/30 transition-colors"
                    title="Approve"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDecide(r.id, "denied")}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                    title="Deny"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
