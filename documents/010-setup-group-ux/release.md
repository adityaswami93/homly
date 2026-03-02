# 010 — Setup Page: Group Selection UX — Release

## What was built

- **Saved group display** — setup page now loads the current active group from `GET /settings` on mount and shows it in a green card, so admins can always see which group the bot is monitoring
- **Change group flow** — "Change group" button opens the picker; "Cancel" closes it without saving; saving updates the card in place
- **Group search** — text input filters the group list by name in real time, with a scrollable capped-height list

## Files changed

- `frontend/app/setup/page.tsx` — complete rework of group picker state and UI

## Database migrations

None.

## Environment variables

None.

## Deployment steps

Frontend-only change. Deploy to Vercel (auto-deploys on push to main).

## Known issues

None.
