import logging

from arete_agents.context_map.indexer import IndexerError, index_repository
from arete_agents.context_map.repo_cache import RepoCacheError, ensure_repo_checked_out
from arete_agents.models.pr import PRContext

__all__ = ["ensure_indexed"]


def ensure_indexed(pr: PRContext) -> str | None:
    """Best-effort: clone/pull the PR's repo and index it via
    codebase-memory-mcp. Returns the project name to use for subsequent
    graph queries, or None if context-mapping could not run for this
    review — missing fields (CLI/eval/local callers), or any clone/index
    failure. A review must never fail because of this."""
    if not pr.clone_url or not pr.installation_token or pr.installation_id is None:
        return None

    try:
        repo_dir = ensure_repo_checked_out(
            clone_url=pr.clone_url,
            installation_token=pr.installation_token,
            installation_id=pr.installation_id,
            repo_slug=pr.repo,
        )
        return index_repository(installation_id=pr.installation_id, repo_dir=repo_dir)
    except (RepoCacheError, IndexerError) as exc:
        logging.warning(
            f"Context-mapping skipped for {pr.repo} (installation "
            f"{pr.installation_id}): {exc}"
        )
        return None
