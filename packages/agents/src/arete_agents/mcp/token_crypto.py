"""Encryption at rest for the MCP credential store.

`.agents/mcp_servers.json` holds real OAuth **access and refresh** tokens.
`MCPManager._save_config` already creates it 0o600, which stops another *user*
on the same box from reading it. It does nothing for the ways credential files
actually escape: a backup, a disk image, a copied or archived workspace, a
crash dump, or a stray `git add` (the store is now gitignored, but an ignore
rule is one `-f` away from being bypassed).

So the two credential fields are encrypted with a key held OUTSIDE the file,
in ``ARETE_MCP_TOKEN_KEY``.

**What this does and does not buy you — stated plainly.** This is
defence-in-depth against the file leaving the machine, not against an attacker
who is already executing as this user: such an attacker reads the same env var
the process does. The value is that the file alone is worthless.

Design notes:

* **Only `token` and `refresh_token` are encrypted.** Encrypting the whole
  document would make the store undiagnosable — an operator must still be able
  to see which servers are registered, where they point, and what state they
  are in.
* **Ciphertext is tagged** with ``enc:v1:``. An untagged value is legacy
  plaintext and is returned as-is, so a store written before this change keeps
  working and is upgraded in place on the next write.
* **No key configured means the previous behaviour**, plaintext, with a
  one-time warning. Existing deployments must not break on upgrade.
* **A tagged value that cannot be decrypted raises.** Returning ``None`` would
  read as "this server was never authenticated" and silently kick off a fresh
  OAuth flow; returning the raw bytes would present garbage to the server as a
  bearer token. Both hide a key-management failure that the operator has to
  know about, so it fails closed and loud.
"""

import os
from typing import Any, Dict, Optional

import structlog

log = structlog.get_logger(__name__)

KEY_ENV_VAR = "ARETE_MCP_TOKEN_KEY"

ENC_PREFIX = "enc:v1:"

#: The fields treated as credentials. Everything else stays readable.
SECRET_FIELDS = ("token", "refresh_token")

_warned_no_key = False


class MCPTokenDecryptError(Exception):
    """Raised when a stored value is tagged as ciphertext but cannot be
    decrypted — no key configured, or the wrong key. Fail closed: the caller
    must surface this, never treat it as "no token"."""


def generate_key() -> str:
    """A fresh key, suitable for ``ARETE_MCP_TOKEN_KEY``.

    Operators run this once and put the result in their secret manager:

        python -c "from arete_agents.mcp.token_crypto import generate_key; print(generate_key())"
    """
    from cryptography.fernet import Fernet

    return Fernet.generate_key().decode()


def _fernet():
    """The configured cipher, or ``None`` when no key is set."""
    raw = os.environ.get(KEY_ENV_VAR)
    if not raw:
        return None
    from cryptography.fernet import Fernet

    try:
        return Fernet(raw.encode() if isinstance(raw, str) else raw)
    except Exception as exc:
        # A malformed key is an operator error, not a reason to quietly fall
        # back to writing plaintext.
        raise MCPTokenDecryptError(
            f"{KEY_ENV_VAR} is not a valid Fernet key (expected urlsafe-base64, 32 bytes): {exc}"
        ) from exc


def encrypt_secret(value: Optional[str]) -> Optional[str]:
    """Tagged ciphertext, or ``value`` unchanged when no key is configured."""
    global _warned_no_key
    if value is None or value == "":
        return value
    if isinstance(value, str) and value.startswith(ENC_PREFIX):
        return value  # already encrypted; never double-wrap
    cipher = _fernet()
    if cipher is None:
        if not _warned_no_key:
            _warned_no_key = True
            log.warning(
                "mcp.token_store.plaintext",
                reason=f"{KEY_ENV_VAR} is not set; OAuth tokens are stored in cleartext",
                remediation=f"set {KEY_ENV_VAR} to a key from token_crypto.generate_key()",
            )
        return value
    return ENC_PREFIX + cipher.encrypt(value.encode()).decode()


def decrypt_secret(value: Optional[str]) -> Optional[str]:
    """Plaintext for a tagged value; untagged values are legacy plaintext."""
    if value is None or not isinstance(value, str) or not value.startswith(ENC_PREFIX):
        return value
    cipher = _fernet()
    if cipher is None:
        raise MCPTokenDecryptError(
            f"the MCP credential store is encrypted but {KEY_ENV_VAR} is not set — "
            "refusing to report the stored token as absent"
        )
    from cryptography.fernet import InvalidToken

    try:
        return cipher.decrypt(value[len(ENC_PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise MCPTokenDecryptError(
            f"the MCP credential store cannot be decrypted with the current {KEY_ENV_VAR} "
            "(wrong or rotated key) — re-authenticate the affected servers"
        ) from exc


def _map_secrets(config: Dict[str, Any], fn) -> Dict[str, Any]:
    """A copy of ``config`` with ``fn`` applied to every credential field.

    Copies rather than mutating: the caller keeps holding the dict it passed
    in, and if that silently became ciphertext the next save would re-wrap it.
    """
    out: Dict[str, Any] = {}
    for name, server in config.items():
        if not isinstance(server, dict):
            out[name] = server
            continue
        copied = dict(server)
        for field in SECRET_FIELDS:
            if field in copied:
                copied[field] = fn(copied[field])
        out[name] = copied
    return out


def encrypt_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Store-shaped copy of ``config`` with credentials encrypted."""
    return _map_secrets(config, encrypt_secret)


def decrypt_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Caller-shaped copy of ``config`` with credentials in plaintext."""
    return _map_secrets(config, decrypt_secret)
