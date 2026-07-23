"""Encryption at rest for the MCP credential store.

The store holds real OAuth access AND refresh tokens. Owner-only file modes
(0o600) already stop another *user* on the box from reading it, but they do
nothing for the paths that actually leak credential files in practice: a
backup, a disk image, a copied workspace, or a stray `git add`. These pin
that the bytes on disk are ciphertext whenever a key is configured, that a
store written before this change still reads, and that a WRONG key fails
loudly instead of handing back a corrupt token.
"""

import json

import pytest

from arete_agents.mcp.manager import MCPManager
from arete_agents.mcp.token_crypto import (
    ENC_PREFIX,
    KEY_ENV_VAR,
    MCPTokenDecryptError,
    generate_key,
)

SERVER = {
    "transport": "http",
    "target": "https://example.test/mcp",
    "status": "Authenticated",
    "token": "access-token-plaintext",
    "token_url": "https://idp.example/token",
    "expires_at": 1_750_000_000.0,
    "refresh_token": "refresh-token-plaintext",
    "allowed_agents": ["all"],
}


def _raw(manager) -> dict:
    """The bytes actually on disk, with no decryption applied."""
    with open(manager.config_file, "r") as f:
        return json.load(f)


def test_secrets_are_ciphertext_on_disk_when_a_key_is_configured(tmp_path, monkeypatch):
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})

    on_disk = _raw(m)["srv"]
    assert on_disk["token"].startswith(ENC_PREFIX)
    assert on_disk["refresh_token"].startswith(ENC_PREFIX)

    # The whole point: the plaintext must not survive anywhere in the file.
    blob = m.config_file.read_text()
    assert "access-token-plaintext" not in blob
    assert "refresh-token-plaintext" not in blob


def test_round_trip_returns_plaintext_to_callers(tmp_path, monkeypatch):
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})

    got = m.get_server("srv")
    assert got["token"] == "access-token-plaintext"
    assert got["refresh_token"] == "refresh-token-plaintext"


def test_non_secret_fields_are_left_readable(tmp_path, monkeypatch):
    # Encrypting the whole file would make it undiagnosable. Only the two
    # credential fields are opaque; everything an operator needs to debug
    # "which server, which endpoint, what state" stays in the clear.
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})

    on_disk = _raw(m)["srv"]
    assert on_disk["target"] == "https://example.test/mcp"
    assert on_disk["token_url"] == "https://idp.example/token"
    assert on_disk["status"] == "Authenticated"
    assert on_disk["expires_at"] == 1_750_000_000.0


def test_absent_key_still_works_and_stores_plaintext(tmp_path, monkeypatch):
    # Back-compat: an existing deployment with no key set must not break.
    # It gets the old behavior, not an exception.
    monkeypatch.delenv(KEY_ENV_VAR, raising=False)
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})

    assert _raw(m)["srv"]["token"] == "access-token-plaintext"
    assert m.get_server("srv")["token"] == "access-token-plaintext"


def test_legacy_plaintext_store_is_still_readable_after_a_key_is_added(tmp_path, monkeypatch):
    # Write the file the old way (no key), then configure a key and read it.
    monkeypatch.delenv(KEY_ENV_VAR, raising=False)
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})

    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    assert m.get_server("srv")["token"] == "access-token-plaintext"


def test_wrong_key_fails_loudly_rather_than_returning_a_bad_token(tmp_path, monkeypatch):
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})

    # Key rotated/lost. Returning None would read as "not authenticated" and
    # silently re-trigger an OAuth flow; returning garbage would be presented
    # to the server as a token. Neither is acceptable — raise.
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    with pytest.raises(MCPTokenDecryptError):
        m.get_server("srv")


def test_ciphertext_without_any_key_configured_fails_loudly(tmp_path, monkeypatch):
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})

    monkeypatch.delenv(KEY_ENV_VAR, raising=False)
    with pytest.raises(MCPTokenDecryptError):
        m.get_server("srv")


def test_save_does_not_mutate_the_callers_dict(tmp_path, monkeypatch):
    # _save_config encrypts on the way out; if it did that in place, the
    # in-memory config the caller still holds would silently become
    # ciphertext and the next save would double-encrypt it.
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    config = {"srv": dict(SERVER)}
    m._save_config(config)

    assert config["srv"]["token"] == "access-token-plaintext"


def test_repeated_saves_do_not_double_encrypt(tmp_path, monkeypatch):
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": dict(SERVER)})
    m.update_server_token("srv", access_token="second-token", expires_at=1.0)

    assert m.get_server("srv")["token"] == "second-token"
    assert not m.get_server("srv")["token"].startswith(ENC_PREFIX)


def test_null_token_survives_a_round_trip(tmp_path, monkeypatch):
    # add_server() writes token=None before authentication.
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": {**SERVER, "token": None, "refresh_token": None}})

    got = m.get_server("srv")
    assert got["token"] is None
    assert got["refresh_token"] is None
