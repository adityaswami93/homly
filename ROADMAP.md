# Roadmap

Homly is a family operating system — a platform for the financial and administrative life of a household. The current release covers expenses and insurance. The roadmap adds modules that address the other recurring burdens of running a home.

---

## Now — v1 (shipped)

**Expenses**
- WhatsApp receipt capture → OCR → structured line items with category
- Weekly summaries delivered back to the WhatsApp group
- Overview, History, Analytics, Insights — full spending visibility
- Pantry tracker — stock levels auto-updated from receipts
- Budgets — monthly category budgets with real-time burn rate
- Price Intelligence — cross-household item price comparison by vendor
- Reimburse — track and settle reimbursable amounts

**Insurance**
- Policy manager with provider, coverage type, premium, and renewal date
- Renewal reminders via WhatsApp at 30 and 7 days out
- Coverage Checker — AI answers plain-English coverage questions against your actual policies
- Gap Analysis — AI identifies coverage gaps based on household profile

**Platform**
- Multi-tenant architecture, invite system, role-based access, extensible two-level nav
- Multi-Household Access — one login manages several households (e.g. your own household plus each set of parents), with a household switcher and a per-household default currency

**Savings & Investments**
- Net worth tracker: bank accounts, fixed deposits, retirement funds (CPF/EPF/PPF/NPS and equivalents), stocks, mutual funds, bonds, property — country-agnostic account types with a household-level default currency
- Net worth trend over time, breakdown by account type
- WhatsApp queries — "what's our net worth", account listing, type breakdown

---

## Next — v2

### Tasks & Chores
Assign recurring household tasks to members. Track completion. Bot sends reminders and weekly chore summaries to the group.

### Document & Estate Vault
Store household documents — leases, warranties, utility contracts, and (extended scope) wills, power of attorney, nominations, IDs, and property deeds — with expiry dates. Bot alerts the group before anything lapses.

### Health & Medications
Medication schedule with refill reminders, doctor/appointment tracking, and a vitals log — aimed at retired household members. Needs a recurring-schedule model (the existing one-off `reminders` table isn't sufficient on its own).

### Emergency & Care Contacts
A directory of doctors, specialists, caregivers, and next-of-kin, queryable via WhatsApp (e.g. "what's mum's cardiologist's number").

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
AI-drafted comparison summaries for recurring bills and subscriptions (electricity, broadband, insurance) using cross-household price data, ready to share with providers — covers Bills & Subscriptions tracking rather than needing a separate module.

---

## Known gaps

- The WhatsApp bot's `/remind` command hardcodes `Asia/Singapore` for timestamp display regardless of which household's group it's replying in — incorrect for households outside Singapore (e.g. India-based households). Should read the household's timezone (already stored per-household as `settings.summary_timezone`) instead of hardcoding it.

---

## Principles

- **WhatsApp-first** — new features should work via WhatsApp before they work on the dashboard
- **Zero friction for non-admin members** — helpers and family members should never need to open the app
- **One module at a time** — ship each module fully before starting the next
