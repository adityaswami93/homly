import requests
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

NEWSAPI_KEY = os.getenv("NEWSAPI_KEY")
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

QUERIES = [
    "Federal Reserve interest rates",
    "MAS monetary policy Singapore",
    "global stock markets",
    "Singapore economy",
    "inflation CPI",
    "US economy recession",
    "China economy markets",
    "oil prices commodities",
    "cryptocurrency bitcoin",
    "SGX Singapore stocks"
]

def fetch_finance_news(query: str) -> list:
    url = "https://newsapi.org/v2/everything"
    params = {
        "q": query,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 10,
        "apiKey": NEWSAPI_KEY
    }
    response = requests.get(url, params=params)
    return response.json().get("articles", [])

def save_articles(articles: list):
    saved = 0
    for article in articles:
        data = {
            "title": article.get("title"),
            "description": article.get("description"),
            "content": article.get("content"),
            "url": article.get("url"),
            "source": article.get("source", {}).get("name"),
            "published_at": article.get("publishedAt")
        }
        try:
            supabase.table("articles").upsert(data, on_conflict="url").execute()
            saved += 1
        except Exception as e:
            print(f"Error saving article: {e}")
    return saved

def run():
    total = 0
    for query in QUERIES:
        print(f"Fetching: {query}")
        articles = fetch_finance_news(query)
        saved = save_articles(articles)
        total += saved
        print(f"  Saved {saved} articles")
    print(f"\nTotal articles saved: {total}")

if __name__ == "__main__":
    run()