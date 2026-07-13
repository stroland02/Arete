from langchain_core.tools import tool
import logging

logger = logging.getLogger(__name__)

@tool
def add_project_memory(note: str, kind: str = "project") -> str:
    """
    Persist a newly learned rule about the repository's codebase or infrastructure.
    This rule will be globally available to all future agent runs on this repository.
    Only save high-level architectural rules, paradigms, or strict requirements 
    (e.g., 'Frontend uses Tailwind, no raw CSS' or 'Always use Redis for caching').
    """
    logger.info(f"Adding project memory [{kind}]: {note}")
    # In production, this would make an authenticated REST call to the Node webhook
    # or use a direct async DB pool to write to the AgentMemory Prisma model.
    return f"Successfully saved global {kind} memory: '{note}'"
