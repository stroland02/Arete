from typing import Dict, Any
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

from arete_agents.config import get_settings
from arete_agents.llm.base import get_llm
from arete_agents.models.pr import PRContext
from arete_agents.orchestrator import ReviewOrchestrator
from arete_agents.agents.chat import ChatAgent

app = FastAPI()

@app.post("/review")
def review(pr: PRContext):
    settings = get_settings()
    llm = get_llm(settings)
    orch = ReviewOrchestrator(llm=llm)
    result = orch.run(pr)
    return result

@app.post("/chat", response_class=PlainTextResponse)
def chat(context: Dict[str, Any]):
    settings = get_settings()
    llm = get_llm(settings)
    agent = ChatAgent(llm=llm)
    result = agent.reply(context)
    return result
