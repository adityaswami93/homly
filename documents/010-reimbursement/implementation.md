# 010 — Reimbursement Tracking

## Problem
All receipts treated the same regardless of who submitted them. No way to
distinguish owner's personal expenses from helper's reimbursable expenses.
No way to track what has been paid.

## Solution
- reimbursable flag on each receipt (default true based on mode)
- Three modes: all, none, helpers_only
- Dashboard shows two totals: reimbursable vs own spending
- Mark as paid button creates a reimbursement record
- Toggle reimbursable per receipt from drawer
- WhatsApp summary only includes reimbursable receipts
- History filter toggle: all vs reimbursable only

## Technical notes
- reimbursement_mode and helper_identifiers stored in settings table
- get_reimbursable() called on every process-receipt based on sender + mode
- reimbursements table tracks payment history per week
- optimistic UI updates for toggle reimbursable
