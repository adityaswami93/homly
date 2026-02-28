import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client
from services.llm_client import get_embedding
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

def embed_articles():
    response = supabase.table("articles")\
        .select("id, title, description, content")\
        .is_("embedding", "null")\
        .execute()
    
    articles = response.data
    print(f"Found {len(articles)} articles to embed")

    for article in articles:
        # Use full content if available, fall back to description
        body = article.get("content") or article.get("description") or ""
        text = f"{article['title']}. {body}"
        # Truncate to avoid token limits — ada-002 supports 8191 tokens
        text = text[:6000]
        
        try:
            embedding = get_embedding(text)
            supabase.table("articles").update(
                {"embedding": embedding}
            ).eq("id", article["id"]).execute()
            print(f"Embedded: {article['title'][:60]}")
        except Exception as e:
            print(f"Error embedding article: {e}")

if __name__ == "__main__":
    embed_articles()