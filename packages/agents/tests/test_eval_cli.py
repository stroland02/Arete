from unittest.mock import MagicMock, patch

import json

from arete_agents.config import Settings
from arete_agents.eval.__main__ import build_finder_llm, main
from arete_agents.eval.models import EvalFixture, FixtureAgentResult
from arete_agents.models.pr import FileChange, PRContext


def _fake_fixture() -> EvalFixture:
    pr = PRContext(
        repo="acme/api", pr_number=1, title="t", description="d",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )
    return EvalFixture(id="f1", pr=pr)


def _settings(**kw) -> Settings:
    base = dict(llm_provider="anthropic", anthropic_api_key="k")
    base.update(kw)
    return Settings(**base)


def test_eval_tier_config_defaults():
    s = _settings()
    assert s.eval_finder_tier == "opus"
    assert s.eval_judge_tier == "sonnet"
    assert s.eval_f1_threshold == 0.05


def test_build_finder_llm_uses_finder_tier(monkeypatch):
    captured = {}

    def _fake_build_anthropic_llm(api_key, tier="opus"):
        captured["api_key"] = api_key
        captured["tier"] = tier
        return MagicMock()

    monkeypatch.setattr(
        "arete_agents.llm.anthropic.build_anthropic_llm",
        _fake_build_anthropic_llm,
    )
    build_finder_llm(_settings(eval_finder_tier="sonnet"))
    assert captured["api_key"] == "k"
    assert captured["tier"] == "sonnet"


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
        "arete_agents.eval.__main__.load_fixtures", return_value=[_fake_fixture()]
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


def test_report_card_prints_banner(tmp_path, capsys):
    result = _fake_fixture_agent_result(errors=0)
    exit_code, _ = _run_main_with_fake_pipeline(
        tmp_path, result, ["--judge", "stub", "--report", "card"]
    )
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "# Areté Agent Benchmark" in out
    # Stub judge → unverified banner.
    assert "⚠️ ILLUSTRATIVE" in out
    assert "✅ VERIFIED BASELINE" not in out


def test_card_out_writes_file(tmp_path):
    result = _fake_fixture_agent_result(errors=0)
    card_path = tmp_path / "BENCHMARK.md"
    exit_code, _ = _run_main_with_fake_pipeline(
        tmp_path,
        result,
        ["--report", "json", "--card-out", str(card_path)],
    )
    assert exit_code == 0
    assert card_path.exists()
    assert "# Areté Agent Benchmark" in card_path.read_text(encoding="utf-8")


def test_report_json_still_parses(tmp_path, capsys):
    result = _fake_fixture_agent_result(errors=0)
    exit_code, _ = _run_main_with_fake_pipeline(
        tmp_path, result, ["--report", "json"]
    )
    assert exit_code == 0
    out = capsys.readouterr().out
    data = json.loads(out)
    assert data["overall"]["tp"] == 0


def _run_main_capture_judge(tmp_path, extra_args):
    result = _fake_fixture_agent_result(errors=0)
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
        "arete_agents.eval.__main__.load_fixtures", return_value=[_fake_fixture()]
    ), patch(
        "arete_agents.eval.__main__.build_finder_llm", return_value=MagicMock()
    ), patch(
        "arete_agents.eval.__main__.build_agents",
        return_value=[MagicMock(agent_name="security")],
    ), patch(
        "arete_agents.eval.__main__.build_judge", return_value=(MagicMock(), True)
    ) as judge_mock, patch(
        "arete_agents.eval.__main__.run_all", return_value=[result]
    ):
        exit_code = main(args)
    return exit_code, judge_mock


def test_judge_default_is_cross_tier(tmp_path, capsys):
    exit_code, judge_mock = _run_main_capture_judge(tmp_path, ["--report", "json"])
    assert exit_code == 0
    assert judge_mock.call_args[0][0] == "cross-tier"
    data = json.loads(capsys.readouterr().out)
    assert data["meta"]["finder_tier"] == "opus"
    assert data["meta"]["judge_tier"] == "sonnet"
    assert data["meta"]["judge_mode"] == "cross-tier"


def test_judge_stub_flag_still_selects_stub(tmp_path, capsys):
    exit_code, judge_mock = _run_main_capture_judge(
        tmp_path, ["--judge", "stub", "--report", "json"]
    )
    assert exit_code == 0
    assert judge_mock.call_args[0][0] == "stub"
    data = json.loads(capsys.readouterr().out)
    assert data["meta"]["judge_mode"] == "stub"
