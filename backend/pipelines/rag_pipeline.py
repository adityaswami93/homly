import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client
from services.llm_client import get_embedding, get_completion
from dotenv import load_dotenv
from datetime import datetime, timezone, timedelta

load_dotenv()

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

def search_articles(query: str, match_count: int = 10) -> list:
    embedding = get_embedding(query)
    response = supabase.rpc("match_articles", {
        "query_embedding": embedding,
        "match_count": match_count
    }).execute()
    return response.data

def rerank_by_recency(articles: list, recency_weight: float = 0.3) -> list:
    now = datetime.now(timezone.utc)
    
    for article in articles:
        similarity = article.get("similarity", 0)
        
        # Calculate recency score — articles from last 24h get 1.0, older get less
        published = article.get("published_at")
        if published:
            try:
                pub_date = datetime.fromisoformat(published.replace("Z", "+00:00"))
                age_hours = (now - pub_date).total_seconds() / 3600
                recency_score = max(0, 1 - (age_hours / 168))  # 168 hours = 1 week
            except:
                recency_score = 0.5
        else:
            recency_score = 0.5
        
        # Combined score
        article["combined_score"] = (1 - recency_weight) * similarity + recency_weight * recency_score
    
    return sorted(articles, key=lambda x: x["combined_score"], reverse=True)

def ask(question: str) -> dict:
    # Step 1 — retrieve more articles
    articles = search_articles(question, match_count=10)
    
    if not articles:
        return {"answer": "No relevant articles found.", "sources": []}

    # Step 2 — rerank by recency
    articles = rerank_by_recency(articles)
    
    # Step 3 — take top 5 after reranking
    top_articles = articles[:5]

    # Step 4 — build context
    context = "\n\n".join([
        f"Title: {a['title']}\nSource: {a['source']}\nDate: {a['published_at']}\nSummary: {a['description']}"
        for a in top_articles
    ])

    # Step 5 — generate answer with source tracking
    articles_text = "\n".join([f"[{i+1}] Title: {a['title']}\nSource: {a['source']}\nDate: {a['published_at']}\nSummary: {a['description']}" for i, a in enumerate(top_articles)])

    prompt = f"""You are a financial analyst. Answer this question concisely using only the most relevant articles below.

    Question: {question}

    Articles:
    {articles_text}

    Instructions:
    - Use only articles directly relevant to the question — ignore tangential ones
    - Lead with the key insight in 1-2 sentences
    - Support with specific data points and source names
    - End with what to watch next
    - Keep the total answer under 150 words
    - At the end, on a new line, write: USED_SOURCES: followed by comma-separated article numbers you cited e.g. USED_SOURCES: 1,3,5"""

    answer_raw = get_completion(prompt)

    # Parse which sources were actually used
    used_indices = set()
    if "USED_SOURCES:" in answer_raw:
        parts = answer_raw.split("USED_SOURCES:")
        answer = parts[0].strip()
        try:
            nums = parts[1].strip().split(",")
            used_indices = {int(n.strip()) - 1 for n in nums if n.strip().isdigit()}
        except:
            answer = answer_raw
            used_indices = set(range(len(top_articles)))
    else:
        answer = answer_raw
        used_indices = set(range(len(top_articles)))

    sources = [
        {"title": top_articles[i]["title"], "url": top_articles[i]["url"], "source": top_articles[i]["source"]}
        for i in sorted(used_indices)
        if i < len(top_articles)
    ]
        
    return {
        "answer": answer,
        "sources": sources
    }

if __name__ == "__main__":
    result = ask("What is happening with interest rates?")
    print("\nANSWER:")
    print(result["answer"])
    print("\nSOURCES:")
    for s in result["sources"]:
        print(f"- {s['title']} ({s['source']})")