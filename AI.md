# How AI Is Used in Homly

Homly uses AI at several points in the product, with more planned as the platform grows.

---

## Receipt OCR (shipped)

The core AI feature. When a household member sends a receipt photo to the WhatsApp group, the bot passes the image to a vision language model via [OpenRouter](https://openrouter.ai). The model returns structured JSON:

```json
{
  "vendor": "FairPrice",
  "date": "2024-11-15",
  "subtotal": 42.30,
  "tax": 3.38,
  "total": 45.68,
  "currency": "SGD",
  "confidence": "high",
  "items": [
    { "name": "Jasmine Rice 5kg", "qty": 1, "unit_price": 12.90, "line_total": 12.90, "category": "groceries" },
    { "name": "Dish Soap", "qty": 2, "unit_price": 3.50, "line_total": 7.00, "category": "household" }
  ]
}
```

The model is prompted to:
- Extract all line items with quantity, unit price, and category
- Assign one of six categories: `groceries`, `household`, `personal care`, `food & beverage`, `transport`, `other`
- Return a `confidence` score (`high` / `medium` / `low`) — low-confidence receipts are flagged in the dashboard for manual review

The LLM call is wrapped in a thin facade (`services/llm_client.py`) so the underlying model can be swapped without touching the agent logic.

---

## Natural Language Insurance Queries (shipped)

The WhatsApp bot recognises insurance-related questions in the group chat (e.g. "when does our car insurance renew?", "what's our health coverage?") and replies with a formatted summary of the household's active policies — no dashboard visit required.

Detection uses keyword matching today; the plan is to replace this with an LLM intent classifier as query variety grows.

---

## Price Intelligence (shipped)

Cross-household item price data is aggregated (anonymised, opt-in) to surface price comparisons. The `GET /admin/price-intelligence` endpoint returns per-item price trends across vendors, which admins can use to identify where the household is overpaying.

---

## Coverage Checker (shipped)

The Insurance → Coverage page lets any household member ask a plain-English question about their coverage — "am I covered if I'm hospitalised overseas?", "what is my total death benefit?" — and get an answer grounded in their household's actual policies.

The flow:
1. User submits a natural language question
2. Backend retrieves the household's active policies
3. LLM receives both the question and policy data, and returns a structured answer with `confidence` and `relevant_policies` (the specific policies cited)
4. UI renders the answer with the supporting policy excerpts highlighted

This is a RAG (retrieval-augmented generation) pattern — the model never answers from general knowledge alone; every answer is anchored to the household's own data.

---

## Coverage Gap Analysis (shipped)

The Insurance → Gaps page analyses the household's profile (age, marital status, number of children, employment type, mortgage, car ownership) against their active policies and identifies coverage gaps — e.g. no income protection, no critical illness cover, insufficient life cover given dependants.

The LLM receives the household profile and the full policy list and returns a prioritised list of gaps with reasoning, giving households a personalised risk map without requiring a financial advisor.

---

## Planned

### Anomaly Detection
Flag when an item is priced significantly above the household's own history or cross-household median. Surfaced passively in the dashboard without requiring any user action.

### Smarter Categorisation
Fine-tune category assignment using the household's own correction history — if a user repeatedly recategorises a vendor's items, the model learns the preference.

### Vendor Negotiation Drafts
Use price intelligence data to draft comparison summaries for recurring bills (broadband, insurance, electricity) that a household member can send directly to a provider or broker.

### Conversational Budget Assistant
Allow members to ask budget questions in the WhatsApp group ("how much have we spent on groceries this month?", "are we on track this week?") and get a natural language answer from the bot.
