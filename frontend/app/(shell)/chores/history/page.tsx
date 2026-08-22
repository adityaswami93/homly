"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";

interface ChoreLog {
  id: string;
  log_date: string;
  status: "done" | "skipped";
  completed_by_name: string | null;
  source: "dashboard" | "whatsapp";
  chores: { title: string; notes: string | null } | null;
}

const inputCls =
  "border border-stone-700 bg-stone-800 rounded-xl px-3 py-2 text-stone-200 text-sm focus:outline-none focus:border-emerald-600 min-h-[44px]";

export default function ChoresHistoryPage() {
  const [user, setUser] = useState<any>(null);
  const [logs, setLogs] = useState<ChoreLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      const res = await api.get("/tasks/history", { params });
      setLogs(res.data);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs text-stone-500 block mb-1.5">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1.5">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
        </div>
        <button
          onClick={load}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
        >
          Filter
        </button>
      </div>

      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-16 text-center">
          <p className="text-stone-500 text-sm">No completed tasks yet.</p>
        </div>
      ) : (
        <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden divide-y divide-stone-800">
          {logs.map((log) => (
            <div key={log.id} className="px-5 py-3.5 flex items-center gap-3">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  log.status === "done" ? "bg-emerald-900/40 text-emerald-400" : "bg-amber-900/40 text-amber-400"
                }`}
              >
                {log.status === "done" ? "Done" : "Skipped"}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-stone-100">{log.chores?.title ?? "—"}</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  {new Date(log.log_date).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}
                  {log.completed_by_name && ` · ${log.completed_by_name}`}
                  {log.source === "whatsapp" && " · via WhatsApp"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
