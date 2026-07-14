from arete_agents.eval.models import (
    AgentScore,
    DatasetComposition,
    EvalReport,
    FixtureAgentResult,
)
from arete_agents.eval.runner import AGENT_NAMES
from arete_agents.eval.scorer import (
    aggregate_overall,
    clean_file_stats,
    collect_false_positives,
    collect_misses,
    score_agent,
    score_by_severity,
)


def build_report(
    results: list[FixtureAgentResult],
    meta: dict[str, str] | None = None,
    composition: DatasetComposition | None = None,
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
        per_severity=score_by_severity(results),
        clean_file=clean_file_stats(results),
        composition=composition,
    )


def _row(s: AgentScore) -> str:
    return (
        f"| {s.agent} | {s.tp} | {s.fp} | {s.fn} | "
        f"{s.precision:.3f} | {s.recall:.3f} | {s.f1:.3f} | "
        f"{s.fp_rate:.3f} | {s.errors} |"
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
    lines.append(
        "| Agent | TP | FP | FN | Precision | Recall | F1 | FP-rate | Errors |"
    )
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for s in report.per_agent:
        lines.append(_row(s))
    lines.append(_row(report.overall))
    lines.append("")
    lines.append(f"**Misses (FN):** {len(report.misses)}")
    lines.append(f"**False positives (FP):** {len(report.false_positives)}")
    if report.overall.errors:
        lines.append("")
        lines.append(
            f"**WARNING: {report.overall.errors} agent call(s) raised an exception "
            "and were silently excluded from scoring (e.g. an invalid API key, rate "
            "limit, or network failure). These results may understate real recall "
            "— do not trust this report's P/R/F1 until the error count is 0."
        )
    lines.append("")
    return "\n".join(lines)


def render_json(report: EvalReport) -> str:
    return report.model_dump_json(indent=2)


def _card_banner(report: EvalReport, verified: bool) -> str:
    if verified:
        return "> ✅ VERIFIED BASELINE"
    reasons = []
    if report.meta.get("judge_mode") == "stub":
        reasons.append("stub judge")
    if report.overall.errors > 0:
        reasons.append(f"{report.overall.errors} agent error(s) during the run")
    reason = "; ".join(reasons) if reasons else "unverified run"
    return f"> ⚠️ ILLUSTRATIVE — not a verified baseline ({reason})"


def render_card(report: EvalReport, verified: bool) -> str:
    lines = ["# Areté Agent Benchmark", ""]
    lines.append(_card_banner(report, verified))
    lines.append("")

    lines.append("## Methodology")
    lines.append("")
    lines.append(
        "Each fixture is a synthetic pull request with planted defects, each "
        "labelled with a target agent, line, and severity. Agent comments are "
        "matched to planted defects by localization (path + category + line "
        "window) and then confirmed by an LLM judge. Precision = TP/(TP+FP), "
        "recall = TP/(TP+FN), F1 is their harmonic mean, and FP-rate = "
        "FP/(TP+FP). Clean fixtures (no planted defects) measure the "
        "false-alarm rate."
    )
    lines.append("")

    lines.append("## Dataset composition")
    lines.append("")
    comp = report.composition
    if comp is None:
        lines.append("No dataset composition available for this run.")
    else:
        lines.append("| Metric | Value |")
        lines.append("|---|---|")
        lines.append(f"| Total fixtures | {comp.total_fixtures} |")
        lines.append(f"| Clean fixtures | {comp.clean_fixtures} |")
        lines.append(f"| Defect fixtures | {comp.defect_fixtures} |")
        lines.append(f"| Total planted defects | {comp.total_defects} |")
        for category, count in sorted(comp.by_category.items()):
            lines.append(f"| Defects: {category} | {count} |")
        for severity, count in sorted(comp.by_severity.items()):
            lines.append(f"| Severity: {severity} | {count} |")
        lines.append("")
        lines.append(f"Dataset hash (sha256): `{comp.dataset_hash}`")
    lines.append("")

    lines.append("## Results")
    lines.append("")
    lines.append(
        "| Agent | TP | FP | FN | Precision | Recall | F1 | FP-rate | Errors |"
    )
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for s in report.per_agent:
        lines.append(_row(s))
    lines.append(_row(report.overall))
    lines.append("")

    lines.append("### By severity")
    lines.append("")
    if report.per_severity:
        lines.append("| Severity | TP | FP | FN | Precision | Recall | F1 | FP-rate |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for sev in report.per_severity:
            lines.append(
                f"| {sev.severity} | {sev.tp} | {sev.fp} | {sev.fn} | "
                f"{sev.precision:.3f} | {sev.recall:.3f} | {sev.f1:.3f} | "
                f"{sev.fp_rate:.3f} |"
            )
    else:
        lines.append("No per-severity scores available for this run.")
    lines.append("")

    lines.append("### Clean-file false alarms")
    lines.append("")
    if report.clean_file is not None and report.clean_file.clean_fixtures > 0:
        cf = report.clean_file
        lines.append(
            f"{cf.clean_fixtures_flagged} of {cf.clean_fixtures} clean "
            f"fixtures drew at least one comment — false-alarm rate "
            f"{cf.false_alarm_rate:.3f}."
        )
    else:
        lines.append("No clean fixtures in this run — false-alarm rate unavailable.")
    lines.append("")

    lines.append("## Limitations")
    lines.append("")
    total = comp.total_fixtures if comp is not None else "unknown (no composition)"
    lines.append(
        "- Defects are synthetic (planted), not mined from real-world "
        "regressions."
    )
    lines.append(f"- Dataset size is small: {total} fixtures.")
    lines.append(
        "- Match confirmation uses an LLM judge, which can itself err."
    )
    if not verified:
        lines.append(
            "- These numbers are ILLUSTRATIVE and pending a verified run "
            "(non-stub judge, zero agent errors)."
        )
    lines.append("")
    return "\n".join(lines)
