import json
import re
from abc import ABC, abstractmethod

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewComment


class BaseReviewAgent(ABC):
    @property
    @abstractmethod
    def agent_name(self) -> str: ...

    @property
    @abstractmethod
    def system_prompt(self) -> str: ...

    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    def _build_user_prompt(self, file: FileChange, pr_context: PRContext) -> str:
        return f"""Review this pull request file for {self.agent_name} issues.

PR: "{pr_context.title}" in {pr_context.repo}
Description: {pr_context.description}
File: {file.path} ({file.language})

Diff:
```diff
{file.patch}
```

Return ONLY valid JSON (no markdown, no extra text):
{{
  "comments": [
    {{
      "path": "{file.path}",
      "line": <integer>,
      "body": "<issue description and how to fix it>",
      "severity": "<info|warning|error>",
      "category": "{self.agent_name}"
    }}
  ],
  "summary": "<one paragraph summary>"
}}

If no issues found, return empty comments array."""

    def _parse_response(self, path: str, raw: str) -> tuple[list[ReviewComment], str]:
        try:
            clean = re.sub(r"```(?:json)?\n?", "", raw).strip().rstrip("`").strip()
            data = json.loads(clean)
            comments = [ReviewComment(**c) for c in data.get("comments", [])]
            return comments, data.get("summary", "")
        except Exception as exc:
            return [], f"Failed to parse agent response: {exc}"

    def review_file(self, file: FileChange, pr_context: PRContext) -> FileReview:
        messages = [
            SystemMessage(content=self.system_prompt),
            HumanMessage(content=self._build_user_prompt(file, pr_context)),
        ]
        response = self._llm.invoke(messages)
        comments, summary = self._parse_response(file.path, response.content)
        return FileReview(path=file.path, comments=comments, summary=summary)
