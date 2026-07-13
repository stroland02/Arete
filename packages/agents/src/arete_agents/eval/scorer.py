from arete_agents.eval.models import (
    AgentScore,
    CleanFileStats,
    FixtureAgentResult,
    PlantedDefect,
    SeverityScore,
)
from arete_agents.models.review import ReviewComment

SEVERITY_ORDER = ["error", "warning", "info"]


def _safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def _prf(tp: int, fp: int, fn: int) -> tuple[float, float, float, float]:
    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)
    f1 = _safe_div(2 * precision * recall, precision + recall)
    fp_rate = _safe_div(fp, tp + fp)
    return precision, recall, f1, fp_rate


def score_agent(agent: str, results: list[FixtureAgentResult]) -> AgentScore:
    tp = fp = fn = errors = 0
    for r in results:
        confirmed_ids = {
            m.defect_id for m in r.match_results if m.defect_id is not None
        }
        fp += sum(1 for m in r.match_results if m.defect_id is None)
        relevant_ids = {d.id for d in r.relevant_defects}
        tp += len(relevant_ids & confirmed_ids)
        fn += len(relevant_ids - confirmed_ids)
        errors += r.errors
    precision, recall, f1, fp_rate = _prf(tp, fp, fn)
    return AgentScore(
        agent=agent, tp=tp, fp=fp, fn=fn,
        precision=precision, recall=recall, f1=f1, fp_rate=fp_rate,
        errors=errors,
    )


def aggregate_overall(scores: list[AgentScore]) -> AgentScore:
    tp = sum(s.tp for s in scores)
    fp = sum(s.fp for s in scores)
    fn = sum(s.fn for s in scores)
    errors = sum(s.errors for s in scores)
    precision, recall, f1, fp_rate = _prf(tp, fp, fn)
    return AgentScore(
        agent="overall", tp=tp, fp=fp, fn=fn,
        precision=precision, recall=recall, f1=f1, fp_rate=fp_rate,
        errors=errors,
    )


def collect_misses(results: list[FixtureAgentResult]) -> list[PlantedDefect]:
    misses: list[PlantedDefect] = []
    for r in results:
        confirmed_ids = {
            m.defect_id for m in r.match_results if m.defect_id is not None
        }
        misses.extend(d for d in r.relevant_defects if d.id not in confirmed_ids)
    return misses


def collect_false_positives(results: list[FixtureAgentResult]) -> list[ReviewComment]:
    fps: list[ReviewComment] = []
    for r in results:
        fps.extend(m.comment for m in r.match_results if m.defect_id is None)
    return fps


def f1_regressed(current: float, baseline: float, threshold: float = 0.05) -> bool:
    return current < baseline - threshold


def score_by_severity(results: list[FixtureAgentResult]) -> list[SeverityScore]:
    scores: list[SeverityScore] = []
    for severity in SEVERITY_ORDER:
        tp = fp = fn = 0
        for r in results:
            confirmed_ids = {
                m.defect_id for m in r.match_results if m.defect_id is not None
            }
            for d in r.relevant_defects:
                if d.severity != severity:
                    continue
                if d.id in confirmed_ids:
                    tp += 1
                else:
                    fn += 1
            fp += sum(
                1
                for m in r.match_results
                if m.defect_id is None and m.comment.severity == severity
            )
        if tp + fp + fn == 0:
            continue
        precision, recall, f1, fp_rate = _prf(tp, fp, fn)
        scores.append(
            SeverityScore(
                severity=severity, tp=tp, fp=fp, fn=fn,
                precision=precision, recall=recall, f1=f1, fp_rate=fp_rate,
            )
        )
    return scores


def clean_file_stats(results: list[FixtureAgentResult]) -> CleanFileStats:
    by_fixture: dict[str, list[FixtureAgentResult]] = {}
    for r in results:
        by_fixture.setdefault(r.fixture_id, []).append(r)
    clean_fixtures = 0
    flagged = 0
    for fixture_results in by_fixture.values():
        if not any(r.clean for r in fixture_results):
            continue
        clean_fixtures += 1
        if any(r.comments for r in fixture_results):
            flagged += 1
    return CleanFileStats(
        clean_fixtures=clean_fixtures,
        clean_fixtures_flagged=flagged,
        false_alarm_rate=_safe_div(flagged, clean_fixtures),
    )
