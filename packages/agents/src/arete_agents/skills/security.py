from pathlib import Path
from typing import Any, Dict


class SecurityAssessor:
    """Reports the security posture of a skill — or honestly declines to.

    No scanner is wired up yet. This class previously *invented* Gen/Socket/Snyk
    verdicts by substring-matching the skill's filename (a skill named
    ``supabase-helper`` came back "Med Risk" for that reason alone) and the
    installer printed them as a "Security Risk Assessments" table. A fabricated
    security verdict is worse than no verdict: it is believed, and it is wrong.

    So this refuses instead. To make it real, integrate an actual scanner here
    and return its findings — keep ``status`` as the discriminator so callers
    already handling ``unavailable`` keep working.
    """

    #: Discriminator for callers. A real implementation adds "assessed".
    UNAVAILABLE = "unavailable"

    def assess_skill(self, skill_path: Path) -> Dict[str, Any]:
        """Assess a skill directory.

        Returns a refusal — identical for every skill, because nothing about a
        skill is actually inspected. The payload deliberately carries no rating
        vocabulary, so no caller can render it as a score.
        """
        return {
            "status": self.UNAVAILABLE,
            "reason": (
                "no security scanner is configured — skills are installed unscanned"
            ),
        }
