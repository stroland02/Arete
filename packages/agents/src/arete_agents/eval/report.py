from arete_agents.eval.models import AgentScore, EvalReport, FixtureAgentResult
from arete_agents.eval.runner import AGENT_NAMES
from arete_agents.eval.scorer import (
    aggregate_overall,
    collect_false_positives,
    collect_misses,
    score_agent,
)


def build_report(
    results: list[FixtureAgentResult],
    meta: dict[str, str] | None = None,
) -> EvalReport:
    per_agent: list[AgentScore] = []
    for name in AGENT_NAMES:
        agent_results = [r for r in results if r.agent == name]
        per_agent.append(score_agent(name, agent_results))
    overall = aggregate_overall(per_agent)
    return EvalReport(
        per_agent=per_agent,
        overall=overall,
        misses=collect_misses(results),
        false_positives=collect_false_positives(results),
        meta=meta or {},
    )


def _row(s: AgentScore) -> str:
    return (
        f"| {s.agent} | {s.tp} | {s.fp} | {s.fn} | "
        f"{s.precision:.3f} | {s.recall:.3f} | {s.f1:.3f} | {s.fp_rate:.3f} |"
    )


def render_markdown(report: EvalReport) -> str:
    lines = ["# Areté Agent Eval Report", ""]
    if report.meta:
        lines.append("## Run metadata")
        lines.append("")
        for key, value in sorted(report.meta.items()):
            lines.append(f"- **{key}**: {value}")
        lines.append("")
    lines.append("## Scores")
    lines.append("")
    lines.append("| Agent | TP | FP | FN | Precision | Recall | F1 | FP-rate |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for s in report.per_agent:
        lines.append(_row(s))
    lines.append(_row(report.overall))
    lines.append("")
    lines.append(f"**Misses (FN):** {len(report.misses)}")
    lines.append(f"**False positives (FP):** {len(report.false_positives)}")
    lines.append("")
    return "\n".join(lines)


def render_json(report: EvalReport) -> str:
    return report.model_dump_json(indent=2)
