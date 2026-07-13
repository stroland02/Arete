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
        user_prompt = f"""<pr_metadata>
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

Please provide a helpful and conversational response to the user's reply."""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
        
        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        return response.content if isinstance(response.content, str) else ""
