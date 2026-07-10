from pydantic import BaseModel, computed_field, Field

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


class PRContext(BaseModel):
    repo: str
    pr_number: int
    title: str
    description: str
    files: list[FileChange]
    custom_rules: list[str] = Field(default_factory=list, alias="customRules")
