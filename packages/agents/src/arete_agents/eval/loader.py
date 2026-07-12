import json
from pathlib import Path

from arete_agents.eval.models import EvalFixture


def load_fixture(path: Path) -> EvalFixture:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return EvalFixture.model_validate(data)
    except Exception as exc:
        raise ValueError(f"Invalid fixture {path.name}: {exc}") from exc


def load_fixtures(directory: Path) -> list[EvalFixture]:
    if not directory.is_dir():
        raise FileNotFoundError(f"Fixtures directory not found: {directory}")
    return [load_fixture(p) for p in sorted(directory.glob("*.json"))]
