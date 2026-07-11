import argparse
import json
import sys
from pathlib import Path

from langchain_core.language_models import BaseChatModel

from arete_agents.config import Settings, get_settings
from arete_agents.eval.loader import load_fixtures
from arete_agents.eval.matcher import DEFAULT_WINDOW, build_judge
from arete_agents.eval.report import build_report, render_json, render_markdown
from arete_agents.eval.runner import build_agents, run_all
from arete_agents.eval.scorer import f1_regressed

_DEFAULT_FIXTURES = Path(__file__).resolve().parents[3] / "eval" / "fixtures"
_DEFAULT_BASELINE = Path(__file__).resolve().parents[3] / "eval" / "baseline.json"


def resolve_providers(settings: Settings, judge_flag: str | None) -> tuple[str, str]:
    finder = settings.eval_finder_provider or settings.llm_provider
    if judge_flag is not None:
        judge = judge_flag
    elif settings.eval_judge_provider is not None:
        judge = settings.eval_judge_provider
    else:
        judge = "anthropic" if finder == "gemini" else "gemini"
    return finder, judge


def build_finder_llm(provider: str, settings: Settings) -> BaseChatModel:
    if provider == "gemini":
        from arete_agents.llm.gemini import build_gemini_llm

        return build_gemini_llm(settings.gemini_api_key)
    if provider == "anthropic":
        from arete_agents.llm.anthropic import build_anthropic_llm

        return build_anthropic_llm(settings.anthropic_api_key)
    raise ValueError(f"Unknown finder provider: {provider!r}")


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="arete_agents.eval")
    parser.add_argument("--agent", default=None, help="Restrict scoring to one agent name.")
    parser.add_argument("--fixtures", default=str(_DEFAULT_FIXTURES))
    parser.add_argument("--judge", choices=["gemini", "anthropic", "stub"], default=None)
    parser.add_argument("--report", choices=["md", "json"], default="md")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--baseline", default=str(_DEFAULT_BASELINE))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    settings = get_settings()
    finder_provider, judge_mode = resolve_providers(settings, args.judge)

    fixtures = load_fixtures(Path(args.fixtures))
    finder_llm = build_finder_llm(finder_provider, settings)
    agents = build_agents(finder_llm)
    if args.agent:
        agents = [a for a in agents if a.agent_name == args.agent]
    judge, is_stub = build_judge(
        judge_mode, settings.gemini_api_key, settings.anthropic_api_key
    )

    results = run_all(fixtures, agents, judge, is_stub, args.window)
    meta = {
        "finder_provider": finder_provider,
        "judge_mode": judge_mode,
        "window": str(args.window),
        "fixtures": str(len(fixtures)),
    }
    report = build_report(results, meta=meta)

    if args.report == "json":
        print(render_json(report))
    else:
        print(render_markdown(report))

    baseline_path = Path(args.baseline)
    if args.update_baseline:
        baseline_path.write_text(render_json(report), encoding="utf-8")
        print(f"\nBaseline written to {baseline_path}", file=sys.stderr)
        return 0

    if baseline_path.exists():
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        base_f1 = baseline.get("overall", {}).get("f1", 0.0)
        if f1_regressed(report.overall.f1, base_f1, settings.eval_f1_threshold):
            print(
                f"\nF1 REGRESSION: {report.overall.f1:.3f} < "
                f"{base_f1:.3f} - {settings.eval_f1_threshold}",
                file=sys.stderr,
            )
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
