"use client";

import { useEffect, useState } from "react";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";
import { ImageModal, openVoucherImage, Voucher, VoucherCard } from "../VoucherParts";

export default function VoucherHistoryPage() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    api.get("/vouchers", { params: { status: "history" } })
      .then((res) => setVouchers(res.data.vouchers))
      .catch(() => toast.error("Couldn't load voucher history"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restore = async (id: string) => {
    try {
      await api.patch(`/vouchers/${id}`, { status: "active" });
      setVouchers((prev) => prev.filter((v) => v.id !== id));
      toast.success("Moved back to the wallet");
    } catch { toast.error("Failed to update voucher"); }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/vouchers/${id}`);
      setVouchers((prev) => prev.filter((v) => v.id !== id));
      toast.success("Voucher deleted");
    } catch { toast.error("Failed to delete voucher"); }
  };

  const showImage = async (id: string) => {
    const url = await openVoucherImage(id);
    if (url) setImageUrl(url);
    else toast.error("No image for this voucher");
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {loading ? (
        <div className="text-stone-500 text-sm py-12 text-center">Loading…</div>
      ) : vouchers.length === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-10 text-center text-stone-500 text-sm">
          Used and expired vouchers will show up here.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {vouchers.map((v) => (
            <VoucherCard
              key={v.id}
              voucher={v}
              // An expired voucher can't go back to the wallet by changing its
              // status — its date has passed. Only used/archived ones can.
              onRestore={v.effective_status !== "expired" ? () => restore(v.id) : undefined}
              onDelete={() => remove(v.id)}
              onShowImage={() => showImage(v.id)}
            />
          ))}
        </div>
      )}
      {imageUrl && <ImageModal url={imageUrl} onClose={() => setImageUrl(null)} />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
