import re
import subprocess
from pathlib import Path

DEFAULT_REPOS_ROOT = Path("/app/.data/repos")

_TOKEN_REDACT_PATTERN = re.compile(r"x-access-token:[^@]+@")


class RepoCacheError(Exception):
    """Raised when a clone or pull fails, or the clone URL isn't a scheme
    we know how to inject a token into. Callers must catch this and fail
    open (skip context-mapping for this review) rather than let it
    propagate into the review pipeline."""


def _repo_dir(root: Path, installation_id: int, repo_slug: str) -> Path:
    safe_slug = repo_slug.replace("/", "__")
    return root / str(installation_id) / safe_slug


def _with_token(clone_url: str, token: str) -> str:
    """Inject the installation token as the HTTPS Basic-auth username, per
    GitHub App conventions (https://x-access-token:<token>@github.com/...).
    The result is only ever passed as a subprocess argument — never
    logged."""
    if not clone_url.startswith("https://"):
        raise RepoCacheError(f"Unsupported clone URL scheme: {clone_url!r}")
    return clone_url.replace("https://", f"https://x-access-token:{token}@", 1)


def _redact(text: str) -> str:
    """Strip any embedded token from git's stderr before it's ever raised
    or logged — git includes the full remote URL (with credentials) in
    some of its error messages."""
    return _TOKEN_REDACT_PATTERN.sub("x-access-token:***@", text)


def ensure_repo_checked_out(
    clone_url: str,
    installation_token: str,
    installation_id: int,
    repo_slug: str,
    root: Path = DEFAULT_REPOS_ROOT,
) -> Path:
    """Clone the repo on first use, or fast-forward pull on subsequent
    calls. Returns the local checkout directory. Raises RepoCacheError on
    any git failure — never returns a partially-checked-out directory
    silently."""
    repo_dir = _repo_dir(root, installation_id, repo_slug)
    authed_url = _with_token(clone_url, installation_token)
    is_fresh_clone = not (repo_dir / ".git").exists()

    try:
        if is_fresh_clone:
            repo_dir.parent.mkdir(parents=True, exist_ok=True)
            command = ["git", "clone", "--depth", "1", authed_url, str(repo_dir)]
        else:
            command = ["git", "-C", str(repo_dir), "pull", "--ff-only", authed_url]

        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    except (subprocess.TimeoutExpired, OSError) as exc:
        raise RepoCacheError(
            f"git operation failed for {repo_slug}: {_redact(str(exc))}"
        ) from exc

    if result.returncode != 0:
        raise RepoCacheError(
            f"git operation failed for {repo_slug}: {_redact(result.stderr)}"
        )

    if is_fresh_clone:
        # `git clone <authed_url>` persists the credential-embedded URL
        # into .git/config's remote.origin.url. Strip it back to the
        # plain clone_url immediately after a successful clone so the
        # token never lives on disk beyond the single clone invocation
        # that needed it. `git pull <url>` (the branch above, once the
        # repo already exists) does NOT rewrite the stored remote config,
        # so no equivalent cleanup is needed on that path.
        _strip_token_from_remote(repo_dir, clone_url, repo_slug)

    return repo_dir


def _strip_token_from_remote(repo_dir: Path, clone_url: str, repo_slug: str) -> None:
    cleanup = subprocess.run(
        ["git", "-C", str(repo_dir), "remote", "set-url", "origin", clone_url],
        capture_output=True, text=True, timeout=10,
    )
    if cleanup.returncode != 0:
        raise RepoCacheError(
            f"Cloned {repo_slug} but failed to strip the token from "
            f"its stored remote URL: {_redact(cleanup.stderr)}"
        )
