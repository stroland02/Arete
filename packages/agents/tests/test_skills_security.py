"""SecurityAssessor must never invent a security verdict.

It used to derive Gen/Socket/Snyk ratings by substring-matching the skill's
*filename* — a skill called ``supabase-helper`` was labelled "Med Risk" purely
because of its name — and the skill manager printed those as a "Security Risk
Assessments" table during install. Fabricated security findings shown to a user
as scan output are the most damaging kind of dishonesty this codebase can ship.

No scanner is wired up, so the honest result is a refusal. These tests pin that:
identical output regardless of name, an explicit unavailable marker, and no
verdict vocabulary anywhere in the payload.
"""

from pathlib import Path

from arete_agents.skills.security import SecurityAssessor

# The exact substrings the old implementation branched on.
LOADED_NAMES = [
    "supabase-helper",
    "expo-tools",
    "python-linter",
    "nextjs-app",
    "onboarding-flow",
    "debug-utils",
]

VERDICT_WORDS = {"safe", "low risk", "med risk", "high risk"}


def _skill(tmp_path: Path, name: str) -> Path:
    p = tmp_path / name
    p.mkdir()
    return p


def test_assessment_does_not_vary_by_skill_name(tmp_path: Path) -> None:
    """A filename is not evidence. Every skill must get the same answer."""
    assessor = SecurityAssessor()
    results = [assessor.assess_skill(_skill(tmp_path, n)) for n in LOADED_NAMES]
    first = results[0]
    for name, result in zip(LOADED_NAMES, results):
        assert result == first, f"{name} was assessed differently — that is fabrication"


def test_assessment_reports_itself_unavailable(tmp_path: Path) -> None:
    assessor = SecurityAssessor()
    result = assessor.assess_skill(_skill(tmp_path, "anything"))
    assert result["status"] == "unavailable"
    # A caller must be able to explain the refusal to a user.
    assert result.get("reason")


def test_assessment_contains_no_verdict_vocabulary(tmp_path: Path) -> None:
    """Nothing in the payload may read as a rating a scanner would produce."""
    assessor = SecurityAssessor()
    result = assessor.assess_skill(_skill(tmp_path, "supabase-helper"))
    blob = " ".join(str(v) for v in result.values()).lower()
    for word in VERDICT_WORDS:
        assert word not in blob, f"payload still implies a verdict: {word!r}"


def test_no_scanner_scores_are_reported(tmp_path: Path) -> None:
    """The old keys carried invented scores; they must not come back silently."""
    assessor = SecurityAssessor()
    result = assessor.assess_skill(_skill(tmp_path, "expo-tools"))
    for key in ("gen", "socket", "snyk"):
        assert key not in result, f"{key!r} implies a scan that never ran"
