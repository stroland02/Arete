import logging
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

from arete_agents.agents.chat import ChatAgent
from arete_agents.config import get_settings
from arete_agents.llm.base import get_llms_by_role
from arete_agents.models.pr import PRContext
from arete_agents.orchestrator import ReviewOrchestrator

app = FastAPI()

# Module-level singletons — LangGraph graph compilation is expensive;
# one orchestrator and one chat agent serve all requests. Fail-fast on
# missing/invalid config is intentional (better to crash at startup than
# serve requests with a broken LLM client) — but the raw pydantic
# ValidationError is not actionable on its own, so we log a clear pointer
# to the required env vars before letting the exception propagate and
# take down the process.
try:
    _settings = get_settings()
except Exception:
    logging.critical(
        "Areté agents server failed to start: invalid or missing configuration. "
        "Set ANTHROPIC_API_KEY in the environment or .env file (the pipeline "
        "uses Anthropic Claude models per role).",
        exc_info=True,
    )
    raise
_llms = get_llms_by_role(_settings)
_orchestrator = ReviewOrchestrator(llm=_llms)
_chat_agent = ChatAgent(llm=_llms["chat"])


@app.post("/review")
def review(pr: PRContext):
    return _orchestrator.run(pr)


@app.post("/chat", response_class=PlainTextResponse)
def chat(context: Dict[str, Any]):
    return _chat_agent.reply(context)
