import json

import pytest

from arete_agents.eval.loader import compute_composition, load_fixtures
from arete_agents.eval.models import EvalFixture

_VALID = {
    "id": "sec-sqli",
    "pr": {
        "repo": "acme/api",
        "pr_number": 1,
        "title": "t",
        "description": "d",
        "files": [{"path": "a.py", "patch": "+x", "additions": 1, "deletions": 0}],
    },
    "planted_defects": [
        {
            "id": "sqli-001", "path": "a.py", "line": 5,
            "target_agent": "security", "description": "SQL injection",
            "severity": "error",
        }
    ],
    "clean": False,
}


def test_loads_valid_fixture(tmp_path):
    (tmp_path / "sec.json").write_text(json.dumps(_VALID), encoding="utf-8")
    fixtures = load_fixtures(tmp_path)
    assert len(fixtures) == 1
    assert fixtures[0].id == "sec-sqli"
    assert fixtures[0].planted_defects[0].target_agent == "security"


def test_sorted_by_filename(tmp_path):
    (tmp_path / "b.json").write_text(
        json.dumps({**_VALID, "id": "b"}), encoding="utf-8"
    )
    (tmp_path / "a.json").write_text(
        json.dumps({**_VALID, "id": "a"}), encoding="utf-8"
    )
    fixtures = load_fixtures(tmp_path)
    assert [f.id for f in fixtures] == ["a", "b"]


def test_malformed_file_raises_with_name(tmp_path):
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError) as exc:
        load_fixtures(tmp_path)
    assert "bad.json" in str(exc.value)


def test_missing_directory_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_fixtures(tmp_path / "nope")


def test_path_pointing_at_a_file_raises(tmp_path):
    a_file = tmp_path / "not_a_directory.json"
    a_file.write_text(json.dumps(_VALID), encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        load_fixtures(a_file)


def _fixture_obj(fid: str, clean: bool = False, defects: list | None = None):
    return EvalFixture.model_validate(
        {
            "id": fid,
            "pr": _VALID["pr"],
            "planted_defects": defects or [],
            "clean": clean,
        }
    )


def _mixed_fixtures() -> list[EvalFixture]:
    sec_defect = {
        "id": "sqli-001", "path": "a.py", "line": 5,
        "target_agent": "security", "description": "SQL injection",
        "severity": "error",
    }
    perf_defect = {
        "id": "perf-001", "path": "a.py", "line": 9,
        "target_agent": "performance", "description": "N+1 query",
        "severity": "warning",
    }
    return [
        _fixture_obj("f-sec", defects=[sec_defect, perf_defect]),
        _fixture_obj("f-perf", defects=[perf_defect]),
        _fixture_obj("f-clean", clean=True),
    ]


def test_compute_composition_counts():
    comp = compute_composition(_mixed_fixtures())
    assert comp.total_fixtures == 3
    assert comp.clean_fixtures == 1
    assert comp.defect_fixtures == 2
    assert comp.total_defects == 3
    assert comp.by_category == {"security": 1, "performance": 2}
    assert comp.by_severity == {"error": 1, "warning": 2}


def test_dataset_hash_stable_and_order_independent():
    fixtures = _mixed_fixtures()
    h1 = compute_composition(fixtures).dataset_hash
    h2 = compute_composition(fixtures).dataset_hash
    assert h1 == h2
    shuffled = [fixtures[2], fixtures[0], fixtures[1]]
    assert compute_composition(shuffled).dataset_hash == h1


def test_dataset_hash_changes_when_defect_changes():
    h1 = compute_composition(_mixed_fixtures()).dataset_hash
    changed = _mixed_fixtures()
    changed[0].planted_defects[0].description = "Different description"
    assert compute_composition(changed).dataset_hash != h1
