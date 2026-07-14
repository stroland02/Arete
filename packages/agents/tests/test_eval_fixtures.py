from collections import Counter
from pathlib import Path

from arete_agents.eval.loader import load_fixtures
from arete_agents.eval.runner import AGENT_NAMES

_FIXTURES = Path(__file__).resolve().parents[1] / "eval" / "fixtures"


def test_fixtures_load():
    fixtures = load_fixtures(_FIXTURES)
    assert len(fixtures) == 29


def test_two_defects_per_agent():
    fixtures = load_fixtures(_FIXTURES)
    counts = Counter(
        d.target_agent for f in fixtures for d in f.planted_defects
    )
    for name in AGENT_NAMES:
        assert counts[name] == 4, f"{name} should have exactly 4 planted defects"


def test_five_clean_fixtures_have_no_defects():
    fixtures = load_fixtures(_FIXTURES)
    clean = [f for f in fixtures if f.clean]
    assert len(clean) == 5
    assert all(f.planted_defects == [] for f in clean)


def test_defect_paths_exist_in_pr_files():
    fixtures = load_fixtures(_FIXTURES)
    for f in fixtures:
        file_paths = {fc.path for fc in f.pr.files}
        for d in f.planted_defects:
            assert d.path in file_paths, f"{f.id}: defect path {d.path} not in PR files"
