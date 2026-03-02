# 010 — Setup Page: Group Selection UX

## Problem

Three gaps in the setup page group picker:

1. **No persistence** — the saved group was never shown on page load. Every time an admin opened the setup page, Step 2 looked like nothing had been configured, even if a group was already active. There was no way to tell which group the bot was monitoring without checking the DB directly.

2. **No way to change the group** — once a group was saved (in the previous session), the only way to change it was to re-select from the list and save again — but the UI didn't make that obvious because there was no "current group" shown.

3. **No search** — households with many WhatsApp groups had to scroll through an unsorted list to find the right one.

## Solution

### Saved group display
On mount (after `user` is available), fetch `GET /settings` and read `group_jid` + `group_name`. If a group is already configured, show it in a green-bordered card with an "Active group" label instead of the picker.

### Change group flow
A "Change group" button replaces the saved group card with the full picker. A "Cancel" button appears alongside "Save group" so the user can back out without overwriting the current setting. On save, the card updates immediately with the new group.

### Search
A text input above the group list filters groups by name in real time (`String.includes`, case-insensitive). Shows a "No groups match" message when the search has no results. Group list is capped at `max-h-64` with scroll so it never overflows the page.

## Technical notes

- `savedGroup` (the DB-persisted group) and `selected` (in-picker selection) are separate state. This keeps the "Active group" card stable while the user browses the picker.
- `changing` flag controls which view is shown: saved card vs picker. Toggled by "Change group" / "Cancel".
- After a successful save: `savedGroup` updates to the newly selected group, `changing` resets to false, `selected` and `search` clear.
- The settings fetch on mount is fire-and-forget (`.catch(() => {})`). If it fails (e.g. no settings row yet), `savedGroup` stays null and the picker shows normally.
- The group list is sourced from `whatsapp_state.groups` (polled every 3s from `/setup/state`), which is populated by the bot on connect. Groups only appear once WhatsApp is connected, so the picker is gated behind `connected === true`.
