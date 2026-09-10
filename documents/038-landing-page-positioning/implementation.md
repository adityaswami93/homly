# 038 — Landing page positioning and hero A/B test

## Problem

The landing page described a product Homly stopped being around task 013.

Concretely, before this change the page said:

- Hero: **"Household expenses, tracked automatically"**
- Feature cards headlined *Automatic OCR*, *Weekly dashboard*, *WhatsApp summaries*
- Section subtitle: *"Built specifically for Singapore households employing domestic helpers"* —
  followed by six cards, all of which were about receipts

Nothing on the page mentioned chores, helper leave, insurance renewals or coverage gaps,
pantry and shopping lists, budgets, savings and net worth, price intelligence, the chat
assistant, or the proactive morning monitor. A visitor could read the entire page and
conclude Homly was a receipt scanner, because that is what the page said it was.

## Root cause

The page was written at 001-era scope and never revised as 013–037 shipped. This is not
an oversight by any one change: **marketing copy has no test and no CI check**, so unlike
a stale function signature, nothing fails when it drifts. The only thing that catches it
is someone reading the page and comparing it to the product.

Worth noting the same class of drift the `documents/README.md` 025–036 gap records — the
features shipped, the description of them did not.

## Solution

Two things: a positioning rewrite, and a test to settle the one question the rewrite
could not answer from the chair.

### Positioning

Homly is a **household manager for families**. The brand idea underneath it:

> Large households have always had someone running them — a house manager, an estate
> manager, a family office. Those families do not track their own receipts or chase
> their own renewals. Homly is that role for everyone else.

That gives a category (household manager), a reason to exist that is not "another app",
and a frame that survives scale — chores, helper leave, supplies and renewals *are*
household-management work, not finance work.

The page is built around two pillars — *Your home* (chores, helper leave, pantry,
shopping lists, daily nudges) and *Your money* (receipts, budgets, reimbursement,
insurance cover and gaps, savings and net worth, price trends) — plus a section on how
it behaves (you just ask, it reads, it learns your household, it speaks up first), and
one on where to reach it.

### A/B test

Whether the category claim or the pain lands better with a Singapore family employing a
helper is a question about that audience, not about the product. It was being argued
rather than measured, so the page ships two hero framings and records which one a signup
came from.

## Approaches tried and rejected

**"Concierge" as the category word.** Shipped, then replaced by "manager" — and the
reason matters, because concierge is the more charming word and someone will want it
back. Two problems. First, *accuracy*: a concierge waits at a desk to be asked. This
product runs an unattended morning check and raises things nobody requested
(`agents/proactive_agent.py`), which is manager behaviour, not concierge behaviour —
the metaphor was under-describing the most differentiated thing in the codebase.
Second, *audience*: concierge carries a luxury-hotel connotation, and in Singapore
employing a domestic helper is ordinary middle class, not elite. The frame risked
reading as *not for me* to exactly the person it was aimed at. "Manager" is plainer and
truer, and it lets the page make the real claim — that this role has always existed for
households that could staff it.

**Leading with "Family Operating System"** (the repo's own description). Rejected for
customer-facing copy. An OS is something *you* operate; an agent is something that
operates things *for* you — leading with the OS undercuts the promise, and it is a
builder's frame, not a buyer's. It remains the right internal and investor framing,
which is why it stays in `CLAUDE.md` and not on the page.

**Renaming the product.** Considered; rejected. The domain is Vercel-assigned so a rename
is cheap in mechanics, but "Homly" is short and roots on *home*, which stretches to cover
chores/insurance/pantry without straining. The problem was never the name — it was that
the copy undersold it.

**Leading with WhatsApp.** Shipped, then reverted within this same PR. The hero read
*"Your household, handled in WhatsApp"*. This is wrong, and the reason is worth keeping:
**WhatsApp is an interface, not the identity.** Leading with the channel frames Homly as
a chat bot and caps its ceiling at the channel, which is a positioning error the whole
architecture argues against — the dashboard is an equal door into the same agent. The
adoption argument ("no app for your helper") is real and survives, but as a supporting
point under "Reach it wherever you already are", not as the headline.

**A "What's next" roadmap section.** Shipped, then removed. It used investor/developer
vocabulary — *MCP*, *"a single AI layer"*, *"silo"* — on a page whose reader is a parent
employing a helper, and a roadmap section advertises what you have **not** built to
someone deciding whether to trust you with their receipts. Don't reintroduce it.

**A problem-first ("pain") hero.** Built, then replaced. The headline was *"You
shouldn't have to be your household's admin"*, with a subhead listing failures —
"Receipts nobody logs. A budget nobody tracks." It tested well as a *hypothesis*, but it
conflicts with the voice the brand settled on: straightforward and positively stated.
Running a test arm you would refuse to ship on brand grounds answers nothing, so the
second arm is now `system` (the family-operating-system framing) — role vs system, both
stated positively.

**Negation as a copy device.** The page leaned on it heavily — *"Not a ledger you fill
in"*, *"no forms, no filters"*, *"nobody types"*, and five FAQ answers opening with
"No." Each was defensible alone; together they made the page read defensive, as though
it were rebutting accusations. Every one is now a positive statement of what the product
does, and the FAQ questions were reframed so the answers do not have to open by denying
something ("Is Homly an expense tracker?" → "What does Homly manage?").

**Deciding the framing by argument.** Rejected in favour of the test below. Several
different positionings were argued with equal confidence during this PR, which is itself
the evidence that argument was not going to settle it.

## Why `useSyncExternalStore` and not `useEffect`

The obvious implementation — `useState` plus a `useEffect` that reads `localStorage` and
calls `setVariant` — is wrong here twice over:

1. The frontend is a **static export** (`output: export`). Choosing the variant during
   render would bake one variant into the prerendered HTML and hydrate inconsistently.
2. The effect version trips `react-hooks/set-state-in-effect`, a rule this repo is
   already carrying debt on (`app/insights/page.tsx`, `lib/HouseholdContext.tsx`). Adding
   a third instance to a rule someone will eventually have to clean up is not free.

`useSyncExternalStore` is the supported way to render a server snapshot and swap to a
client-only value after hydration. The snapshot function must be **stable between calls**,
so the resolved variant is cached in a module-level variable — recomputing would re-roll
the coin on every read and loop forever.

The server snapshot is `manager`, which means a visitor with JS disabled gets a coherent
page rather than a blank hero.

## Deliberately narrow

These are tight on purpose. Please do not "fix" them.

- **Only the headline and subhead differ between variants.** Everything below the hero is
  byte-identical. If the pillars or CTA also varied, a conversion difference would not be
  attributable to the framing and the test would answer nothing.
- **`variant` is whitelisted server-side** against the two known values and stored `NULL`
  otherwise. `POST /waitlist` is unauthenticated, so the field is attacker-controlled text
  going into a column; the endpoint must not trust it.
- **A forced `?v=` is not persisted.** Previewing a specific variant must not overwrite
  the visitor's real assignment, or the sample gets poisoned by the team's own previews.
- **Assignment is sticky per browser**, so a returning visitor never sees the page change
  under them.

## What was left out

- **The proof gap — the biggest remaining weakness.** The page makes large claims and
  offers no evidence: no testimonial, no signup count, no real dashboard screenshot. The
  chat panel is a designed mock with invented names (*Priya*, `$84.20`), and a careful
  reader can tell. For a product asking a family to connect its finances and its helper's
  activity to an AI, trust is the binding constraint. This needs a real artifact and
  cannot be closed by copy.
- **Impressions are not recorded.** Only signups carry a `variant`. Comparing raw signup
  counts per variant is valid *only because assignment is a 50/50 coin*, which makes
  exposure roughly equal at reasonable sample sizes. It is **not** a true conversion rate,
  and it will mislead if the split is ever changed away from 50/50 or if traffic is driven
  to one variant via `?v=`. Recording impressions is the obvious next step if this matters.
- **No statistical stopping rule.** Nothing computes significance; that is a human
  judgement on the resulting counts.
- **Pricing section untouched beyond wording.** Showing a greyed "after launch" tier that
  enumerates what the free tier does *not* include arguably suppresses waitlist signups.
  Flagged, not changed.
- **Privacy is still FAQ item five**, inside a collapsed accordion, on a product that
  reads every receipt a household generates. Arguably the loudest unspoken objection and
  it is buried.

## Reading the result

```sql
SELECT variant, COUNT(*)
FROM waitlist
WHERE variant IS NOT NULL
GROUP BY variant;
```

`variant IS NULL` covers every signup from before this shipped, plus any client that
omits the field. Those rows are not evidence for either side — exclude them.
