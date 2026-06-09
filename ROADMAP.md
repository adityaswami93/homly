# Roadmap

Homly is a family operating system — a platform for the financial and administrative life of a household. The current release covers expenses and insurance. The roadmap adds modules that address the other recurring burdens of running a home.

---

## Now — v1 (shipped)

- **Expenses** — WhatsApp receipt capture, OCR, category breakdown, weekly summaries, reimbursement tracking, price intelligence
- **Insurance** — policy manager with automated renewal reminders via WhatsApp
- **Platform shell** — multi-tenant architecture, invite system, role-based access, extensible two-level nav

---

## Next — v2

### Tasks & Chores
Assign recurring household tasks to members. Track completion. Bot sends reminders and weekly chore summaries to the group.

### Document Vault
Store household documents (lease, warranties, utility contracts) with expiry dates. Bot alerts the group before anything lapses.

### Budget Planning
Set monthly category budgets. Dashboard shows burn rate against budget in real time. Bot sends an alert when a category hits 80%.

---

## Later — v3

### Family Calendar
Shared calendar synced to the WhatsApp group. Bot posts daily/weekly agenda summaries and reminds the group of upcoming events.

### Mobile App
Native iOS/Android app for receipt capture directly from the camera roll, push notifications, and offline-first expense entry.

### Smarter Receipt Intelligence
- Detect price anomalies (same item significantly more expensive than usual)
- Suggest category corrections based on household history
- Identify subscriptions hiding in receipts

### Vendor Negotiations
AI-drafted comparison summaries for recurring bills (electricity, broadband, insurance) using cross-household price data, ready to share with providers.

---

## Principles

- **WhatsApp-first** — new features should work via WhatsApp before they work on the dashboard
- **Zero friction for non-admin members** — helpers and family members should never need to open the app
- **One module at a time** — ship each module fully before starting the next
