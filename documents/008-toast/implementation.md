# 008 — Toast Notifications

## Problem
User actions (save settings, delete receipt, send to group, etc.) gave no feedback. `alert()` was used in admin, and errors were silently swallowed elsewhere.

## Solution
- Reusable `Toast` component and `useToast` hook with no external dependencies
- Four types: success, error, warning, info
- Auto-dismiss after 4 seconds with slide-in animation; manually dismissable
- Wired into all five interactive pages

## Technical notes
- `useToast` returns `{ toasts, dismissToast, toast }` — `toast.success/error/warning/info(msg, duration?)`
- Each toast gets a random ID via `Math.random().toString(36).slice(2)` — low collision risk for this use case
- Animation uses `requestAnimationFrame` to trigger CSS transition after mount (avoids initial paint in hidden state)
- `ToastContainer` is fixed-positioned `bottom-6 right-6` — consistent across all pages
- `ReceiptDrawer` is a child component that needs toast; it receives `onToast: (msg, type) => void` as a prop rather than calling `useToast` directly (hooks can only be called at the component top level, and ReceiptDrawer already manages its own state)
