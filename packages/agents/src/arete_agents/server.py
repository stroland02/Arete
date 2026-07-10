from typing import Dict, Any
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

from arete_agents.config import get_settings
from arete_agents.llm.base import get_llm
from arete_agents.models.pr import PRContext
from arete_agents.orchestrator import ReviewOrchestrator
from arete_agents.agents.chat import ChatAgent

app = FastAPI()

# Module-level singletons — LangGraph graph compilation is expensive;
# one orchestrator and one chat agent serve all requests.
_settings = get_settings()
_llm = get_llm(_settings)
_orchestrator = ReviewOrchestrator(llm=_llm)
_chat_agent = ChatAgent(llm=_llm)


@app.post("/review")
def review(pr: PRContext):
    return _orchestrator.run(pr)


@app.post("/chat", response_class=PlainTextResponse)
def chat(context: Dict[str, Any]):
    return _chat_agent.reply(context)
