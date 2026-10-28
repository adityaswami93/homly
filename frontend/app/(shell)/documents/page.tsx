"use client";

import { useEffect, useState } from "react";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";
import { isPdfUrl } from "@/lib/files";

interface DocumentSummary {
  id: string;
  doc_type: string | null;
  title: string;
  summary: string | null;
  key_facts: { label: string; value: string }[];
  caption: string | null;
  sender_name: string | null;
  created_at: string;
  expires_at: string;
}

interface DocumentDetail extends DocumentSummary {
  extracted_text: string | null;
  image_url: string | null;
}

const TYPE_EMOJI: Record<string, string> = {
  letter: "✉️", bill: "🧾", invitation: "🎉", notice: "📢", appointment: "📅",
  form: "📝", schedule: "🗓️", screenshot: "📱", voucher: "🎟️", photo: "📷", other: "📄",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<DocumentDetail | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { toasts, dismissToast, toast } = useToast();

  const load = (q?: string) =>
    api.get("/documents", { params: q ? { q } : {} })
      .then((res) => {
        setDocs(res.data.documents);
        setRetentionDays(res.data.retention_days);
      })
      .catch(() => toast.error("Couldn't load documents"))
      .finally(() => setLoading(false));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const search = (q?: string) => {
    setLoading(true);
    load(q);
  };

  const openDoc = async (id: string) => {
    try {
      const res = await api.get(`/documents/${id}`);
      setOpen(res.data.document);
    } catch { toast.error("Couldn't open that document"); }
  };

  const remove = async () => {
    if (!open) return;
    try {
      await api.delete(`/documents/${open.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== open.id));
      setOpen(null);
      setConfirmDelete(false);
      toast.success("Forgotten");
    } catch { toast.error("Failed to delete"); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <p className="text-stone-400 text-sm mb-4">
        Photos the assistant has read in your WhatsApp group — letters, bills, notices, screenshots.
        Ask about any of them in the group (&quot;what did the school letter say?&quot;).
        {retentionDays ? ` Each is kept for ${retentionDays} days, then forgotten.` : ""}
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); search(query.trim() || undefined); }}
        className="flex gap-2 mb-5"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the text, e.g. excursion fee"
          className="flex-1 border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base"
        />
        <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 rounded-xl min-h-[44px]">
          Search
        </button>
      </form>

      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-10 text-center text-stone-500 text-sm">
          {query
            ? "Nothing matches that search."
            : "Nothing yet. Send a photo to the WhatsApp group and mention the assistant — it will read it and ask what to do."}
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => openDoc(d.id)}
              className="w-full text-left bg-stone-900 border border-stone-800 hover:border-stone-600 rounded-xl p-4 flex gap-3 transition-colors"
            >
              <span className="text-xl shrink-0">{TYPE_EMOJI[d.doc_type ?? "other"] ?? "📄"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-stone-100 font-medium truncate">{d.title}</span>
                {d.summary && <span className="block text-sm text-stone-400 line-clamp-2">{d.summary}</span>}
                <span className="block text-xs text-stone-500 mt-1">
                  {formatDate(d.created_at)}{d.sender_name ? ` · ${d.sender_name}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => { setOpen(null); setConfirmDelete(false); }}>
          <div
            className="w-full sm:max-w-2xl bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-stone-800">
              <div className="min-w-0">
                <h2 className="text-stone-100 font-semibold">{open.title}</h2>
                <p className="text-xs text-stone-500">
                  {formatDate(open.created_at)}{open.sender_name ? ` · sent by ${open.sender_name}` : ""} · forgotten after {formatDate(open.expires_at)}
                </p>
              </div>
              <button onClick={() => { setOpen(null); setConfirmDelete(false); }} className="text-stone-500 hover:text-stone-300 min-h-[44px] min-w-[44px]">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {open.image_url && (isPdfUrl(open.image_url) ? (
                <a href={open.image_url} target="_blank" rel="noreferrer" className="text-sm text-emerald-400 hover:text-emerald-300">
                  Open the original PDF
                </a>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={open.image_url} alt={open.title} className="max-h-80 rounded-lg mx-auto" />
              ))}
              {open.summary && <p className="text-stone-300 text-sm">{open.summary}</p>}
              {open.key_facts?.length > 0 && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {open.key_facts.map((f, i) => (
                    <div key={i} className="bg-stone-800 rounded-lg px-3 py-2">
                      <dt className="text-xs text-stone-500">{f.label}</dt>
                      <dd className="text-sm text-stone-200">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {open.extracted_text && (
                <details className="bg-stone-800/50 rounded-lg">
                  <summary className="cursor-pointer text-sm text-stone-300 px-3 py-2 min-h-[44px] flex items-center">Full text</summary>
                  <pre className="whitespace-pre-wrap text-xs text-stone-400 px-3 pb-3 font-sans">{open.extracted_text}</pre>
                </details>
              )}
              {confirmDelete ? (
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm rounded-xl min-h-[44px]">Cancel</button>
                  <button onClick={remove} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded-xl min-h-[44px]">Forget it</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-400 hover:text-red-300 min-h-[44px]">
                  Forget this photo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
