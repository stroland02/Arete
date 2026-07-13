import json
import logging
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.pr import PRContext
from arete_agents.models.review import ReviewComment

_SYSTEM_PROMPT = """You are the Areté independent Critic — a SEPARATE model \
from whichever agent produced the comments below. Your job is to catch \
mistakes the original author might miss about its own work.

For EACH comment listed, independently verify it against the diff content \
shown for its file. A comment is evidence-backed ONLY if it references a \
real line, symbol, or pattern that is actually visible in that file's diff. \
Do not give the benefit of the doubt — if you cannot point to the exact \
evidence in the diff, it is NOT evidence-backed.

Return ONLY valid JSON with this exact structure:
{
  "drop_indices": [<integer indices of comments that are NOT evidence-backed>]
}

If every comment is evidence-backed, return {"drop_indices": []}."""


class CriticAgent:
    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    def critique(self, pr: PRContext, comments: list[ReviewComment]) -> set[int]:
        if not comments:
            return set()

        patches_by_path = {f.path: f.patch for f in pr.files}

        comment_blocks = []
        for i, c in enumerate(comments):
            diff = patches_by_path.get(c.path, "(no diff available for this path)")
            comment_blocks.append(
                f"""<comment index="{i}">
File: {c.path}
Line: {c.line}
Category: {c.category}
Body: {c.body}
<diff>
{diff}
</diff>
</comment>"""
            )

        user_prompt = f"""Critique the following {len(comments)} comment(s) \
for PR #{pr.pr_number}:

{chr(10).join(comment_blocks)}"""

        messages = [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ]

        try:
            llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
            response = llm_with_retry.invoke(messages)
            raw = response.content if isinstance(response.content, str) else ""
            clean = re.sub(r"```(?:json)?\n?|```$", "", raw, flags=re.MULTILINE).strip()
            data = json.loads(clean)
            raw_indices = data.get("drop_indices", [])
            return {
                i for i in raw_indices
                if isinstance(i, int) and 0 <= i < len(comments)
            }
        except Exception as exc:
            logging.warning(
                f"Critic call failed or returned unparseable output: {exc}. "
                "Failing open — comments in this batch are kept uncritiqued."
            )
            return set()
