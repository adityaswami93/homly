# 011 — Mobile Responsive Layout

## Problem

The app was desktop-only. On mobile:
- No navigation (desktop nav was `hidden sm:flex` with no mobile alternative)
- Receipt drawer opened as a full-height right panel, wider than the phone screen
- Summary cards, day-selector grid, category grid, and admin invite form overflowed or were too cramped
- Page content scrolled behind nothing (no bottom nav existed yet), but once bottom nav was added, all pages needed bottom padding to avoid content hiding under it

## Solution

### Mobile bottom navigation (`Navbar.tsx`)
Added a `sm:hidden` fixed bottom nav bar. The existing `hidden sm:flex` desktop header nav is unchanged. Bottom nav uses the same `NAV_ITEMS` array plus the super-admin item, showing abbreviated labels (`short` field). It sits at `z-10` with `bg-[#0f0e0c]/95 backdrop-blur-sm` to match the header.

### Bottom padding on all pages
All page content containers got `pb-24 sm:pb-8` (or equivalent) so content scrolls clear of the 56px bottom nav on mobile. Without this, the last list item or save button sits behind the nav.

### Receipt drawer → bottom sheet on mobile (`dashboard/page.tsx`)
Changed the overlay from `flex justify-end` to `flex items-end sm:items-stretch sm:justify-end`. The panel changes from `h-full max-w-md` (right panel) to `h-[88vh] rounded-t-2xl` on mobile and `sm:h-full sm:max-w-md sm:rounded-none` on desktop. The border switches from `border-l` (desktop) to `border-t` (mobile).

### Summary cards compact on mobile (`dashboard/page.tsx`)
Grid gap: `gap-2 sm:gap-3`. Card padding: `p-3 sm:p-4`. Value text: `text-sm sm:text-lg`. Cards stay 3 columns on all sizes — at 375px each card is ~115px wide which fits short monetary values.

### Week navigator header (`dashboard/page.tsx`)
Changed outer flex to `items-start gap-3` with `min-w-0` on the title side and `shrink-0` on the button side to prevent overflow. "Send to group" text: `hidden sm:inline` with just "📤" visible on mobile.

### Receipt row (`dashboard/page.tsx`)
Confidence badge: `hidden sm:inline`. Amount and arrow remain visible. Right side uses `shrink-0` so it never wraps.

### Day selector grid (`settings/page.tsx`)
`grid-cols-4` → `grid-cols-4 sm:grid-cols-7`. On mobile the 7 days show in 2 rows (4+3). On sm+ they show in a single row.

### Category grid (`history/page.tsx`)
`grid-cols-2` → `grid-cols-1 sm:grid-cols-2`. On mobile each category + amount is its own full-width row, avoiding text truncation.

### Admin invite form (`admin/page.tsx`)
Outer container: `flex-col sm:flex-row sm:flex-wrap`. Input: `w-full sm:flex-1 sm:min-w-48`. Selects and button: `w-full sm:w-auto`. Stacks vertically on mobile, horizontal row on desktop.

### QR code size (`setup/page.tsx`)
`w-56 h-56` → `w-48 h-48 sm:w-56 sm:h-56`. Still scannable at 192px on mobile.

## Technical notes

- `pb-safe` class is referenced in Navbar for bottom nav (`py-2 pb-safe`) — if `tailwindcss-safe-area` plugin is not installed this falls back to `py-2`. For production on iOS, install the plugin and add `pb-[env(safe-area-inset-bottom)]` to avoid the home indicator obscuring nav items.
- The bottom nav `z-10` matches the header — they never overlap since one is `sticky top-0` and one is `fixed bottom-0`.
- All responsive changes use the `sm:` breakpoint (640px) as the desktop/mobile boundary, consistent with the rest of the codebase.
