import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import resend
from dotenv import load_dotenv
from supabase import create_client
from services.llm_client import get_completion
from datetime import datetime

load_dotenv()

resend.api_key = os.getenv("RESEND_API_KEY")
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

def get_users_for_digest() -> list:
    response = supabase.table("user_preferences")\
        .select("*")\
        .eq("digest_enabled", True)\
        .execute()
    return response.data

def get_user_email(user_id: str) -> str:
    response = supabase.rpc("get_user_emails").execute()
    for user in response.data:
        if user["id"] == user_id:
            return user["email"]
    return None

def get_recent_articles_for_topics(topics: list) -> list:
    all_articles = []
    for topic in topics:
        response = supabase.table("articles")\
            .select("title, description, source, url, published_at")\
            .ilike("title", f"%{topic}%")\
            .order("published_at", desc=True)\
            .limit(5)\
            .execute()
        all_articles.extend(response.data)

    # Deduplicate
    seen = set()
    unique = []
    for a in all_articles:
        if a["title"] not in seen:
            seen.add(a["title"])
            unique.append(a)
    return unique[:20]

def generate_digest(articles: list, topics: list) -> str:
    if not articles:
        return "No relevant news found for your topics today."

    topics_str = ", ".join(topics)
    context = "\n\n".join([
        f"Title: {a['title']}\nSource: {a['source']}\nSummary: {a.get('description', '')}"
        for a in articles
    ])

    prompt = f"""You are a financial analyst writing a personalised morning briefing for an investor in Singapore.

Their topics of interest: {topics_str}

Based on these recent articles, write a concise morning digest covering:
1. Key market movements relevant to their topics
2. Singapore and Asia specific developments
3. What to watch today

Articles:
{context}

Write in a clear, professional tone. Be specific to their topics of interest."""

    return get_completion(prompt)

def send_digest(email: str, digest: str, topics: list):
    topics_str = ", ".join(topics)
    resend.Emails.send({
        "from": "Finclaro <onboarding@resend.dev>",
        "to": email,
        "subject": f"Finclaro Morning Digest — {datetime.now().strftime('%B %d, %Y')}",
        "html": f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #111;">
            <h2 style="color: #10b981;">Finclaro Morning Digest</h2>
            <p style="color: #666;">Your topics: {topics_str}</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb;">
            <div style="white-space: pre-wrap; line-height: 1.6;">{digest}</div>
        </div>
        """
    })