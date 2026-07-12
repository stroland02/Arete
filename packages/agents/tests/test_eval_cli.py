from unittest.mock import MagicMock, patch

from arete_agents.config import Settings
from arete_agents.eval.__main__ import main, resolve_providers
from arete_agents.eval.models import FixtureAgentResult


def _settings(**kw) -> Settings:
    base = dict(llm_provider="gemini", gemini_api_key="k", anthropic_api_key="k")
    base.update(kw)
    return Settings(**base)


def test_new_config_fields_default_none():
    s = _settings()
    assert s.eval_finder_provider is None
    assert s.eval_judge_provider is None
    assert s.eval_f1_threshold == 0.05


def test_heterogeneous_judge_default_gemini_finder():
    finder, judge = resolve_providers(_settings(llm_provider="gemini"), None)
    assert finder == "gemini"
    assert judge == "anthropic"


def test_heterogeneous_judge_default_anthropic_finder():
    finder, judge = resolve_providers(_settings(llm_provider="anthropic"), None)
    assert finder == "anthropic"
    assert judge == "gemini"


def test_judge_flag_overrides():
    finder, judge = resolve_providers(_settings(llm_provider="gemini"), "stub")
    assert judge == "stub"


def test_finder_override_setting():
    finder, judge = resolve_providers(
        _settings(llm_provider="gemini", eval_finder_provider="anthropic"), None
    )
    assert finder == "anthropic"
    assert judge == "gemini"


def _fake_fixture_agent_result(errors: int) -> FixtureAgentResult:
    return FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[],
        comments=[], match_results=[], errors=errors,
    )


def _run_main_with_fake_pipeline(tmp_path, result, extra_args):
    fixtures_dir = tmp_path / "fixtures"
    fixtures_dir.mkdir()
    baseline_path = tmp_path / "baseline.json"
    args = [
        "--fixtures", str(fixtures_dir),
        "--baseline", str(baseline_path),
        *extra_args,
    ]
    with patch(
        "arete_agents.eval.__main__.get_settings", return_value=_settings()
    ), patch(
        "arete_agents.eval.__main__.load_fixtures", return_value=[MagicMock()]
    ), patch(
        "arete_agents.eval.__main__.build_finder_llm", return_value=MagicMock()
    ), patch(
        "arete_agents.eval.__main__.build_agents",
        return_value=[MagicMock(agent_name="security")],
    ), patch(
        "arete_agents.eval.__main__.build_judge", return_value=(MagicMock(), True)
    ), patch(
        "arete_agents.eval.__main__.run_all", return_value=[result]
    ):
        exit_code = main(args)
    return exit_code, baseline_path


def test_main_refuses_to_write_baseline_when_agent_calls_errored(tmp_path):
    result = _fake_fixture_agent_result(errors=1)
    exit_code, baseline_path = _run_main_with_fake_pipeline(
        tmp_path, result, ["--update-baseline"]
    )
    assert exit_code == 1
    assert not baseline_path.exists()


def test_main_writes_baseline_when_no_errors(tmp_path):
    result = _fake_fixture_agent_result(errors=0)
    exit_code, baseline_path = _run_main_with_fake_pipeline(
        tmp_path, result, ["--update-baseline"]
    )
    assert exit_code == 0
    assert baseline_path.exists()
