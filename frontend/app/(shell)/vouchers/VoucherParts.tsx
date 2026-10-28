"use client";

import { useState } from "react";
import api from "@/lib/axios";
import { isPdfUrl } from "@/lib/files";

// Everything domain-meaningful here — effective_status, days_left,
// expiring_soon, value_label — comes from the backend (services/vouchers.py).
// This file only formats and renders it.
export interface Voucher {
  id: string;
  merchant: string;
  title: string | null;
  code: string | null;
  kind: string;
  value_type: string | null;
  value: number | null;
  currency: string | null;
  min_spend: number | null;
  terms: string | null;
  expires_at: string | null;
  status: "active" | "used" | "archived";
  effective_status: "active" | "used" | "archived" | "expired";
  days_left: number | null;
  expiring_soon: boolean;
  value_label: string | null;
  used_at: string | null;
  used_by_name: string | null;
  image_path: string | null;
  confidence: string | null;
  source: string;
  added_by_name: string | null;
}

export const inputCls =
  "w-full border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base";

export function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function expiryText(v: Voucher): string {
  if (!v.expires_at) return "No expiry";
  if (v.effective_status === "expired") return `Expired ${formatDate(v.expires_at)}`;
  if (v.days_left === 0) return "Expires today";
  if (v.days_left === 1) return "Expires tomorrow";
  if (v.days_left !== null && v.expiring_soon) return `Expires in ${v.days_left} days`;
  return `Expires ${formatDate(v.expires_at)}`;
}

export function VoucherCard({
  voucher,
  onUse,
  onEdit,
  onDelete,
  onRestore,
  onShowImage,
}: {
  voucher: Voucher;
  onUse?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onShowImage?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const v = voucher;
  const inactive = v.effective_status !== "active";

  const copy = async () => {
    if (!v.code) return;
    try {
      await navigator.clipboard.writeText(v.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is visible anyway */
    }
  };

  return (
    <div
      className={`bg-stone-900 border rounded-xl p-4 flex flex-col gap-3 ${
        v.expiring_soon ? "border-amber-700/60" : "border-stone-800"
      } ${inactive ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-stone-100 font-semibold truncate">{v.merchant}</p>
          <p className="text-sm text-stone-400 truncate">
            {v.value_label || v.title || (v.kind === "promo_code" ? "Promo code" : "Voucher")}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2 py-1 rounded-lg ${
            v.effective_status === "used"
              ? "bg-stone-800 text-stone-400"
              : v.effective_status === "expired"
              ? "bg-red-900/30 text-red-400"
              : v.expiring_soon
              ? "bg-amber-900/30 text-amber-400"
              : "bg-emerald-900/30 text-emerald-400"
          }`}
        >
          {v.effective_status === "used" ? "Used" : v.effective_status === "archived" ? "Archived" : expiryText(v)}
        </span>
      </div>

      {v.code ? (
        <button
          onClick={copy}
          className="flex items-center justify-between gap-2 bg-stone-800 border border-dashed border-stone-600 rounded-lg px-3 min-h-[44px] text-left hover:border-emerald-600 transition-colors"
          title="Copy code"
        >
          <span className="font-mono text-stone-100 tracking-wider break-all">{v.code}</span>
          <span className="text-xs text-emerald-400 shrink-0">{copied ? "Copied" : "Copy"}</span>
        </button>
      ) : (
        <p className="text-xs text-stone-500">No code — show the barcode/QR at checkout.</p>
      )}

      {v.code && v.confidence === "low" && (
        <p className="text-xs text-amber-400">Part of this code was hard to read — check it against the image.</p>
      )}
      {v.terms && <p className="text-xs text-stone-500 line-clamp-2">{v.terms}</p>}
      {v.effective_status === "used" && (
        <p className="text-xs text-stone-500">
          Used {v.used_at ? formatDate(v.used_at) : ""}
          {v.used_by_name ? ` by ${v.used_by_name}` : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {v.image_path && onShowImage && (
          <button onClick={onShowImage} className="text-xs text-stone-300 hover:text-stone-100 px-3 rounded-lg hover:bg-stone-800 min-h-[36px]">
            {v.code ? "Image" : "Show voucher"}
          </button>
        )}
        {onUse && (
          <button onClick={onUse} className="text-xs font-medium text-emerald-400 hover:text-emerald-300 px-3 rounded-lg hover:bg-emerald-900/30 min-h-[36px]">
            Mark used
          </button>
        )}
        {onRestore && (
          <button onClick={onRestore} className="text-xs text-stone-300 hover:text-stone-100 px-3 rounded-lg hover:bg-stone-800 min-h-[36px]">
            Back to wallet
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} className="text-xs text-stone-300 hover:text-stone-100 px-3 rounded-lg hover:bg-stone-800 min-h-[36px]">
            Edit
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300 px-3 rounded-lg hover:bg-red-900/20 min-h-[36px] ml-auto">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function ImageModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      {isPdfUrl(url) ? (
        <iframe src={url} title="Voucher" className="w-full max-w-3xl h-[85vh] rounded-xl bg-white" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Voucher" className="max-h-[85vh] max-w-full rounded-xl" />
      )}
    </div>
  );
}

export async function openVoucherImage(id: string): Promise<string | null> {
  try {
    const res = await api.get(`/vouchers/${id}/image`);
    return res.data.url as string;
  } catch {
    return null;
  }
}

// ── Add / edit ───────────────────────────────────────────────────────────────

interface FormState {
  merchant: string;
  title: string;
  code: string;
  value_type: string;
  value: string;
  min_spend: string;
  expires_at: string;
  terms: string;
}

const EMPTY: FormState = {
  merchant: "", title: "", code: "", value_type: "", value: "", min_spend: "", expires_at: "", terms: "",
};

function toForm(v: Partial<Voucher> | null | undefined): FormState {
  if (!v) return EMPTY;
  return {
    merchant: v.merchant ?? "",
    title: v.title ?? "",
    code: v.code ?? "",
    value_type: v.value_type ?? "",
    value: v.value?.toString() ?? "",
    min_spend: v.min_spend?.toString() ?? "",
    expires_at: v.expires_at?.slice(0, 10) ?? "",
    terms: v.terms ?? "",
  };
}

function toPayload(f: FormState) {
  return {
    merchant: f.merchant.trim(),
    title: f.title.trim() || null,
    code: f.code.trim() || null,
    value_type: f.value_type || null,
    value: f.value ? parseFloat(f.value) : null,
    min_spend: f.min_spend ? parseFloat(f.min_spend) : null,
    expires_at: f.expires_at || null,
    terms: f.terms.trim() || null,
  };
}

type Mode = "upload" | "paste" | "type";

export function VoucherModal({
  voucher,
  onClose,
  onSaved,
  onError,
}: {
  voucher?: Voucher;
  onClose: () => void;
  onSaved: (v: Voucher, created: boolean) => void;
  onError: (msg: string) => void;
}) {
  const editing = !!voucher;
  const [mode, setMode] = useState<Mode>("upload");
  const [form, setForm] = useState<FormState>(toForm(voucher));
  const [reviewing, setReviewing] = useState(editing);
  const [pasted, setPasted] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const update = (k: keyof FormState, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const extract = async (body: FormData) => {
    setReading(true);
    setNotice(null);
    try {
      const res = await api.post("/vouchers/extract", body);
      setImagePath(res.data.image_path);
      setImageUrl(res.data.image_url);
      if (res.data.found) {
        setForm(toForm(res.data.extracted));
        setConfidence(res.data.confidence);
      } else {
        setNotice("Couldn't find a voucher in that — fill in the details below.");
      }
      setReviewing(true);
    } catch (e) {
      onError(errorDetail(e, "Couldn't read that"));
    } finally {
      setReading(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    extract(fd);
  };

  const onPaste = () => {
    if (!pasted.trim()) return;
    const fd = new FormData();
    fd.append("text", pasted);
    extract(fd);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.merchant.trim()) {
      onError("Add the shop or brand");
      return;
    }
    setSaving(true);
    try {
      if (editing && voucher) {
        const res = await api.patch(`/vouchers/${voucher.id}`, toPayload(form));
        onSaved(res.data.voucher, false);
      } else {
        const res = await api.post("/vouchers", { ...toPayload(form), image_path: imagePath, confidence });
        onSaved(res.data.voucher, res.data.created);
      }
    } catch (e) {
      onError(errorDetail(e, "Failed to save voucher"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h2 className="text-stone-100 font-semibold">{editing ? "Edit voucher" : "Add a voucher"}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300 min-h-[44px] min-w-[44px]">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {!editing && !reviewing && (
            <>
              <div className="flex gap-1 bg-stone-800 rounded-xl p-1">
                {(["upload", "paste", "type"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => (m === "type" ? (setMode(m), setReviewing(true)) : setMode(m))}
                    className={`flex-1 text-sm rounded-lg min-h-[40px] ${
                      mode === m ? "bg-stone-900 text-stone-100" : "text-stone-400 hover:text-stone-200"
                    }`}
                  >
                    {m === "upload" ? "Photo / PDF" : m === "paste" ? "Paste text" : "Type it in"}
                  </button>
                ))}
              </div>

              {mode === "upload" && (
                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-stone-700 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-600 transition-colors">
                  <span className="text-3xl">🎟️</span>
                  <span className="text-sm text-stone-300">
                    {reading ? "Reading voucher…" : "Choose a photo, screenshot or PDF"}
                  </span>
                  <span className="text-xs text-stone-500">We&apos;ll read the code, value and expiry for you to check</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    disabled={reading}
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
              )}

              {mode === "paste" && (
                <div className="space-y-3">
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    rows={5}
                    placeholder={'e.g. "Use code SAVE20 for 20% off your next Lazada order. Valid till 30 Nov."'}
                    className={inputCls}
                  />
                  <button
                    onClick={onPaste}
                    disabled={reading || !pasted.trim()}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl min-h-[44px]"
                  >
                    {reading ? "Reading…" : "Read it"}
                  </button>
                </div>
              )}
            </>
          )}

          {reviewing && (
            <form onSubmit={save} className="space-y-3">
              {notice && <p className="text-sm text-amber-400">{notice}</p>}
              {confidence === "low" && (
                <p className="text-sm text-amber-400">Part of this was hard to read — please check the code against the image.</p>
              )}
              {imageUrl && !isPdfUrl(imageUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Uploaded voucher" className="max-h-48 rounded-lg mx-auto" />
              )}
              <div>
                <label className="text-xs text-stone-500">Shop / brand *</label>
                <input className={inputCls} value={form.merchant} onChange={(e) => update("merchant", e.target.value)} placeholder="FairPrice, Grab, Lazada…" />
              </div>
              <div>
                <label className="text-xs text-stone-500">Code</label>
                <input className={`${inputCls} font-mono`} value={form.code} onChange={(e) => update("code", e.target.value)} placeholder="Leave empty for barcode/QR vouchers" />
              </div>
              <div>
                <label className="text-xs text-stone-500">What it&apos;s for</label>
                <input className={inputCls} value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="$10 off groceries" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-stone-500">Discount type</label>
                  <select className={inputCls} value={form.value_type} onChange={(e) => update("value_type", e.target.value)}>
                    <option value="">—</option>
                    <option value="amount">Amount off</option>
                    <option value="percent">% off</option>
                    <option value="freebie">Free item</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-stone-500">Value</label>
                  <input className={inputCls} type="number" step="0.01" min="0" value={form.value} onChange={(e) => update("value", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-stone-500">Min spend</label>
                  <input className={inputCls} type="number" step="0.01" min="0" value={form.min_spend} onChange={(e) => update("min_spend", e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-stone-500">Last day to use</label>
                  <input className={inputCls} type="date" value={form.expires_at} onChange={(e) => update("expires_at", e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs text-stone-500">Conditions</label>
                <textarea className={inputCls} rows={2} value={form.terms} onChange={(e) => update("terms", e.target.value)} />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl min-h-[44px]"
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Save to wallet"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
