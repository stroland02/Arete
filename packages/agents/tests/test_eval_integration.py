from pathlib import Path
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.eval.loader import load_fixtures
from arete_agents.eval.matcher import StubJudge
from arete_agents.eval.report import build_report
from arete_agents.eval.runner import build_agents, run_all

_SELFCHECK = Path(__file__).resolve().parents[1] / "eval" / "fixtures_selfcheck"

_SEC_HIT = (
    '{"comments": [{"path": "src/auth.py", "line": 5, '
    '"body": "SQL injection via string formatting.", "severity": "error", '
    '"category": "security"}], "summary": "sqli"}'
)
_EMPTY = '{"comments": [], "summary": "no issues"}'


def _finder_llm():
    # The security agent always reports the src/auth.py line-5 finding; every
    # other agent (and security itself on the clean fixture, which has no
    # src/auth.py file) reports nothing. Detection is by system-prompt content
    # via BaseReviewAgent._build_user_prompt's "for {agent_name} issues" line,
    # which SystemMessage does not carry -- instead we key off which agent
    # instance is calling by inspecting the HumanMessage content itself: the
    # user prompt embeds "Review this pull request file for security issues."
    mock = MagicMock()

    def _invoke(messages):
        human = messages[-1].content if messages else ""
        # "for security issues" alone is not file-specific: BaseReviewAgent's
        # user prompt also embeds "File: {file.path}", so gate on the target
        # file too -- otherwise the security agent would "find" the sqli
        # comment even while reviewing src/ok.py in the clean fixture (no
        # src/auth.py present there), producing a spurious false positive.
        if "for security issues" in human and "src/auth.py" in human:
            return AIMessage(content=_SEC_HIT)
        return AIMessage(content=_EMPTY)

    mock.invoke.side_effect = _invoke
    mock.with_retry.return_value = mock
    return mock


def test_selfcheck_metrics_are_exact():
    fixtures = load_fixtures(_SELFCHECK)
    agents = build_agents(_finder_llm())
    results = run_all(fixtures, agents, StubJudge(), is_stub=True)
    report = build_report(results, meta={"judge": "stub"})

    sec = next(s for s in report.per_agent if s.agent == "security")
    assert (sec.tp, sec.fn) == (1, 0)
    assert sec.recall == 1.0
    assert report.overall.fp == 0
    assert report.overall.tp == 1
    assert report.overall.f1 == 1.0
