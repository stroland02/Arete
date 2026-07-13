import argparse
import json
import sys
from pathlib import Path

from langchain_core.language_models import BaseChatModel

from arete_agents.config import Settings, get_settings
from arete_agents.eval.loader import compute_composition, load_fixtures
from arete_agents.eval.matcher import DEFAULT_WINDOW, build_judge
from arete_agents.eval.report import (
    build_report,
    render_card,
    render_json,
    render_markdown,
)
from arete_agents.eval.runner import build_agents, run_all
from arete_agents.eval.scorer import f1_regressed

_DEFAULT_FIXTURES = Path(__file__).resolve().parents[3] / "eval" / "fixtures"
_DEFAULT_BASELINE = Path(__file__).resolve().parents[3] / "eval" / "baseline.json"


def build_finder_llm(settings: Settings) -> BaseChatModel:
    from arete_agents.llm.anthropic import build_anthropic_llm

    return build_anthropic_llm(
        settings.anthropic_api_key, tier=settings.eval_finder_tier
    )


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="arete_agents.eval")
    parser.add_argument(
        "--agent", default=None, help="Restrict scoring to one agent name."
    )
    parser.add_argument("--fixtures", default=str(_DEFAULT_FIXTURES))
    parser.add_argument(
        "--judge", choices=["stub", "cross-tier"], default="cross-tier"
    )
    parser.add_argument("--report", choices=["md", "json", "card"], default="md")
    parser.add_argument("--card-out", default=None)
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--baseline", default=str(_DEFAULT_BASELINE))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    settings = get_settings()
    judge_mode = args.judge

    fixtures = load_fixtures(Path(args.fixtures))
    finder_llm = build_finder_llm(settings)
    agents = build_agents(finder_llm)
    if args.agent:
        agents = [a for a in agents if a.agent_name == args.agent]
    judge, is_stub = build_judge(
        judge_mode, settings.anthropic_api_key, settings.eval_judge_tier
    )

    results = run_all(fixtures, agents, judge, is_stub, args.window)
    meta = {
        "finder_tier": settings.eval_finder_tier,
        "judge_mode": judge_mode,
        "judge_tier": settings.eval_judge_tier,
        "window": str(args.window),
        "fixtures": str(len(fixtures)),
    }
    composition = compute_composition(fixtures)
    report = build_report(results, meta=meta, composition=composition)

    verified = (judge_mode != "stub") and (report.overall.errors == 0)

    if args.report == "json":
        print(render_json(report))
    elif args.report == "card":
        print(render_card(report, verified))
    else:
        print(render_markdown(report))

    if args.card_out:
        Path(args.card_out).write_text(
            render_card(report, verified), encoding="utf-8"
        )

    if report.overall.errors:
        print(
            f"\nWARNING: {report.overall.errors} agent call(s) raised an "
            "exception during this run (e.g. an invalid API key, rate limit, "
            "or network failure) and were excluded from scoring. This report's "
            "P/R/F1 may understate real recall.",
            file=sys.stderr,
        )

    baseline_path = Path(args.baseline)
    if args.update_baseline:
        if report.overall.errors:
            print(
                "\nRefusing to write baseline: the run had "
                f"{report.overall.errors} agent error(s). Fix the underlying "
                "cause (e.g. API key) and re-run before updating the baseline.",
                file=sys.stderr,
            )
            return 1
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
