from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

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
        
        user_prompt = f"""<pr_metadata>
PR: {pr_title}
Description: {pr_description}
File: {file_path}
</pr_metadata>

<diff_hunk>
{diff_hunk}
</diff_hunk>

<bot_comment>
{bot_comment}
</bot_comment>

<user_reply>
{user_reply}
</user_reply>

Please provide a helpful and conversational response to the user's reply."""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
        
        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        return response.content if isinstance(response.content, str) else ""
