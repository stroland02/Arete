from pathlib import Path
from typing import List


def load_installed_skills(workspace_root: str = None) -> List[str]:
    """
    Loads all installed skills from the .agents/skills directory.
    This allows dynamically added skills to influence Areté's agent behavior.
    """
    root = Path(workspace_root) if workspace_root else Path.cwd()
    skills_dir = root / ".agents" / "skills"
    
    if not skills_dir.exists() or not skills_dir.is_dir():
        return []
        
    skills = []
    for entry in skills_dir.iterdir():
        if entry.is_dir():
            skill_file = entry / "SKILL.md"
            if skill_file.exists():
                try:
                    content = skill_file.read_text(encoding="utf-8")
                    # Optionally parse YAML frontmatter here, but for now we just take the content.
                    skills.append(f"Skill: {entry.name}\n{content}")
                except Exception:
                    pass
    
    return skills
