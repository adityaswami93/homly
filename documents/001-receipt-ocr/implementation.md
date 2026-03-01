# 001 — Receipt OCR

## Problem
Helper sends receipt photos to a WhatsApp group. Manually checking and totalling receipts each week is tedious and error-prone.

## Solution
WhatsApp bot (Baileys) monitors the group, detects images, runs OCR via Gemini Flash on OpenRouter, saves structured data to Supabase, and displays it on a Next.js dashboard.

## Architecture
- WhatsApp: Baileys v6 (unofficial protocol, monitors existing group)
- Backend: FastAPI on Railway
- OCR: Gemini 2.5 Flash Lite via OpenRouter ($0.001/image)
- Database: Supabase PostgreSQL
- Frontend: Next.js on Vercel

## Claude Code prompt
(Initial build — full codebase created from scratch. See session transcript for full prompt.)

## Technical notes
- Baileys version pinned to 6.7.18 due to protocol compatibility issues with RC versions
- Version override required: `version: [2, 3000, 1033893291]` in makeWASocket config
- WhatsApp bot placed under `backend/whatsapp/` to keep Railway deployment as one repo
- OCR model: `google/gemini-2.5-flash-lite` — multimodal, $0.10/M input tokens, not deprecated
- Confidence scoring: high/medium/low — low confidence auto-flags receipt for manual review
- Deduplication via `whatsapp_message_id` unique constraint prevents double-counting
