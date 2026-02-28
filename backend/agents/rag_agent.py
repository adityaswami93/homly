from multiprocessing import context

import requests
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from services.llm_client import get_completion, get_embedding
from pipelines.rag_pipeline import search_articles, rerank_by_recency
from pipelines.embedding_pipeline import embed_articles
from ingestion.news_fetcher import fetch_finance_news, save_articles
from dotenv import load_dotenv

load_dotenv()

MAX_ITERATIONS = 5

# Step 1 — Query decomposition
def decompose_query(question: str) -> list[str]:
    prompt = f"""You are a financial research assistant. Break this question into 1-3 specific search queries to find relevant information.

Question: {question}

Rules:
- If the question is simple and specific, return just 1 query
- If the question is broad or multi-part, break it into 2-3 focused sub-queries
- Each query should be short and search-optimised (3-6 words)
- Return ONLY a JSON array of strings, no other text
- For questions about specific stocks or companies, always include one query with the company name + 'stock news today' and one with the company name + any other companies or topics mentioned

Example:
Question: "How are rising interest rates affecting Singapore property and bank stocks?"
Output: ["Singapore property market interest rates", "Singapore bank stocks Fed rates", "MAS monetary policy 2026"]"""

    response = get_completion(prompt)
    try:
        clean = response.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        queries = json.loads(clean.strip())
        return queries if isinstance(queries, list) else [question]
    except:
        return [question]

def web_search_fallback(query: str) -> list:
    """Search the web when internal DB has insufficient context"""
    try:
        url = "https://newsapi.org/v2/everything"
        params = {
            "q": query,
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": 5,
            "apiKey": os.getenv("NEWSAPI_KEY")
        }
        response = requests.get(url, params=params)
        articles = response.json().get("articles", [])
        # Convert to same format as DB articles
        return [{
            "title": a.get("title"),
            "description": a.get("description"),
            "content": a.get("content"),
            "url": a.get("url"),
            "source": a.get("source", {}).get("name"),
            "published_at": a.get("publishedAt"),
            "similarity": 0.7  # assumed relevance since we searched directly
        } for a in articles if a.get("title")]
    except Exception as e:
        print(f"[Agent] Web search failed: {e}")
        return []

# Step 2 — Evaluate if context is sufficient
def evaluate_context(question: str, articles: list) -> dict:
    if not articles:
        return {"sufficient": False, "reason": "No articles found", "follow_up": question}

    context = "\n".join([f"- {a['title']} ({a['source']}, {a['published_at']})" for a in articles[:10]])

    prompt = f"""You are evaluating whether search results are sufficient to answer a financial question.

    Question: {question}

    Retrieved articles:
    {context}

    Rules:
    - If articles are directly relevant to the question, mark as sufficient
    - If the question is about a specific company event (acquisition, earnings, news) and articles don't mention that company at all, mark as NOT sufficient
    - If articles are completely unrelated to the question, mark as not sufficient
    - Bias towards marking as sufficient — only mark not sufficient if the articles are truly irrelevant
    - Never search more than needed

    Respond in JSON only:
    {{
    "sufficient": true or false,
    "reason": "brief explanation",
    "follow_up": "a better search query if not sufficient, or null if sufficient"
    }}"""

    response = get_completion(prompt)
    try:
        clean = response.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        return json.loads(clean.strip())
    except:
        return {"sufficient": True, "reason": "Could not evaluate", "follow_up": None}

def fetch_and_embed_live(query: str):
    try:
        articles = fetch_finance_news(query)
        if articles:
            save_articles(articles)
            embed_articles()
    except Exception as e:
        print(f"[Agent] Live fetch failed: {e}")
        # Fail silently — agent continues with what it has

# Step 3 — Generate grounded answer with self-evaluation
def generate_and_evaluate(question: str, articles: list) -> dict:
    context = "\n\n".join([
        f"[{i+1}] Title: {a['title']}\nSource: {a['source']}\nDate: {a['published_at']}\nSummary: {a.get('description', '')}"
        for i, a in enumerate(articles)
    ])

    prompt = f"""You are a senior financial analyst. Answer this question using only the articles provided.

    Question: {question}

    Articles:
    {context}

    Instructions:
    - Lead with the key insight in 1-2 sentences
    - Support with specific data points — cite sources by name (e.g. "according to CNA") not by number
    - End with what to watch next
    - Keep the answer under 150 words. Be concise.
    - At the end write: USED_SOURCES: followed by comma-separated article numbers e.g. USED_SOURCES: 1,3
    - After sources write: CONFIDENCE: high, medium, or low based on how well the articles answer the question"""

    response = get_completion(prompt)

    # Parse answer, sources, confidence
    answer = response
    used_indices = set()
    confidence = "medium"

    if "CONFIDENCE:" in response:
        parts = response.split("CONFIDENCE:")
        confidence = parts[1].strip().split()[0].lower()
        response = parts[0].strip()

    if "USED_SOURCES:" in response:
        parts = response.split("USED_SOURCES:")
        answer = parts[0].strip()
        try:
            nums = parts[1].strip().split(",")
            used_indices = {int(n.strip()) - 1 for n in nums if n.strip().isdigit()}
        except:
            used_indices = set(range(len(articles)))
    else:
        answer = response
        used_indices = set(range(len(articles)))

    sources = [
        {"title": articles[i]["title"], "url": articles[i]["url"], "source": articles[i]["source"]}
        for i in sorted(used_indices)
        if i < len(articles)
    ]

    return {
        "answer": answer,
        "sources": sources,
        "confidence": confidence
    }

def ask_agent(question: str) -> dict:
    print(f"\n[Agent] Question: {question}")
    all_articles = []
    seen_urls = set()
    iteration = 0

    queries = decompose_query(question)
    print(f"[Agent] Decomposed into {len(queries)} queries: {queries}")

    live_fetched = False

    while iteration < MAX_ITERATIONS:
        iteration += 1

        for query in queries:
            articles = search_articles(query, match_count=5)
            for a in articles:
                if a["url"] not in seen_urls:
                    seen_urls.add(a["url"])
                    all_articles.append(a)

        ranked = rerank_by_recency(all_articles)
        top = ranked[:10]

        evaluation = evaluate_context(question, top)
        print(f"[Agent] Sufficient: {evaluation['sufficient']} — {evaluation['reason']}")

        if evaluation["sufficient"]:
            break

        if evaluation.get("follow_up") and iteration < MAX_ITERATIONS:
            follow_up = evaluation["follow_up"]
            if not live_fetched:
                fetch_and_embed_live(follow_up)
                live_fetched = True
            else:
                # Already tried live fetch, fall back to direct web search
                print(f"[Agent] Falling back to direct web search")
                live_articles = web_search_fallback(follow_up)
                for a in live_articles:
                    if a["url"] not in seen_urls:
                        seen_urls.add(a["url"])
                        all_articles.append(a)
            queries = [follow_up]
        else:
            break

    final_articles = rerank_by_recency(all_articles)[:5]
    if not final_articles:
        return {
            "answer": "I couldn't find any relevant information about this topic. Try asking about major market indices, Singapore economy, Fed policy, or specific stocks in your watchlist.",
            "sources": [],
            "confidence": "low",
            "iterations": iteration
        }
    result = generate_and_evaluate(question, final_articles)
    result["iterations"] = iteration
    return result


if __name__ == "__main__":
    result = ask_agent("How are rising interest rates affecting Singapore property and bank stocks?")
    print("\nANSWER:")
    print(result["answer"])
    print(f"\nConfidence: {result['confidence']}")
    print(f"Iterations: {result['iterations']}")
    print("\nSOURCES:")
    for s in result["sources"]:
        print(f"- {s['title']} ({s['source']})")