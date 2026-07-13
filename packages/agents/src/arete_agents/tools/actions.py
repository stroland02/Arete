from langchain_core.tools import tool
from pydantic import BaseModel, Field

class ProposePRInput(BaseModel):
    repo_full_name: str = Field(description="owner/repo of the target repository.")
    title: str = Field(description="PR title.")
    body: str = Field(description="Review-ready markdown body.")
    branch_name: str = Field(description="Must start with 'arete/fix-'.")
    base_branch: str = Field(description="The branch the PR should target.")
    patch_content: str = Field(description="A unified diff string containing the code fix.")

@tool("propose_pr", args_schema=ProposePRInput)
def propose_pr(repo_full_name: str, title: str, body: str, branch_name: str, base_branch: str, patch_content: str) -> str:
    """
    Open a pull request with a patch you authored, for a defect with REAL user or business impact.
    The platform applies your patch and opens the PR while you are still running, and returns the PR URL.
    """
    # Simulate API call to VCS provider
    return f"Successfully proposed PR '{title}' on branch '{branch_name}' targeting '{base_branch}' in {repo_full_name}."

class AskHumanInput(BaseModel):
    question: str = Field(description="The specific question a human must answer for you to continue.")

@tool("ask_human", args_schema=AskHumanInput)
def ask_human(question: str) -> str:
    """
    A human must act or answer before this investigation can continue. The run pauses until they reply.
    """
    # Simulate suspension of state
    return f"Paused run. Sent human prompt: '{question}'. Resuming..."

from arete_agents.tools.memory import add_project_memory

def get_native_action_tools():
    return [propose_pr, ask_human, add_project_memory]
