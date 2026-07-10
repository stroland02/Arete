from langchain_google_genai import ChatGoogleGenerativeAI


def build_gemini_llm(api_key: str) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=api_key,
        temperature=0.1,
        max_tokens=8192,
    )
