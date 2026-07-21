import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List

from .security import SecurityAssessor


class SkillManager:
    def __init__(self, workspace_root: str = None):
        # Default to current working directory as the workspace root
        self.workspace_root = Path(workspace_root) if workspace_root else Path.cwd()
        self.agents_dir = self.workspace_root / ".agents" / "skills"
        self.security = SecurityAssessor()

    def add_skills(self, repo: str, install_all: bool = False) -> None:
        print(f"Resolving repository for {repo}...")
        
        # Simple resolution for github repos
        if not repo.startswith("http"):
            repo_url = f"https://github.com/{repo}.git"
        else:
            repo_url = repo
            
        with tempfile.TemporaryDirectory() as temp_dir:
            print(f"Cloning {repo_url}...")
            try:
                subprocess.run(
                    ["git", "clone", "--depth", "1", repo_url, temp_dir],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except subprocess.CalledProcessError:
                print(f"Failed to clone repository: {repo_url}")
                return

            skills_found = self._discover_skills(Path(temp_dir))
            print(f"Found {len(skills_found)} skills.")
            
            if not install_all and len(skills_found) > 1:
                print("Multiple skills found. Use --all to install all of them.")
                return
                
            print(f"Installing {len(skills_found)} skills...")
            self.agents_dir.mkdir(parents=True, exist_ok=True)
            
            print("\nSecurity Risk Assessments:")
            print(f"{'Skill Name':<30} | {'Gen':<10} | {'Socket':<15} | {'Snyk':<10}")
            print("-" * 75)
            
            installed_count = 0
            for skill_path in skills_found:
                skill_name = skill_path.name
                
                # Mock security assessment
                assessment = self.security.assess_skill(skill_path)
                print(
                    f"{skill_name:<30} | {assessment['gen']:<10} | "
                    f"{str(assessment['socket'])+' alerts':<15} | {assessment['snyk']:<10}"
                )
                
                # Install skill (copying for cross-platform compatibility instead of symlink for now)
                target_path = self.agents_dir / skill_name
                if target_path.exists():
                    shutil.rmtree(target_path)
                shutil.copytree(skill_path, target_path)
                installed_count += 1
                
            print(f"\nSuccessfully installed {installed_count} skills to {self.agents_dir}")

    def _discover_skills(self, repo_path: Path) -> List[Path]:
        """Discover skills in the cloned repository."""
        skills = []
        # Look for subdirectories containing SKILL.md or package.json as a heuristic
        for entry in repo_path.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                if (entry / "SKILL.md").exists() or (entry / "package.json").exists() or (entry / "README.md").exists():
                    skills.append(entry)
        
        # If no subdirectories look like skills, maybe the repo itself is a skill
        if not skills and ((repo_path / "SKILL.md").exists() or (repo_path / "package.json").exists()):
            skills.append(repo_path)
            
        return skills
