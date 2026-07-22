import pytest

from arete_agents.mcp.manager import MCPManager, MCPTokenRefreshError


def _mgr(tmp_path, server):
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": server})
    return m


def test_valid_token_returned_without_refresh(tmp_path):
    m = _mgr(tmp_path, {"token": "live", "expires_at": 10_000, "refresh_token": "r",
                        "token_url": "https://idp/t", "status": "Authenticated"})
    called = {"n": 0}
    out = m.get_valid_token("srv", now=1_000, post=lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    assert out == "live"
    assert called["n"] == 0  # not near expiry -> no refresh POST


def test_no_expiry_info_presents_token_as_is(tmp_path):
    m = _mgr(tmp_path, {"token": "live", "expires_at": None, "refresh_token": None,
                        "token_url": None, "status": "Authenticated"})
    assert m.get_valid_token("srv", now=1_000) == "live"


def test_expired_token_is_refreshed_and_persisted(tmp_path):
    m = _mgr(tmp_path, {"token": "old", "expires_at": 1_000, "refresh_token": "r-old",
                        "token_url": "https://idp/t", "status": "Authenticated"})

    def fake_post(url, data, headers):
        from unittest.mock import MagicMock
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = {"access_token": "fresh", "expires_in": 3600, "refresh_token": "r-new"}
        return r

    out = m.get_valid_token("srv", now=1_000, post=fake_post)  # now == expires_at -> within skew
    assert out == "fresh"
    stored = m.get_server("srv")
    assert stored["token"] == "fresh"
    assert stored["refresh_token"] == "r-new"


def test_expired_without_refresh_token_fails_closed(tmp_path):
    m = _mgr(tmp_path, {"token": "old", "expires_at": 1_000, "refresh_token": None,
                        "token_url": "https://idp/t", "status": "Authenticated"})
    with pytest.raises(MCPTokenRefreshError):
        m.get_valid_token("srv", now=2_000)


def test_unknown_server_returns_none(tmp_path):
    m = MCPManager(str(tmp_path))
    assert m.get_valid_token("nope", now=1_000) is None
