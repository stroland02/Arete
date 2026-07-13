import argparse
import json
import sys

from arete_agents.agents.chat import ChatAgent
from arete_agents.config import get_settings
from arete_agents.llm.base import get_llms_by_role
from arete_agents.models.pr import PRContext
from arete_agents.orchestrator import ReviewOrchestrator


def main() -> None:
    # Safely intercept 'skills' and 'mcp' commands to avoid interfering with other agents
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "skills":
            from arete_agents.skills.cli import handle_skills_cli
            handle_skills_cli(sys.argv[2:])
            return
        elif cmd == "mcp":
            from arete_agents.mcp.cli import handle_mcp_cli
            handle_mcp_cli(sys.argv[2:])
            return

    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="review", choices=["review", "chat"])
    args, unknown = parser.parse_known_args()

    try:
        data = sys.stdin.read()
        context_dict = json.loads(data)
    except Exception as exc:
        print(f"CLI input error: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        settings = get_settings()
        llms = get_llms_by_role(settings)

        if args.mode == "chat":
            agent = ChatAgent(llm=llms["chat"])
            result = agent.reply(context_dict)
            print(result)
        else:
            pr = PRContext.model_validate(context_dict)
            orch = ReviewOrchestrator(llm=llms)
            result = orch.run(pr)
            print(result.model_dump_json())
    except Exception as exc:
        print(f"Pipeline error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
