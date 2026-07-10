import html
import json
import re
from abc import ABC, abstractmethod

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewComment

MAX_PATCH_CHARS = 50_000


def escape_for_prompt(value: str) -> str:
    """Neutralize characters that could break out of the XML-style prompt
    delimiters (e.g. a PR title containing ``</pr_metadata>``). Only used for
    free-text *metadata* fields — never for the diff/patch itself, which is
    expected to contain arbitrary code (including angle brackets) that the
    agent must read verbatim to give accurate line-level feedback.
    """
    return html.escape(str(value), quote=False)


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
        patch = file.patch
        truncation_note = ""
        if len(patch) > MAX_PATCH_CHARS:
            patch = patch[:MAX_PATCH_CHARS]
            truncation_note = (
                f"\n[Diff truncated: showing first {MAX_PATCH_CHARS} chars only]"
            )

        return f"""Review this pull request file for {self.agent_name} issues.

<pr_metadata>
PR: "{escape_for_prompt(pr_context.title)}" in {escape_for_prompt(pr_context.repo)}
Description: {escape_for_prompt(pr_context.description)}
File: {escape_for_prompt(file.path)} ({file.language})
</pr_metadata>

<diff>
{patch}{truncation_note}
</diff>

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
            raw_str = raw if isinstance(raw, str) else ""
            clean = re.sub(
                r"```(?:json)?\n?|```$", "", raw_str, flags=re.MULTILINE
            ).strip()
            data = json.loads(clean)
            comments = [ReviewComment(**c) for c in data.get("comments", [])]
            return comments, data.get("summary", "")
        except Exception as exc:
            return [], f"Failed to parse agent response: {exc}"

    def review_file(self, file: FileChange, pr_context: PRContext) -> FileReview:
        prompt = self.system_prompt
        if pr_context.custom_rules:
            prompt += "\n\nCUSTOM RULES:\n" + "\n".join(f"- {rule}" for rule in pr_context.custom_rules)
        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=self._build_user_prompt(file, pr_context)),
        ]
        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        comments, summary = self._parse_response(file.path, raw)
        return FileReview(path=file.path, comments=comments, summary=summary)
