# 004 — Sender Tracking

## Problem
No way to know which household member (owner or helper) posted a receipt.

## Solution
Extract sender name and phone from Baileys message object. Store in receipts table. Show in dashboard and weekly summary.

## Claude Code prompt
(See session transcript.)

## Technical notes
- `msg.pushName` — display name of sender
- `msg.key.participant` — JID of sender in group context (format: `628xxx@s.whatsapp.net`)
- Phone extracted by splitting JID on `@`
- Currently not populating — debug needed (see known issues)
