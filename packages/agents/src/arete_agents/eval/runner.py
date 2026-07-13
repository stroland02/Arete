from arete_agents.agents.business_logic import BusinessLogicAgent
from arete_agents.agents.deployment_safety import DeploymentSafetyAgent
from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.agents.test_coverage import TestCoverageAgent
from arete_agents.eval.matcher import DEFAULT_WINDOW, match_comments
from arete_agents.eval.models import EvalFixture, FixtureAgentResult

AGENT_NAMES = [
    "security", "performance", "quality",
    "test_coverage", "deployment_safety", "business_logic",
]

_AGENT_CLASSES = [
    SecurityAgent, PerformanceAgent, QualityAgent,
    TestCoverageAgent, DeploymentSafetyAgent, BusinessLogicAgent,
]


def build_agents(llm) -> list:
    return [cls(llm) for cls in _AGENT_CLASSES]


def run_fixture(
    fixture: EvalFixture,
    agents: list,
    judge,
    is_stub: bool,
    window: int = DEFAULT_WINDOW,
) -> list[FixtureAgentResult]:
    results: list[FixtureAgentResult] = []
    for agent in agents:
        comments = []
        errors = 0
        for file in fixture.pr.files:
            try:
                review = agent.review_file(file, fixture.pr)
                comments.extend(review.comments)
            except Exception:
                errors += 1
                continue
        relevant = [
            d for d in fixture.planted_defects if d.target_agent == agent.agent_name
        ]
        match_results = match_comments(
            comments, relevant, judge, is_stub, window
        )
        results.append(
            FixtureAgentResult(
                fixture_id=fixture.id,
                agent=agent.agent_name,
                relevant_defects=relevant,
                comments=comments,
                match_results=match_results,
                errors=errors,
                clean=fixture.clean,
            )
        )
    return results


def run_all(
    fixtures: list[EvalFixture],
    agents: list,
    judge,
    is_stub: bool,
    window: int = DEFAULT_WINDOW,
) -> list[FixtureAgentResult]:
    out: list[FixtureAgentResult] = []
    for fixture in fixtures:
        out.extend(run_fixture(fixture, agents, judge, is_stub, window))
    return out
