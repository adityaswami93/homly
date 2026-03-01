# 008 — Toast Notifications — Release

## What was built
Toast notification system wired across all interactive pages. Replaces `alert()`, silent error swallowing, and inline error paragraphs on onboarding.

## Files changed
- `frontend/app/components/Toast.tsx` — new; `Toast` + `ToastContainer` components with slide-in animation and auto-dismiss
- `frontend/lib/toast.ts` — new; `useToast` hook
- `frontend/app/admin/page.tsx` — replaced `alert()` with `toast.error`; added `toast.success` on invite sent
- `frontend/app/settings/page.tsx` — added `toast.success("Settings saved")` and `toast.error("Failed to save settings")` in `handleSave`
- `frontend/app/dashboard/page.tsx` — `handleSendTotal` uses toast; `ReceiptDrawer.handleDelete` uses `onToast` prop; removed `sent`/`setSent` state
- `frontend/app/onboarding/page.tsx` — replaced `setError` + inline error paragraph with `toast.error` for invite and household creation failures
- `frontend/app/login/page.tsx` — `toast.success` on forgot password and magic link email sent

## Known issues
None.
