"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

type Tab = "evals" | "waitlist" | "system" | "logs";

interface EvalSummary {
  run_id: string;
  created_at: string;
  questions: number;
  avg_overall: number;
  avg_relevance: number;
  avg_groundedness: number;
  avg_source_quality: number;
  avg_confidence_accuracy: number;
}

interface EvalDetail {
  id: string;
  question_id: string;
  question: string;
  difficulty: string;
  overall_score: number;
  relevance_score: number;
  groundedness_score: number;
  source_quality_score: number;
  confidence_accuracy_score: number;
  confidence: string;
  iterations: number;
  notes: string;
}

interface WaitlistEntry {
  id: string;
  email: string;
  created_at: string;
}

interface LogEntry {
  id: string;
  user_id: string;
  question: string;
  answer: string;
  created_at: string;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 4.5
      ? "text-emerald-400 border-emerald-400/20 bg-emerald-400/10"
      : score >= 3.5
      ? "text-yellow-400 border-yellow-400/20 bg-yellow-400/10"
      : "text-red-400 border-red-400/20 bg-red-400/10";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export default function AdminDashboard() {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>("evals");
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
      } else if (session.user.email !== ADMIN_EMAIL) {
        router.push("/dashboard");
      } else {
        setUser(session.user);
      }
    });
  }, [router]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "evals", label: "Evals" },
    { key: "waitlist", label: "Waitlist" },
    { key: "system", label: "System" },
    { key: "logs", label: "Logs" },
  ];

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <Navbar user={user} isAdmin />

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Admin</h1>
        <p className="text-white/40 mb-8">System management and monitoring.</p>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-8 border-b border-white/5 pb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium transition rounded-t-lg ${
                activeTab === tab.key
                  ? "text-emerald-400 border-b-2 border-emerald-400 bg-emerald-400/5"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "evals" && <EvalsTab />}
        {activeTab === "waitlist" && <WaitlistTab />}
        {activeTab === "system" && <SystemTab />}
        {activeTab === "logs" && <LogsTab />}
      </div>
    </main>
  );
}

/* ─── EVALS TAB ──────────────────────────────────────────────────────── */

function EvalsTab() {
  const [runs, setRuns] = useState<EvalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, EvalDetail[]>>({});
  const [evalLabel, setEvalLabel] = useState("");
  const [showEvalForm, setShowEvalForm] = useState(false);
  const [runningEval, setRunningEval] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/evals");
      setRuns(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const toggleExpand = async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(runId);
    if (!details[runId]) {
      try {
        const res = await api.get(`/admin/evals/${runId}`);
        setDetails((prev) => ({ ...prev, [runId]: res.data }));
      } catch (e) {
        console.error(e);
      }
    }
  };

  const runEval = async () => {
    setRunningEval(true);
    try {
      await api.post("/eval", { label: evalLabel || undefined });
      setShowEvalForm(false);
      setEvalLabel("");
      await fetchRuns();
    } catch (e) {
      console.error(e);
    } finally {
      setRunningEval(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium">Eval Runs</h2>
        {!showEvalForm ? (
          <button
            onClick={() => setShowEvalForm(true)}
            className="text-sm bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-2 rounded-lg transition"
          >
            Run New Eval
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {runningEval ? (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Spinner />
                Running eval... this takes 2-3 minutes
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={evalLabel}
                  onChange={(e) => setEvalLabel(e.target.value)}
                  placeholder="Label (optional)"
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/40"
                />
                <button
                  onClick={runEval}
                  className="text-sm bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-1.5 rounded-lg transition"
                >
                  Confirm
                </button>
                <button
                  onClick={() => { setShowEvalForm(false); setEvalLabel(""); }}
                  className="text-sm text-white/40 hover:text-white/70 px-2 py-1.5 transition"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {runs.length === 0 ? (
        <EmptyState message="No eval runs yet. Run your first evaluation to see results here." />
      ) : (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-left">
                <th className="px-4 py-3 font-medium">Run ID</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-center">Questions</th>
                <th className="px-4 py-3 font-medium text-center">Overall</th>
                <th className="px-4 py-3 font-medium text-center">Relevance</th>
                <th className="px-4 py-3 font-medium text-center">Grounded</th>
                <th className="px-4 py-3 font-medium text-center">Source</th>
                <th className="px-4 py-3 font-medium text-center">Conf Acc</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Fragment key={run.run_id}>
                  <tr
                    onClick={() => toggleExpand(run.run_id)}
                    className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-white/70">
                      {run.run_id}
                    </td>
                    <td className="px-4 py-3 text-white/50">
                      {new Date(run.created_at).toLocaleDateString("en-SG", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-center text-white/50">{run.questions}</td>
                    <td className="px-4 py-3 text-center"><ScoreBadge score={run.avg_overall} /></td>
                    <td className="px-4 py-3 text-center"><ScoreBadge score={run.avg_relevance} /></td>
                    <td className="px-4 py-3 text-center"><ScoreBadge score={run.avg_groundedness} /></td>
                    <td className="px-4 py-3 text-center"><ScoreBadge score={run.avg_source_quality} /></td>
                    <td className="px-4 py-3 text-center"><ScoreBadge score={run.avg_confidence_accuracy} /></td>
                  </tr>
                  {expandedRun === run.run_id && (
                    <tr key={`${run.run_id}-detail`}>
                      <td colSpan={8} className="px-4 py-4 bg-white/[0.02]">
                        {!details[run.run_id] ? (
                          <div className="flex justify-center py-4"><Spinner /></div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-white/30 text-left">
                                <th className="px-3 py-2 font-medium">Question</th>
                                <th className="px-3 py-2 font-medium">Difficulty</th>
                                <th className="px-3 py-2 font-medium text-center">Overall</th>
                                <th className="px-3 py-2 font-medium text-center">Rel</th>
                                <th className="px-3 py-2 font-medium text-center">Grd</th>
                                <th className="px-3 py-2 font-medium text-center">Src</th>
                                <th className="px-3 py-2 font-medium text-center">Conf</th>
                                <th className="px-3 py-2 font-medium text-center">Confidence</th>
                                <th className="px-3 py-2 font-medium text-center">Iters</th>
                                <th className="px-3 py-2 font-medium">Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {details[run.run_id].map((d) => (
                                <tr key={d.id} className="border-t border-white/5">
                                  <td className="px-3 py-2 text-white/60 max-w-[200px] truncate">
                                    {d.question}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                                      d.difficulty === "easy"
                                        ? "bg-emerald-400/10 text-emerald-400"
                                        : d.difficulty === "medium"
                                        ? "bg-yellow-400/10 text-yellow-400"
                                        : "bg-red-400/10 text-red-400"
                                    }`}>
                                      {d.difficulty}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center"><ScoreBadge score={d.overall_score} /></td>
                                  <td className="px-3 py-2 text-center"><ScoreBadge score={d.relevance_score} /></td>
                                  <td className="px-3 py-2 text-center"><ScoreBadge score={d.groundedness_score} /></td>
                                  <td className="px-3 py-2 text-center"><ScoreBadge score={d.source_quality_score} /></td>
                                  <td className="px-3 py-2 text-center"><ScoreBadge score={d.confidence_accuracy_score} /></td>
                                  <td className="px-3 py-2 text-center text-white/50">{d.confidence}</td>
                                  <td className="px-3 py-2 text-center text-white/50">{d.iterations}</td>
                                  <td className="px-3 py-2 text-white/40 max-w-[200px] truncate">{d.notes}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── WAITLIST TAB ───────────────────────────────────────────────────── */

function WaitlistTab() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchWaitlist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/waitlist");
      setEntries(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWaitlist();
  }, [fetchWaitlist]);

  const deleteEntry = async (id: string) => {
    if (!confirm("Remove this email from the waitlist?")) return;
    setDeleting(id);
    try {
      await api.delete(`/admin/waitlist/${id}`);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium">Waitlist</h2>
        <span className="text-sm text-white/40">
          {entries.length} {entries.length === 1 ? "email" : "emails"} on waitlist
        </span>
      </div>

      {entries.length === 0 ? (
        <EmptyState message="No waitlist entries yet." />
      ) : (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-left">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5">
                  <td className="px-4 py-3 text-white/70">{entry.email}</td>
                  <td className="px-4 py-3 text-white/40">
                    {new Date(entry.created_at).toLocaleDateString("en-SG", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteEntry(entry.id)}
                      disabled={deleting === entry.id}
                      className="text-xs text-red-400/70 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 px-3 py-1 rounded-lg transition disabled:opacity-40"
                    >
                      {deleting === entry.id ? "..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── SYSTEM TAB ─────────────────────────────────────────────────────── */

function SystemTab() {
  return (
    <div>
      <h2 className="text-lg font-medium mb-6">System Actions</h2>
      <div className="grid md:grid-cols-3 gap-4">
        <SystemCard
          title="News Ingestion"
          description="Fetch latest financial news from NewsAPI and embed new articles"
          buttonLabel="Run Ingestion"
          endpoint="/ingest"
          storageKey="finclaro_last_ingest"
        />
        <SystemCard
          title="Morning Digest"
          description="Send digest emails to users scheduled for the current SGT hour"
          buttonLabel="Send Digest"
          endpoint="/digest"
          storageKey="finclaro_last_digest"
        />
        <SystemCard
          title="Watchlist Digest"
          description="Send weekly watchlist digest to all users with tracked symbols"
          buttonLabel="Send Digest"
          endpoint="/watchlist-digest"
          storageKey="finclaro_last_watchlist_digest"
        />
      </div>
    </div>
  );
}

function SystemCard({
  title,
  description,
  buttonLabel,
  endpoint,
  storageKey,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  endpoint: string;
  storageKey: string;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) setLastRun(stored);
  }, [storageKey]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      await api.post(endpoint);
      setResult("success");
      const now = new Date().toLocaleString("en-SG");
      localStorage.setItem(storageKey, now);
      setLastRun(now);
    } catch (e) {
      console.error(e);
      setResult("error");
    } finally {
      setRunning(false);
      setTimeout(() => setResult(null), 3000);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col">
      <h3 className="font-medium mb-1">{title}</h3>
      <p className="text-sm text-white/40 mb-6 flex-1">{description}</p>
      <button
        onClick={run}
        disabled={running}
        className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black text-sm font-semibold px-4 py-2.5 rounded-lg transition w-full flex items-center justify-center gap-2"
      >
        {running ? <><Spinner /> Running...</> : buttonLabel}
      </button>
      {result === "success" && (
        <p className="text-xs text-emerald-400 mt-2 text-center">Success</p>
      )}
      {result === "error" && (
        <p className="text-xs text-red-400 mt-2 text-center">Failed</p>
      )}
      {lastRun && (
        <p className="text-xs text-white/20 mt-2 text-center">Last run: {lastRun}</p>
      )}
    </div>
  );
}

/* ─── LOGS TAB ───────────────────────────────────────────────────────── */

function LogsTab() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.get("/admin/logs");
      setLogs(res.data);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium">Recent Queries</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/20">
            Last refreshed: {lastRefreshed.toLocaleTimeString("en-SG")}
          </span>
          <button
            onClick={fetchLogs}
            className="text-xs text-white/40 hover:text-white/70 border border-white/10 hover:border-white/20 px-3 py-1 rounded-lg transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <EmptyState message="No queries logged yet." />
      ) : (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-left">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">User ID</th>
                <th className="px-4 py-3 font-medium">Question</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-white/5">
                  <td className="px-4 py-3 text-white/40 whitespace-nowrap font-mono text-xs">
                    {new Date(log.created_at).toLocaleString("en-SG", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-white/40 font-mono text-xs">
                    {log.user_id.substring(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-white/60">
                    {log.question.length > 80
                      ? log.question.substring(0, 80) + "..."
                      : log.question}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── SHARED COMPONENTS ──────────────────────────────────────────────── */

function Spinner() {
  return (
    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
  );
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="flex items-center gap-2 text-white/30">
        <Spinner />
        <span className="text-sm">Loading...</span>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="border border-white/10 rounded-xl p-12 text-center">
      <p className="text-white/30 text-sm">{message}</p>
    </div>
  );
}
