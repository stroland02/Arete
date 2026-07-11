from unittest.mock import MagicMock

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewComment
from arete_agents.eval.models import EvalFixture, PlantedDefect
from arete_agents.eval.matcher import StubJudge
from arete_agents.eval.runner import AGENT_NAMES, run_fixture


def _fixture(defect_agent: str = "security") -> EvalFixture:
    pr = PRContext(
        repo="acme/api", pr_number=1, title="t", description="d",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )
    return EvalFixture(
        id="f1", pr=pr,
        planted_defects=[PlantedDefect(
            id="d1", path="a.py", line=5, target_agent=defect_agent,
            description="SQL injection", severity="error",
        )],
    )


def _agents_with_security_hit() -> list:
    agents = []
    for name in AGENT_NAMES:
        a = MagicMock()
        a.agent_name = name
        if name == "security":
            a.review_file.return_value = FileReview(
                path="a.py",
                comments=[ReviewComment(path="a.py", line=5, body="SQLi", severity="error", category="security")],
                summary="s",
            )
        else:
            a.review_file.return_value = FileReview(path="a.py", comments=[], summary="")
        agents.append(a)
    return agents


def test_agent_names_are_the_six():
    assert AGENT_NAMES == [
        "security", "performance", "quality",
        "test_coverage", "deployment_safety", "business_logic",
    ]


def test_run_fixture_records_tp_for_matching_agent():
    agents = _agents_with_security_hit()
    results = run_fixture(_fixture(), agents, StubJudge(), is_stub=True)
    by_agent = {r.agent: r for r in results}
    sec = by_agent["security"]
    assert len(sec.relevant_defects) == 1
    assert any(m.defect_id == "d1" for m in sec.match_results)
    assert by_agent["quality"].relevant_defects == []
    assert by_agent["quality"].comments == []


def test_run_fixture_survives_agent_exception():
    agents = []
    for name in AGENT_NAMES:
        a = MagicMock()
        a.agent_name = name
        if name == "security":
            a.review_file.side_effect = RuntimeError("boom")
        else:
            a.review_file.return_value = FileReview(path="a.py", comments=[], summary="")
        agents.append(a)

    results = run_fixture(_fixture(), agents, StubJudge(), is_stub=True)
    by_agent = {r.agent: r for r in results}
    assert by_agent["security"].comments == []
