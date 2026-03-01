# 005 — Send Messages from Dashboard

## Problem
No way to manually trigger a WhatsApp message without waiting for the scheduled summary.

## Solution
Message queue in FastAPI. Dashboard sends message type to queue. Bot polls queue every 10 seconds and sends pending messages to group.

## Claude Code prompt
(See session transcript.)

## Technical notes
- In-memory queue (list) — cleared on bot restart, acceptable for now
- Bot polls `/internal/messages` every 10 seconds
- Message types: `week_total`, `last7days_total`, `custom`
- Custom message type reserved for future use
