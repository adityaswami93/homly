import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import resend
from dotenv import load_dotenv
from supabase import create_client
from services.llm_client import get_completion
from pipelines.rag_pipeline import search_articles
from datetime import datetime

load_dotenv()

resend.api_key = os.getenv("RESEND_API_KEY")
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

def get_all_users_with_watchlists() -> list:
    response = supabase.table("watchlist")\
        .select("user_id")\
        .execute()
    user_ids = list(set([r["user_id"] for r in response.data]))
    return user_ids

def get_user_watchlist(user_id: str) -> list:
    response = supabase.table("watchlist")\
        .select("*")\
        .eq("user_id", user_id)\
        .execute()
    return response.data

def get_user_email(user_id: str) -> str:
    response = supabase.rpc("get_user_emails").execute()
    for user in response.data:
        if user["id"] == user_id:
            return user["email"]
    return None

def generate_watchlist_digest(watchlist: list) -> str:
    all_articles = []
    
    for item in watchlist:
        articles = search_articles(item["symbol"], match_count=3)
        all_articles.extend(articles)

    if not all_articles:
        return "No relevant news found for your watchlist this week."

    # Deduplicate by title
    seen = set()
    unique_articles = []
    for a in all_articles:
        if a["title"] not in seen:
            seen.add(a["title"])
            unique_articles.append(a)

    watchlist_labels = ", ".join([w["symbol"] for w in watchlist])
    
    context = "\n\n".join([
        f"Title: {a['title']}\nSource: {a['source']}\nSummary: {a.get('description', '')}"
        for a in unique_articles[:15]
    ])

    prompt = f"""You are a financial analyst writing a personalised weekly digest for an investor.

Their watchlist includes: {watchlist_labels}

Based on these recent news articles, write a concise weekly digest covering:
1. Key developments for each watchlist item
2. What changed this week and why it matters
3. What to watch next week

Articles:
{context}

Be specific to their watchlist items. Write in a clear, professional tone."""

    return get_completion(prompt)

def send_watchlist_digest(email: str, digest: str, watchlist: list):
    labels = ", ".join([w["symbol"] for w in watchlist])
    resend.Emails.send({
        "from": "Finclaro <onboarding@resend.dev>",
        "to": email,
        "subject": f"Finclaro Weekly Digest — {datetime.now().strftime('%B %d, %Y')}",
        "html": f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #111;">
            <h2 style="color: #10b981;">Finclaro Weekly Digest</h2>
            <p style="color: #666;">Tracking: {labels}</p>
            <hr style="border: none; border-top: 1px solid #eee;" />
            <pre style="white-space: pre-wrap; line-height: 1.7; font-family: sans-serif;">{digest}</pre>
            <hr style="border: none; border-top: 1px solid #eee;" />
            <p style="color: #999; font-size: 12px;">Finclaro · Built in Singapore</p>
        </div>
        """
    })
    print(f"Watchlist digest sent to {email}")

def run_watchlist_digest():
    print("Running watchlist digest...")
    user_ids = get_all_users_with_watchlists()
    print(f"Found {len(user_ids)} users with watchlists")

    for user_id in user_ids:
        try:
            watchlist = get_user_watchlist(user_id)
            if not watchlist:
                continue
            email = get_user_email(user_id)
            if not email:
                print(f"No email found for user {user_id}")
                continue
            digest = generate_watchlist_digest(watchlist)
            send_watchlist_digest(email, digest, watchlist)
        except Exception as e:
            print(f"Error processing user {user_id}: {e}")

if __name__ == "__main__":
    run_watchlist_digest()