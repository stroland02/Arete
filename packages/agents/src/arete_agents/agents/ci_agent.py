import concurrent.futures

from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.agents.base import BaseReviewAgent, escape_for_prompt
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview

MAX_LOG_EXTRACT_WORKERS = 12


class CIAgent(BaseReviewAgent):
    @property
    def agent_name(self) -> str:
        return "ci_diagnostics"

    @property
    def system_prompt(self) -> str:
        return """You are a senior CI/CD and compiler diagnostics engineer.

Your task is to analyze failed GitHub Actions logs and identify the root cause of the failure in the provided file.
- Look for compiler errors, test failures, linting errors, or deployment issues.
- Pinpoint the exact lines causing the failure.
- Provide a concrete fix for the error.

Focus solely on issues that directly contributed to the CI failure."""

    def _extract_error(self, chunk: str) -> str:
        messages = [
            SystemMessage(content="You are an expert CI log analyzer."),
            HumanMessage(
                content=f"Does this chunk of CI logs contain the failure reason? If yes, extract it. If no, say 'NO_ERROR'.\n\nLogs:\n{chunk}"
            )
        ]
        response = self._llm.with_retry(stop_after_attempt=2).invoke(messages)
        content = response.content if isinstance(response.content, str) else ""
        return content.strip()

    def review_file(self, file: FileChange, pr_context: PRContext) -> FileReview:
        ci_logs = pr_context.ci_logs or ""
        extracted_errors = ""

        if ci_logs:
            if len(ci_logs) < 4000:
                extracted_errors = ci_logs
            else:
                chunks = [ci_logs[i : i + 4000] for i in range(0, len(ci_logs), 4000)]
                errors = []
                workers = min(len(chunks), MAX_LOG_EXTRACT_WORKERS)
                pool = concurrent.futures.ThreadPoolExecutor(max_workers=workers)
                with pool as executor:
                    results = executor.map(self._extract_error, chunks)
                    for res in results:
                        if res and res != "NO_ERROR":
                            errors.append(res)
                extracted_errors = "\n".join(errors)

        prompt = self.system_prompt
        if pr_context.custom_rules:
            prompt += "\n\nCUSTOM RULES:\n" + "\n".join(
                f"- {rule}" for rule in pr_context.custom_rules
            )

        user_content = self._build_user_prompt(file, pr_context)
        if extracted_errors:
            # Escaped: CI log text is attacker-influenceable (e.g. a build step
            # can print arbitrary lines) and must not be able to break out of
            # the <ci_logs> delimiter.
            user_content += (
                f"\n\n<ci_logs>\n{escape_for_prompt(extracted_errors)}\n</ci_logs>"
            )

        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=user_content),
        ]

        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        comments, summary = self._parse_response(file.path, raw)
        return FileReview(path=file.path, comments=comments, summary=summary)
