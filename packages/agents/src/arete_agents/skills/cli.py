import argparse
import sys
from typing import List

from .manager import SkillManager


def handle_skills_cli(args: List[str]) -> None:
    parser = argparse.ArgumentParser(prog="arete-agents skills", description="Manage Areté skills")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    add_parser = subparsers.add_parser("add", help="Add a skill repository")
    add_parser.add_argument("repo", help="Repository to add (e.g. superloglabs/skills)")
    add_parser.add_argument("--all", action="store_true", help="Install all skills found in the repository")
    
    parsed_args = parser.parse_args(args)
    
    manager = SkillManager()
    
    if parsed_args.command == "add":
        manager.add_skills(parsed_args.repo, install_all=parsed_args.all)
    else:
        parser.print_help()
        sys.exit(1)
