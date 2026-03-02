# 011 — Mobile Responsive Layout — Release

## What was built

Full mobile-responsive pass across all pages:
- Mobile bottom navigation bar (fixed, shown only on `< sm`)
- Receipt drawer becomes a bottom sheet on mobile
- All grids, flex rows, and form layouts adapt to small screens
- Bottom padding on all pages to clear the fixed bottom nav

## Files changed

- `frontend/app/components/Navbar.tsx` — added `sm:hidden` fixed bottom nav; added `short` label to `NAV_ITEMS`; `allNavItems` computed to include super-admin item
- `frontend/app/dashboard/page.tsx` — bottom-sheet drawer, `items-start sm:justify-end` overlay, `gap-2 sm:gap-3` summary grid, `p-3 sm:p-4` card padding, `text-sm sm:text-lg` value text, `shrink-0` on nav buttons, `hidden sm:inline` confidence badge, `pb-24 sm:pb-8` content padding
- `frontend/app/settings/page.tsx` — `grid-cols-4 sm:grid-cols-7` day selector, `pb-24 sm:pb-12`
- `frontend/app/history/page.tsx` — `grid-cols-1 sm:grid-cols-2` category grid, `pb-24 sm:pb-8`
- `frontend/app/admin/page.tsx` — `flex-col sm:flex-row` invite form, full-width inputs/selects/button on mobile, `pb-24 sm:pb-8`
- `frontend/app/setup/page.tsx` — `w-48 sm:w-56` QR code, `pb-24 sm:pb-12`
- `CLAUDE.md` — added **Mobile responsiveness** section under Frontend conventions

## Database migrations

None.

## Environment variables

None.

## Deployment steps

Frontend-only. Deploy to Vercel (auto-deploys on push to main).

Optional follow-up: install `tailwindcss-safe-area` plugin and add `pb-[env(safe-area-inset-bottom)]` to the bottom nav for proper iOS home indicator clearance.

## Known issues

- `pb-safe` in bottom nav Tailwind class is not a built-in utility — falls back to `py-2` padding if the safe-area plugin is not installed. Functional on all devices, but on iPhone with home indicator the nav items may sit slightly low.
- Super-admin nav item shows on mobile bottom nav (when applicable) — if there are 5+ items the bottom nav can get crowded on very narrow screens (< 320px).
