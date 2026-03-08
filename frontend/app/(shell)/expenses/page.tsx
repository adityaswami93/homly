"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import { useToast } from "@/lib/toast";
import { ToastContainer } from "@/app/components/Toast";

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

interface Item {
  id: string;
  name: string;
  qty: number;
  unit_price: number | null;
  line_total: number | null;
  category: string;
}

interface Receipt {
  id: string;
  vendor: string | null;
  date: string | null;
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  confidence: "high" | "medium" | "low";
  flagged: boolean;
  deleted: boolean;
  notes: string | null;
  currency: string;
  sender_name: string | null;
  sender_phone: string | null;
  reimbursable: boolean;
  image_path: string | null;
  items?: Item[];
}

interface WeekData {
  year: number;
  week_number: number;
  total: number;
  reimbursable_total: number;
  own_total: number;
  receipt_count: number;
  flagged_count: number;
  receipts: Receipt[];
  category_totals: Record<string, number>;
}

const CATEGORY_EMOJI: Record<string, string> = {
  groceries: "🛒",
  household: "🏠",
  "personal care": "🧴",
  "food & beverage": "🍜",
  transport: "🚌",
  other: "📦",
};

const CATEGORY_COLOR: Record<string, string> = {
  groceries: "bg-emerald-900/40 text-emerald-400",
  household: "bg-blue-900/40 text-blue-400",
  "personal care": "bg-purple-900/40 text-purple-400",
  "food & beverage": "bg-orange-900/40 text-orange-400",
  transport: "bg-cyan-900/40 text-cyan-400",
  other: "bg-stone-800 text-stone-400",
};

const CATEGORY_BAR: Record<string, string> = {
  groceries: "#10b981",
  household: "#3b82f6",
  "personal care": "#a855f7",
  "food & beverage": "#f97316",
  transport: "#06b6d4",
  other: "#9ca3af",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-amber-400",
  low: "text-red-400",
};

function fmt(amount: number | null, currency = "SGD") {
  if (amount == null) return "—";
  return `${currency} ${Number(amount).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return {
    week:
      1 +
      Math.round(
        ((d.getTime() - week1.getTime()) / 86400000 -
          3 +
          ((week1.getDay() + 6) % 7)) /
          7
      ),
    year: d.getFullYear(),
  };
}

function getWeekRange(year: number, week: number): { start: Date; end: Date } {
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(startOfWeek1);
  start.setDate(startOfWeek1.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function formatWeekRange(year: number, week: number): string {
  const { start, end } = getWeekRange(year, week);
  const s = start.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  const e = end.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  return `${s} – ${e}`;
}

function ReceiptDrawer({
  receipt,
  isAdmin,
  onClose,
  onToggleFlag,
  onDelete,
  onDateChange,
  onToggleReimbursable,
  onToast,
}: {
  receipt: Receipt;
  isAdmin: boolean;
  onClose: () => void;
  onToggleFlag: (id: string, flagged: boolean) => void;
  onDelete: (id: string) => void;
  onDateChange: (id: string, newDate: string, weekNumber: number, year: number) => void;
  onToggleReimbursable: (id: string, reimbursable: boolean) => void;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [dateValue, setDateValue] = useState(receipt.date?.slice(0, 10) ?? "");
  const [savingDate, setSavingDate] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  useEffect(() => {
    api.get(`/receipts/${receipt.id}`).then((res) => {
      setItems(res.data.items || []);
      setLoading(false);
    });
    if (receipt.image_path) {
      setImageLoading(true);
      api
        .get(`/receipts/${receipt.id}/image`)
        .then((res) => setImageUrl(res.data.url))
        .catch(() => {})
        .finally(() => setImageLoading(false));
    }
  }, [receipt.id, receipt.image_path]);

  const handleFlag = async () => {
    setToggling(true);
    await api.patch(`/receipts/${receipt.id}/flag`, { flagged: !receipt.flagged });
    onToggleFlag(receipt.id, !receipt.flagged);
    setToggling(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.patch(`/receipts/${receipt.id}/delete`, { deleted: true });
      onDelete(receipt.id);
      onToast("Receipt removed", "success");
      onClose();
    } catch {
      onToast("Failed to remove receipt", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveDate = async () => {
    if (!dateValue) return;
    setSavingDate(true);
    try {
      const res = await api.patch(`/receipts/${receipt.id}/date`, { date: dateValue });
      onDateChange(receipt.id, res.data.date, res.data.week_number, res.data.year);
      setEditingDate(false);
      onToast("Date updated", "success");
    } catch {
      onToast("Failed to update date", "error");
    } finally {
      setSavingDate(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md h-[88vh] sm:h-full bg-stone-900 border-t sm:border-t-0 sm:border-l border-stone-800 overflow-y-auto rounded-t-2xl sm:rounded-none shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-stone-800 flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-stone-100 text-lg">
              {receipt.vendor || "Unknown vendor"}
            </h2>
            {editingDate ? (
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  className="border border-stone-700 rounded-lg px-2 py-1 text-xs text-stone-300 focus:outline-none focus:border-emerald-400 text-base bg-stone-800"
                />
                <button
                  onClick={handleSaveDate}
                  disabled={savingDate}
                  className="text-xs text-emerald-400 hover:text-emerald-400 font-medium"
                >
                  {savingDate ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingDate(false);
                    setDateValue(receipt.date?.slice(0, 10) ?? "");
                  }}
                  className="text-xs text-stone-500 hover:text-stone-400"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-stone-500 text-sm">{fmtDate(receipt.date)}</p>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setDateValue(receipt.date?.slice(0, 10) ?? "");
                      setEditingDate(true);
                    }}
                    className="text-stone-600 hover:text-stone-500 text-xs"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
            {receipt.sender_name && (
              <p className="text-stone-500 text-xs mt-0.5">Posted by {receipt.sender_name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-stone-400 text-2xl leading-none w-8 h-8 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {receipt.image_path && (
          <div className="border-b border-stone-800">
            {imageLoading ? (
              <div className="h-48 flex items-center justify-center bg-stone-900/50">
                <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : imageUrl ? (
              <div className="relative">
                <img
                  src={imageUrl}
                  alt="Receipt"
                  className="w-full max-h-72 object-contain bg-stone-900/50"
                />
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2 right-2 bg-stone-900/90 border border-stone-700 text-stone-400 text-xs px-2.5 py-1.5 rounded-lg"
                >
                  View full ↗
                </a>
              </div>
            ) : (
              <div className="h-20 flex items-center justify-center bg-stone-900/50">
                <p className="text-stone-500 text-xs">Image unavailable</p>
              </div>
            )}
          </div>
        )}

        <div className="p-5 border-b border-stone-800 flex items-center justify-between">
          <div>
            <p className="text-3xl font-semibold text-stone-100 font-mono">
              {fmt(receipt.total, receipt.currency)}
            </p>
            {receipt.tax != null && receipt.tax > 0 && (
              <p className="text-stone-500 text-xs mt-1">
                Subtotal {fmt(receipt.subtotal)} + GST {fmt(receipt.tax)}
              </p>
            )}
          </div>
          <div className="text-right">
            <span
              className={`text-xs font-medium ${CONFIDENCE_STYLE[receipt.confidence] || "text-stone-500"}`}
            >
              {receipt.confidence} confidence
            </span>
            {receipt.notes && (
              <p className="text-stone-500 text-xs mt-1 max-w-[140px] text-right">{receipt.notes}</p>
            )}
          </div>
        </div>

        <div className="p-5">
          <h3 className="text-stone-500 text-xs uppercase tracking-widest mb-3">Line Items</h3>
          {loading ? (
            <p className="text-stone-500 text-sm">Loading items…</p>
          ) : items.length === 0 ? (
            <p className="text-stone-500 text-sm italic">No items extracted</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-2 border-b border-stone-800 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-200 text-sm truncate">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          CATEGORY_COLOR[item.category] || CATEGORY_COLOR["other"]
                        }`}
                      >
                        {CATEGORY_EMOJI[item.category]} {item.category}
                      </span>
                      {item.qty !== 1 && (
                        <span className="text-stone-500 text-xs">×{item.qty}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-stone-200 text-sm font-mono ml-4 shrink-0">
                    {fmt(item.line_total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-stone-800 space-y-2">
          <button
            onClick={handleFlag}
            disabled={toggling}
            className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors border min-h-[44px] ${
              receipt.flagged
                ? "border-stone-700 text-stone-400 hover:border-stone-600"
                : "border-amber-700 text-amber-300 bg-amber-900/30 hover:bg-amber-900/50"
            }`}
          >
            {toggling ? "…" : receipt.flagged ? "✓ Mark as reviewed" : "⚠ Flag for review"}
          </button>
          <button
            onClick={async () => {
              await api.patch(`/receipts/${receipt.id}/reimbursable`, {
                reimbursable: !receipt.reimbursable,
              });
              onToggleReimbursable(receipt.id, !receipt.reimbursable);
            }}
            className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors border min-h-[44px] ${
              receipt.reimbursable
                ? "border-stone-700 text-stone-400 hover:border-stone-600"
                : "border-emerald-800 text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50"
            }`}
          >
            {receipt.reimbursable ? "Remove from reimbursement" : "Add to reimbursement"}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-full py-2.5 rounded-xl text-sm font-medium border border-red-800 text-red-400 bg-red-900/30 hover:bg-red-900/50 transition-colors min-h-[44px]"
          >
            {deleting ? "Removing…" : "Remove receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 bg-stone-900 ${
        accent
          ? "border-emerald-800"
          : warn
          ? "border-red-800"
          : "border-stone-800"
      }`}
    >
      <p
        className={`text-xs mb-1 font-medium ${
          accent ? "text-emerald-400" : warn ? "text-red-400" : "text-stone-500"
        }`}
      >
        {label}
      </p>
      <p
        className={`text-lg font-semibold font-mono ${
          accent ? "text-emerald-400" : warn ? "text-red-400" : "text-stone-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function ExpensesOverview() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [week, setWeek] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [currentWeek, setCurrentWeek] = useState<{ week: number; year: number } | null>(null);
  const [isCurrentWeek, setIsCurrentWeek] = useState(true);
  const [sending, setSending] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const router = useRouter();
  const { toasts, dismissToast, toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
      try {
        const res = await api.get("/household");
        if (!res.data?.id) {
          router.push("/onboarding");
          return;
        }
        const myMember = res.data.members?.find((m: any) => m.user_id === session.user.id);
        const isSuperAdmin = session.user.user_metadata?.is_super_admin === true;
        setIsAdmin(myMember?.role === "admin" || isSuperAdmin);
      } catch {
        router.push("/onboarding");
        return;
      }
      const now = getISOWeek(new Date());
      setCurrentWeek(now);
    });
  }, [router]);

  const loadWeek = useCallback(async (year: number, weekNum: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/weeks/${year}/${weekNum}`);
      setWeek(res.data);
    } catch {
      setWeek(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && currentWeek) loadWeek(currentWeek.year, currentWeek.week);
  }, [user, currentWeek, loadWeek]);

  const navigate = (delta: number) => {
    if (!currentWeek) return;
    let { week: w, year } = currentWeek;
    w += delta;
    if (w < 1) { year -= 1; w = 52; }
    if (w > 52) { year += 1; w = 1; }
    const newWeek = { week: w, year };
    setCurrentWeek(newWeek);
    const now = getISOWeek(new Date());
    setIsCurrentWeek(newWeek.week === now.week && newWeek.year === now.year);
    loadWeek(year, w);
  };

  const goToCurrentWeek = () => {
    const now = getISOWeek(new Date());
    setCurrentWeek(now);
    setIsCurrentWeek(true);
    loadWeek(now.year, now.week);
  };

  const handleSendTotal = async () => {
    if (!week || !currentWeek) return;
    setSending(true);
    try {
      await api.post("/messages/send", {
        type: "week_total",
        year: currentWeek.year,
        week_number: currentWeek.week,
      });
      toast.success("Summary sent to WhatsApp group");
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!week || !currentWeek) return;
    setPaying(true);
    try {
      await api.post("/reimbursements", {
        year: currentWeek.year,
        week_number: currentWeek.week,
        amount: week.reimbursable_total,
        note: `Week ${currentWeek.week} reimbursement`,
      });
      setPaid(true);
      toast.success(`SGD ${week.reimbursable_total.toFixed(2)} marked as paid`);
      setTimeout(() => setPaid(false), 3000);
    } catch {
      toast.error("Failed to mark as paid");
    } finally {
      setPaying(false);
    }
  };

  const handleToggleFlag = (id: string, flagged: boolean) => {
    if (!week) return;
    setWeek((prev) =>
      prev
        ? {
            ...prev,
            flagged_count: flagged
              ? prev.flagged_count + 1
              : Math.max(0, prev.flagged_count - 1),
            receipts: prev.receipts.map((r) => (r.id === id ? { ...r, flagged } : r)),
          }
        : prev
    );
    if (selectedReceipt?.id === id) setSelectedReceipt((p) => (p ? { ...p, flagged } : p));
  };

  const handleDelete = (id: string) => {
    if (!week) return;
    const receipt = week.receipts.find((r) => r.id === id);
    setWeek((prev) => {
      if (!prev) return prev;
      const remaining = prev.receipts.filter((r) => r.id !== id);
      return {
        ...prev,
        receipts: remaining,
        receipt_count: remaining.length,
        total: remaining.reduce((s, r) => s + (r.total || 0), 0),
        reimbursable_total: round(
          remaining.filter((r) => r.reimbursable).reduce((s, r) => s + (r.total || 0), 0)
        ),
        own_total: round(
          remaining.filter((r) => !r.reimbursable).reduce((s, r) => s + (r.total || 0), 0)
        ),
        flagged_count: receipt?.flagged
          ? Math.max(0, prev.flagged_count - 1)
          : prev.flagged_count,
      };
    });
  };

  const handleDateChange = (id: string, newDate: string, weekNumber: number, year: number) => {
    if (!currentWeek || weekNumber !== currentWeek.week || year !== currentWeek.year) {
      handleDelete(id);
      setSelectedReceipt(null);
    } else {
      setWeek((p) =>
        p ? { ...p, receipts: p.receipts.map((r) => (r.id === id ? { ...r, date: newDate } : r)) } : p
      );
      setSelectedReceipt((p) => (p ? { ...p, date: newDate } : p));
    }
  };

  const handleToggleReimbursable = (id: string, reimbursable: boolean) => {
    if (!week) return;
    setWeek((prev) => {
      if (!prev) return prev;
      const updated = prev.receipts.map((r) => (r.id === id ? { ...r, reimbursable } : r));
      return {
        ...prev,
        receipts: updated,
        reimbursable_total: round(
          updated.filter((r) => r.reimbursable).reduce((s, r) => s + (r.total || 0), 0)
        ),
        own_total: round(
          updated.filter((r) => !r.reimbursable).reduce((s, r) => s + (r.total || 0), 0)
        ),
      };
    });
    if (selectedReceipt?.id === id) setSelectedReceipt((p) => (p ? { ...p, reimbursable } : p));
  };

  if (!user || !currentWeek) return null;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Week navigator */}
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <p className="text-stone-500 text-sm">
            {formatWeekRange(currentWeek.year, currentWeek.week)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleSendTotal}
            disabled={sending || !week || week.receipt_count === 0}
            className="flex items-center gap-1.5 text-xs bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-800 text-emerald-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 min-h-[36px]"
          >
            <span className="hidden sm:inline">📤 Send to group</span>
            <span className="sm:hidden">📤</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-stone-700 hover:border-stone-600 text-stone-400 hover:text-stone-200 transition-colors min-w-[32px]"
            >
              ←
            </button>
            {!isCurrentWeek && (
              <button
                onClick={goToCurrentWeek}
                className="px-3 h-8 text-xs rounded-lg border border-stone-700 hover:border-stone-600 text-stone-400 hover:text-stone-200 transition-colors"
              >
                Today
              </button>
            )}
            <button
              onClick={() => navigate(1)}
              disabled={isCurrentWeek}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-stone-700 hover:border-stone-600 text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-30 min-w-[32px]"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-500 text-sm">
          Loading…
        </div>
      ) : !week || week.receipt_count === 0 ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mx-auto mb-4">
            <span className="text-xl">🧾</span>
          </div>
          <h3 className="text-stone-300 font-medium mb-2">No receipts this week</h3>
          <p className="text-stone-500 text-sm">
            Send receipt photos to the WhatsApp group and they will appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="To reimburse" value={fmt(week.reimbursable_total)} accent />
            <StatCard label="Your spending" value={fmt(week.own_total)} />
            <StatCard label="Receipts" value={String(week.receipt_count)} />
            <StatCard
              label="Need review"
              value={String(week.flagged_count)}
              warn={week.flagged_count > 0}
            />
          </div>

          {week.reimbursable_total > 0 && (
            <div className="flex items-center justify-between bg-stone-900 border border-emerald-900 rounded-xl px-4 py-3.5 mb-6">
              <div>
                <p className="text-stone-100 text-sm font-medium">
                  SGD {week.reimbursable_total.toFixed(2)} to reimburse
                </p>
                <p className="text-stone-500 text-xs mt-0.5">
                  {week.receipts.filter((r) => r.reimbursable).length} reimbursable receipts
                </p>
              </div>
              <button
                onClick={handleMarkPaid}
                disabled={paying}
                className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 min-h-[36px]"
              >
                {paid ? "✓ Marked paid" : paying ? "…" : "Mark as paid"}
              </button>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Category breakdown */}
            {Object.keys(week.category_totals).length > 0 && (
              <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
                <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-4">
                  By Category
                </h2>
                <div className="space-y-3">
                  {Object.entries(week.category_totals)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amount]) => {
                      const pct =
                        week.total > 0
                          ? Math.min(100, Math.round((amount / week.total) * 100))
                          : 0;
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-stone-300 text-sm">
                              {CATEGORY_EMOJI[cat]}{" "}
                              {cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className="text-stone-500 text-xs">{pct}%</span>
                              <span className="text-stone-100 text-sm font-mono">
                                {fmt(amount)}
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-stone-800 rounded-full">
                            <div
                              className="h-1.5 rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: CATEGORY_BAR[cat] ?? "#9ca3af",
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Receipts list */}
            <div>
              <h2 className="text-stone-500 text-xs uppercase tracking-widest mb-3">Receipts</h2>
              <div className="space-y-2">
                {week.receipts.map((receipt) => (
                  <button
                    key={receipt.id}
                    onClick={() => setSelectedReceipt(receipt)}
                    className="w-full bg-stone-900 border border-stone-800 hover:border-stone-700 hover:bg-stone-800 rounded-xl px-4 py-3.5 flex items-center justify-between transition-all group text-left min-h-[64px]"
                  >
                    <div className="flex items-center gap-3">
                      {receipt.flagged && <span className="text-amber-400 text-sm">⚠</span>}
                      <div>
                        <p className="text-stone-100 font-medium text-sm">
                          {receipt.vendor || "Unknown vendor"}
                        </p>
                        <p className="text-stone-500 text-xs mt-0.5">
                          {fmtDate(receipt.date)}
                          {receipt.sender_name && (
                            <span> · {receipt.sender_name}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`hidden sm:inline text-xs ${
                          CONFIDENCE_STYLE[receipt.confidence] || "text-stone-500"
                        }`}
                      >
                        {receipt.confidence}
                      </span>
                      {!receipt.reimbursable && (
                        <span className="hidden sm:inline text-xs text-stone-600">own</span>
                      )}
                      <span className="text-stone-100 font-mono text-sm">
                        {fmt(receipt.total, receipt.currency)}
                      </span>
                      <span className="text-stone-600 group-hover:text-stone-400 transition-colors">
                        →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {selectedReceipt && (
        <ReceiptDrawer
          receipt={selectedReceipt}
          isAdmin={isAdmin}
          onClose={() => setSelectedReceipt(null)}
          onToggleFlag={handleToggleFlag}
          onDelete={handleDelete}
          onDateChange={handleDateChange}
          onToggleReimbursable={handleToggleReimbursable}
          onToast={(msg, type) =>
            type === "success" ? toast.success(msg) : toast.error(msg)
          }
        />
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
