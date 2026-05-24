"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";

interface Source {
  agent: string;
  intent: string;
  handled: boolean;
  data: Record<string, any>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
}

const EXAMPLES = [
  "How much did we spend on groceries last month?",
  "What are our top vendors this week?",
  "How has milk price changed over time?",
  "What insurance policies are renewing soon?",
  "How much do we pay in premiums?",
  "Summarise our spending last 30 days",
];

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return `SGD ${Number(n).toFixed(2)}`;
}

// ── Source data cards ─────────────────────────────────────────────────────────

function SourceCard({ source }: { source: Source }) {
  const { intent, data } = source;

  if (intent === "spend_by_keyword") {
    const items: any[] = data.items ?? [];
    if (!items.length) return null;
    const shown = items.slice(0, 8);
    return (
      <DataTable
        label={data.keyword ? `Purchases: ${data.keyword}` : "Purchases"}
        rows={shown.map((item) => ({
          primary: item.canonical_name || item.name || "—",
          secondary: [item.receipt_date, item.vendor].filter(Boolean).join(" · "),
          value: fmt(item.unit_price ?? item.line_total),
        }))}
        overflow={items.length > 8 ? items.length - 8 : 0}
      />
    );
  }

  if (intent === "top_items") {
    const items: any[] = data.items ?? [];
    if (!items.length) return null;
    return (
      <BarList
        label="Top Items"
        rows={items.map((i) => ({ label: i.name, value: i.total, sub: `×${i.count}` }))}
      />
    );
  }

  if (intent === "top_vendors") {
    const vendors: any[] = data.vendors ?? [];
    if (!vendors.length) return null;
    return (
      <BarList
        label="Top Vendors"
        rows={vendors.map((v) => ({
          label: v.vendor,
          value: v.total,
          sub: `${v.trips} trip${v.trips !== 1 ? "s" : ""}`,
        }))}
      />
    );
  }

  if (intent === "spend_by_category") {
    const totals: Record<string, number> = data.category_totals ?? {};
    const entries = Object.entries(totals).sort(([, a], [, b]) => b - a);
    if (!entries.length) return null;
    return (
      <BarList
        label="By Category"
        rows={entries.map(([cat, amount]) => ({
          label: cat.charAt(0).toUpperCase() + cat.slice(1),
          value: amount,
        }))}
      />
    );
  }

  if (intent === "price_trend") {
    const prices: any[] = data.prices ?? [];
    if (!prices.length) return null;
    const shown = prices.slice(-8);
    return (
      <DataTable
        label="Price History"
        rows={shown.map((p) => ({
          primary: p.receipt_date,
          secondary: p.vendor || "—",
          value: fmt(p.unit_price),
        }))}
      />
    );
  }

  if (intent === "spend_summary") {
    if (!data.total && data.total !== 0) return null;
    return (
      <div className="mt-1.5 rounded-lg border border-stone-800 overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-stone-800">
          {[
            { label: "Total", value: fmt(data.total) },
            { label: "Own", value: fmt(data.own) },
            { label: "Reimburse", value: fmt(data.reimbursable) },
          ].map(({ label, value }) => (
            <div key={label} className="px-3 py-2.5 text-center">
              <p className="text-stone-600 text-xs mb-0.5">{label}</p>
              <p className="text-stone-200 text-xs font-mono">{value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (intent === "list_policies" || intent === "renewal_check") {
    const policies: any[] = data.policies ?? [];
    if (!policies.length) return null;
    return (
      <DataTable
        label="Policies"
        rows={policies.map((p) => ({
          primary: p.provider,
          secondary: [
            p.coverage_type,
            p.insured_person,
            p.renewal_date ? `renews ${p.renewal_date}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          value: p.premium_amount ? fmt(p.premium_amount) : "",
        }))}
      />
    );
  }

  if (intent === "premium_spend") {
    if (!data.annual_total && data.annual_total !== 0) return null;
    return (
      <div className="mt-1.5 rounded-lg border border-stone-800 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-stone-800">
          {[
            { label: "Annual", value: fmt(data.annual_total) },
            { label: "Monthly", value: fmt(data.monthly_total) },
          ].map(({ label, value }) => (
            <div key={label} className="px-3 py-2.5 text-center">
              <p className="text-stone-600 text-xs mb-0.5">{label}</p>
              <p className="text-stone-200 text-xs font-mono">{value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function DataTable({
  label,
  rows,
  overflow = 0,
}: {
  label: string;
  rows: { primary: string; secondary?: string; value: string }[];
  overflow?: number;
}) {
  return (
    <div className="mt-1.5 rounded-lg border border-stone-800 overflow-hidden text-xs">
      <div className="bg-stone-900/50 px-3 py-1.5 border-b border-stone-800">
        <span className="text-stone-600 uppercase tracking-wider">{label}</span>
      </div>
      <div className="divide-y divide-stone-800/40">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2 gap-3">
            <div className="min-w-0">
              <p className="text-stone-300 truncate">{row.primary}</p>
              {row.secondary && (
                <p className="text-stone-600 truncate mt-0.5">{row.secondary}</p>
              )}
            </div>
            {row.value && (
              <span className="text-stone-300 font-mono shrink-0">{row.value}</span>
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div className="px-3 py-2 text-stone-700">+{overflow} more</div>
        )}
      </div>
    </div>
  );
}

function BarList({
  label,
  rows,
}: {
  label: string;
  rows: { label: string; value: number; sub?: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="mt-1.5 rounded-lg border border-stone-800 overflow-hidden text-xs">
      <div className="bg-stone-900/50 px-3 py-1.5 border-b border-stone-800">
        <span className="text-stone-600 uppercase tracking-wider">{label}</span>
      </div>
      <div className="px-3 py-2 space-y-2.5">
        {rows.map((row, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-stone-300 truncate mr-2">{row.label}</span>
              <div className="flex items-center gap-2 shrink-0">
                {row.sub && <span className="text-stone-600">{row.sub}</span>}
                <span className="text-stone-300 font-mono">{fmt(row.value)}</span>
              </div>
            </div>
            <div className="h-1 bg-stone-800 rounded-full">
              <div
                className="h-1 rounded-full bg-emerald-700/60"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chat bubbles ──────────────────────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-emerald-900/25 border border-emerald-800/40 rounded-2xl rounded-tr-sm px-4 py-2.5">
        <p className="text-stone-100 text-sm whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  sources,
  error,
}: {
  content: string;
  sources?: Source[];
  error?: boolean;
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        <div
          className={`rounded-2xl rounded-tl-sm px-4 py-2.5 ${
            error
              ? "bg-red-900/20 border border-red-800/40"
              : "bg-stone-800/50 border border-stone-700/40"
          }`}
        >
          <p className={`text-sm whitespace-pre-wrap ${error ? "text-red-300" : "text-stone-100"}`}>
            {content}
          </p>
        </div>
        {sources
          ?.filter((s) => s.handled)
          .map((s, i) => <SourceCard key={i} source={s} />)}
      </div>
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex justify-start">
      <div className="bg-stone-800/50 border border-stone-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1.5 items-center h-4">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 bg-stone-500 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const sendQuery = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: `${Date.now()}`,
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    });
    setLoading(true);

    // Pass last 6 messages (3 exchanges) as conversation context, excluding the new query
    const prior = [...messages, userMsg].slice(-7, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await api.post("/query", { query: trimmed, context: prior });
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now() + 1}`,
          role: "assistant",
          content: res.data.response,
          sources: res.data.sources,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now() + 1}`,
          role: "assistant",
          content: "Something went wrong. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuery(input);
    }
  };

  if (!user) return null;

  return (
    <div className="flex flex-col min-h-full">
      {/* Conversation */}
      <div className="flex-1 p-4 sm:p-6 pb-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
            <div>
              <p className="text-stone-200 text-base font-medium mb-1.5">
                Ask anything about your household
              </p>
              <p className="text-stone-500 text-sm">
                Spending, groceries, insurance, price trends and more.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => sendQuery(ex)}
                  className="px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-xs hover:border-emerald-700 hover:text-emerald-300 hover:bg-emerald-950/20 transition-colors text-left"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-2xl mx-auto">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <UserBubble key={msg.id} content={msg.content} />
              ) : (
                <AssistantBubble
                  key={msg.id}
                  content={msg.content}
                  sources={msg.sources}
                  error={msg.error}
                />
              )
            )}
            {loading && <LoadingBubble />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-[#0f0e0c] border-t border-stone-800 p-4">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              adjustTextareaHeight();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your expenses or insurance…"
            disabled={loading}
            className="flex-1 resize-none bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-200 placeholder:text-stone-600 text-base focus:outline-none focus:border-emerald-700 disabled:opacity-50 overflow-y-auto"
            style={{ minHeight: "46px", maxHeight: "128px" }}
          />
          <button
            onClick={() => sendQuery(input)}
            disabled={!input.trim() || loading}
            className="shrink-0 h-[46px] w-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            aria-label="Send"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-white rotate-90"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
        <p className="text-stone-700 text-xs text-center mt-2">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
