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

class SilenceAsNoiseInput(BaseModel):
    issue_id: str = Field(description="The unique identifier of the issue/comment.")
    reason: str = Field(description="Full text explanation of why this is considered noise (e.g., intended framework behavior).")

@tool("silence_as_noise", args_schema=SilenceAsNoiseInput)
def silence_as_noise(issue_id: str, reason: str) -> str:
    """
    Permanently silence an issue that is proven to be a false positive or intended behavior.
    Silenced issues will never be posted to GitHub.
    """
    # Simulate API call to DB to update noiseState
    return f"Issue {issue_id} silenced permanently. Reason: {reason}"

class PlaceUnderObservationInput(BaseModel):
    issue_id: str = Field(description="The unique identifier of the issue/comment.")
    escalate_on: str = Field(description="The trigger type: 'events_per_minute' or 'additional_events'.")
    threshold: int = Field(description="The threshold count that must be crossed to trigger escalation.")
    reason: str = Field(description="Explanation of why this is suspicious but not yet proven to be an incident.")

@tool("place_under_observation", args_schema=PlaceUnderObservationInput)
def place_under_observation(issue_id: str, escalate_on: str, threshold: int, reason: str) -> str:
    """
    Place a suspicious (but unproven) issue in a watch state. It stays quiet until the escalation trigger trips.
    """
    # Simulate API call to DB to update noiseState and triggers
    return f"Issue {issue_id} placed under observation. Escalate if {escalate_on} >= {threshold}. Reason: {reason}"

class RequestInfrastructureApprovalInput(BaseModel):
    command: str = Field(description="The exact CLI command (e.g., AWS CLI, kubectl) that must be executed to remediate the issue.")
    reason: str = Field(description="Clear explanation of why this infrastructure change is necessary, to be read by the approving human.")

@tool("request_infrastructure_approval", args_schema=RequestInfrastructureApprovalInput)
def request_infrastructure_approval(command: str, reason: str) -> str:
    """
    Request human approval to execute a potentially dangerous infrastructure command.
    The run pauses until a human clicks 'Approve' or 'Reject'. If approved, the platform
    applies the command asynchronously (via the approval-exec pipeline) and resumes the run.
    """
    # Truthful suspension signal. The command is NOT run here — a human must
    # approve first, after which POST /approvals/apply applies it and resumes
    # the run (see arete_agents.remediation). Function-local import keeps the
    # review-loop's tool import cheap.
    from arete_agents.remediation import build_approval_request

    req = build_approval_request(command, reason)
    return (
        f"Suspended: awaiting human approval to run `{req.command}`. "
        f"Reason: {req.reason}. Execution occurs only after approval."
    )

def get_native_action_tools():
    return [propose_pr, ask_human, add_project_memory, silence_as_noise, place_under_observation, request_infrastructure_approval]
