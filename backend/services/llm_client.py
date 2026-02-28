import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# OpenRouter behind the facade - swap this out without touching anything else
_client = OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
)

# Change these two constants to swap models globally
_COMPLETION_MODEL = "openai/gpt-4o-mini"
_EMBEDDING_MODEL = "openai/text-embedding-ada-002"

def get_embedding(text: str) -> list[float]:
    response = _client.embeddings.create(
        input=text,
        model=_EMBEDDING_MODEL
    )
    return response.data[0].embedding

def get_completion(prompt: str, system: str = "You are a helpful financial analyst.") -> str:
    response = _client.chat.completions.create(
        model=_COMPLETION_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ]
    )
    return response.choices[0].message.content