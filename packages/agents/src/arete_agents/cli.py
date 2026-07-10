import json
import sys

from arete_agents.config import get_settings
from arete_agents.llm.base import get_llm
from arete_agents.models.pr import PRContext
from arete_agents.orchestrator import ReviewOrchestrator


def main() -> None:
    try:
        data = sys.stdin.read()
        pr_dict = json.loads(data)
    except Exception as exc:
        print(f"CLI input error: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        pr = PRContext.model_validate(pr_dict)
        settings = get_settings()
        llm = get_llm(settings)
        orch = ReviewOrchestrator(llm=llm)
        result = orch.run(pr)
        print(result.model_dump_json())
    except Exception as exc:
        print(f"Pipeline error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
