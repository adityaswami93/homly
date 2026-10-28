"use client";

import { useEffect, useState } from "react";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";
import { ImageModal, openVoucherImage, Voucher, VoucherCard, VoucherModal } from "./VoucherParts";

export default function VouchersPage() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [expiringSoonDays, setExpiringSoonDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Voucher | undefined>();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { toasts, dismissToast, toast } = useToast();

  const load = () =>
    api.get("/vouchers", { params: { status: "active" } })
      .then((res) => {
        setVouchers(res.data.vouchers);
        setExpiringSoonDays(res.data.expiring_soon_days);
      })
      .catch(() => toast.error("Couldn't load vouchers"))
      .finally(() => setLoading(false));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const markUsed = async (id: string) => {
    try {
      await api.post(`/vouchers/${id}/use`);
      setVouchers((prev) => prev.filter((v) => v.id !== id));
      toast.success("Marked as used");
    } catch { toast.error("Failed to update voucher"); }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/vouchers/${id}`);
      setVouchers((prev) => prev.filter((v) => v.id !== id));
      setConfirmDelete(null);
      toast.success("Voucher deleted");
    } catch { toast.error("Failed to delete voucher"); }
  };

  const showImage = async (id: string) => {
    const url = await openVoucherImage(id);
    if (url) setImageUrl(url);
    else toast.error("No image for this voucher");
  };

  const onSaved = (_v: Voucher, created: boolean) => {
    setShowAdd(false);
    setEditing(undefined);
    toast.success(editing ? "Voucher updated" : created ? "Saved to wallet" : "That one's already in the wallet");
    // Re-fetch rather than splice in: ordering and expiry flags are backend-computed.
    load();
  };

  const q = filter.trim().toLowerCase();
  const shown = q
    ? vouchers.filter((v) => `${v.merchant} ${v.title ?? ""} ${v.code ?? ""}`.toLowerCase().includes(q))
    : vouchers;
  const soon = shown.filter((v) => v.expiring_soon);
  const rest = shown.filter((v) => !v.expiring_soon);

  const card = (v: Voucher) => (
    <VoucherCard
      key={v.id}
      voucher={v}
      onUse={() => markUsed(v.id)}
      onEdit={() => setEditing(v)}
      onDelete={() => setConfirmDelete(v.id)}
      onShowImage={() => showImage(v.id)}
    />
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex-1">
          <p className="text-stone-400 text-sm">
            Add vouchers here, or just send a photo or the promo message to your WhatsApp group.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
        >
          + Add voucher
        </button>
      </div>

      {vouchers.length > 3 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by shop or code"
          className="w-full mb-5 border border-stone-700 bg-stone-800 rounded-xl px-4 py-2.5 text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-emerald-600 min-h-[44px] text-base"
        />
      )}

      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : vouchers.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">🎟️</span>
          </div>
          <p className="text-stone-300 text-sm font-medium">No vouchers yet</p>
          <p className="text-stone-500 text-sm mt-1">
            Upload a voucher, paste a promo message, or send either to the WhatsApp group with &quot;voucher&quot; in the caption.
          </p>
        </div>
      ) : (
        <>
          {soon.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-3">
                Expiring within {expiringSoonDays} days
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{soon.map(card)}</div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              {soon.length > 0 && (
                <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Everything else</h2>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{rest.map(card)}</div>
            </section>
          )}
          {shown.length === 0 && <p className="text-stone-500 text-sm text-center py-8">Nothing matches &quot;{filter}&quot;.</p>}
        </>
      )}

      {(showAdd || editing) && (
        <VoucherModal
          voucher={editing}
          onClose={() => { setShowAdd(false); setEditing(undefined); }}
          onSaved={onSaved}
          onError={(m) => toast.error(m)}
        />
      )}

      {imageUrl && <ImageModal url={imageUrl} onClose={() => setImageUrl(null)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setConfirmDelete(null)}>
          <div className="w-full sm:max-w-sm bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-stone-100 font-medium mb-1">Delete this voucher?</p>
            <p className="text-stone-500 text-sm mb-4">To keep a record of it instead, mark it as used.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm rounded-xl min-h-[44px]">Cancel</button>
              <button onClick={() => remove(confirmDelete)} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded-xl min-h-[44px]">Delete</button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
