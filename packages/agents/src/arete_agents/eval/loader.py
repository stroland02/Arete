import hashlib
import json
from pathlib import Path

from arete_agents.eval.models import DatasetComposition, EvalFixture


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


def compute_composition(fixtures: list[EvalFixture]) -> DatasetComposition:
    canonical = json.dumps(
        [f.model_dump() for f in sorted(fixtures, key=lambda x: x.id)],
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    dataset_hash = hashlib.sha256(canonical).hexdigest()

    clean_fixtures = sum(1 for f in fixtures if f.clean)
    by_category: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    total_defects = 0
    for fixture in fixtures:
        for defect in fixture.planted_defects:
            total_defects += 1
            by_category[defect.target_agent] = (
                by_category.get(defect.target_agent, 0) + 1
            )
            by_severity[defect.severity] = by_severity.get(defect.severity, 0) + 1

    return DatasetComposition(
        total_fixtures=len(fixtures),
        clean_fixtures=clean_fixtures,
        defect_fixtures=len(fixtures) - clean_fixtures,
        total_defects=total_defects,
        by_category=by_category,
        by_severity=by_severity,
        dataset_hash=dataset_hash,
    )
