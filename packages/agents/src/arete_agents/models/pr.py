from pydantic import BaseModel, ConfigDict, Field, computed_field

from arete_agents.models.telemetry import TelemetrySnapshot

_EXTENSION_MAP: dict[str, str] = {
    ".py": "python", ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".go": "go",
    ".rs": "rust", ".java": "java", ".rb": "ruby", ".php": "php",
    ".cs": "csharp", ".cpp": "cpp", ".c": "c", ".sql": "sql", ".sh": "shell",
}


class FileChange(BaseModel):
    path: str
    patch: str
    additions: int
    deletions: int

    @computed_field
    @property
    def language(self) -> str:
        suffix = "." + self.path.rsplit(".", 1)[-1] if "." in self.path else ""
        return _EXTENSION_MAP.get(suffix, "other")


class LLMConfig(BaseModel):
    """Per-request BYO model config (see POST /review). When present, the
    review builds its LLM clients from THIS config instead of the server's
    global Settings — this is how a user connects their own model. Accepts the
    TS/JS webhook camelCase (apiKey/baseUrl) and Python snake_case alike."""
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    provider: str
    model: str | None = None
    api_key: str | None = Field(None, alias="apiKey")
    base_url: str | None = Field(None, alias="baseUrl")


class PRContext(BaseModel):
    # Accept both the TS/JS webhook convention (ciLogs, customRules) and the
    # Python/CLI convention (ci_logs, custom_rules). Without populate_by_name,
    # pydantic only recognizes the alias, so a snake_case caller (e.g. the CLI
    # reading arbitrary stdin JSON) would have ci_logs/custom_rules silently
    # dropped to their defaults instead of raising a validation error.
    model_config = ConfigDict(populate_by_name=True)

    repo: str
    pr_number: int
    title: str
    description: str
    files: list[FileChange]
    custom_rules: list[str] = Field(default_factory=list, alias="customRules")
    ci_logs: str | None = Field(None, alias="ciLogs")
    telemetry: list[TelemetrySnapshot] = Field(default_factory=list)
    predecessor_handoff_notes: str | None = Field(None, alias="predecessorHandoffNotes")
    predecessor_root_cause: str | None = Field(None, alias="predecessorRootCause")
    project_memories: list[str] = Field(default_factory=list, alias="projectMemories")
    # Populated by the webhook (best-effort) so agents can clone-and-index
    # the repository for context-mapping. All three are optional together —
    # CLI/eval/local callers omit them and context-mapping is simply
    # skipped for that review (see arete_agents/context_map).
    clone_url: str | None = Field(None, alias="cloneUrl")
    installation_token: str | None = Field(None, alias="installationToken")
    installation_id: int | None = Field(None, alias="installationId")
    repo_conventions: str | None = Field(None, alias="repoConventions")
    # Optional per-request BYO model config. When present, this review builds
    # its LLM clients from it (get_llms_by_role_from_config) instead of the
    # server's global Settings. Omitted by webhook/CLI callers that rely on the
    # server default provider.
    llm: LLMConfig | None = None
