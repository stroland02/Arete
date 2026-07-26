from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.agents.base import escape_for_prompt


class ChatAgent:
    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    def reply(self, context: dict) -> str:
        pr_title = context.get("pr_title", "")
        pr_description = context.get("pr_description", "")
        file_path = context.get("file_path", "")
        diff_hunk = context.get("diff_hunk", "")
        bot_comment = context.get("bot_comment", "")
        user_reply = context.get("user_reply", "")

        system_prompt = (
            "You are an AI code reviewer assistant. A user has replied to one of your review comments "
            "on a Pull Request. Respond to the user's reply in a helpful, conversational manner using markdown."
        )
        
        from arete_agents.skills.loader import load_installed_skills
        skills = load_installed_skills()
        if skills:
            system_prompt += "\n\nYou have been equipped with the following skills/guidelines:\n"
            system_prompt += "\n\n---\n\n".join(skills)
        
        # Metadata and conversational fields are escaped to prevent a malicious
        # title/comment/reply (e.g. containing "</user_reply>") from breaking
        # out of its delimiter and injecting fake instructions. diff_hunk is
        # left as-is: it is source code the assistant must read verbatim.
        user_prompt = (
            f"""<pr_metadata>
PR: {escape_for_prompt(pr_title)}
Description: {escape_for_prompt(pr_description)}
File: {escape_for_prompt(file_path)}
</pr_metadata>

<diff_hunk>
{diff_hunk}
</diff_hunk>

<bot_comment>
{escape_for_prompt(bot_comment)}
</bot_comment>

<user_reply>
{escape_for_prompt(user_reply)}
</user_reply>

Please provide a helpful and conversational response to the user's reply.
"""
            "If the user provides a repository-specific rule or correction that should be remembered for future PRs, "
            "you must include an action to save memory. If you need a human to clarify something before you can "
            f"""proceed with a review, you must include an ask_human action.
Return your response ONLY as valid JSON matching this schema:
{{
  "reply": "<your markdown conversational response>",
  "actions": [
    {{ "type": "save_memory", "kind": "terminology", "title": "<short title>", "body": "<the rule to remember>" }},
    {{ "type": "ask_human", "question": "<question for human>" }}
  ]
}}
Only include the 'actions' array if you actually need to perform an action.
"""
        )

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]

        # Invoke with an HONEST error path: a provider failure (out of credits,
        # bad key, model not found) is classified and returned as a structured
        # error the UI can show — never swallowed into a silent non-response.
        # Only retryable failures (rate limit / timeout / transient 5xx) get a
        # single retry; a 400 fails fast instead of tripling the wait.
        from arete_agents.llm.errors import classify_provider_error

        response = None
        for attempt in range(2):
            try:
                response = self._llm.invoke(messages)
                break
            except Exception as exc:  # noqa: BLE001 — classified below
                err = classify_provider_error(exc)
                if err.retryable and attempt == 0:
                    continue
                return {"reply": None, "actions": [], "error": {"kind": err.kind, "message": err.message}}

        import json
        import re
        raw_str = response.content if isinstance(response.content, str) else ""
        clean = re.sub(r"```(?:json)?\n?|```$", "", raw_str, flags=re.MULTILINE).strip()
        try:
            return json.loads(clean)
        except Exception:
            return {"reply": raw_str, "actions": []}
