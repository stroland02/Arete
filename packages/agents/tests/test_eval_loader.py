import json

import pytest

from arete_agents.eval.loader import load_fixtures

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
