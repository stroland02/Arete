"""Tests for the MCP OAuth token exchange (Task 6: MCP auth honesty).

The defect being closed: mcp/auth.py used to fabricate
`simulated_token_for_{code}`, store it as a real credential, and print a
success message -- with NO actual token exchange ever happening. That
fabricated string is asserted absent from every stored value below.
"""

from unittest.mock import MagicMock

import httpx
import pytest

from arete_agents.mcp import auth as mcp_auth
from arete_agents.mcp.manager import MCPManager


@pytest.fixture
def manager(tmp_path):
    return MCPManager(workspace_root=str(tmp_path))


def _add_server(manager, name="srv", token_url=None):
    manager.add_server(name=name, transport="http", url_or_cmd="https://example.com/mcp", token_url=token_url)


def _fake_post(status_code=200, json_body=None, text=""):
    """Build a fake ``post`` callable matching auth.PostFn's signature:
    (url, data, headers) -> httpx.Response-like object."""
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.text = text
    if json_body is not None:
        response.json.return_value = json_body
    else:
        response.json.side_effect = ValueError("no json")

    def post(url, data, headers):
        return response

    return post


class TestExchangeCodeForToken:
    def test_successful_exchange_returns_real_token_and_expiry(self):
        post = _fake_post(200, {"access_token": "real-access-token-xyz", "expires_in": 3600})

        result = mcp_auth.exchange_code_for_token(
            token_url="https://provider.example.com/oauth/token",
            code="auth-code-123",
            post=post,
        )

        assert result["access_token"] == "real-access-token-xyz"
        assert result["expires_at"] is not None
        assert result["expires_at"] > 0
        assert "simulated_token_for_" not in result["access_token"]

    def test_successful_exchange_captures_refresh_token_when_present(self):
        post = _fake_post(
            200,
            {"access_token": "real-token", "expires_in": 3600, "refresh_token": "real-refresh-token"},
        )

        result = mcp_auth.exchange_code_for_token(
            token_url="https://provider.example.com/oauth/token",
            code="auth-code-123",
            post=post,
        )

        assert result["refresh_token"] == "real-refresh-token"

    def test_non_2xx_response_raises_and_never_fabricates(self):
        post = _fake_post(400, {"error": "invalid_grant"}, text='{"error": "invalid_grant"}')

        with pytest.raises(mcp_auth.TokenExchangeError, match="400"):
            mcp_auth.exchange_code_for_token(
                token_url="https://provider.example.com/oauth/token",
                code="bad-code",
                post=post,
            )

    def test_missing_access_token_raises(self):
        post = _fake_post(200, {"expires_in": 3600})

        with pytest.raises(mcp_auth.TokenExchangeError, match="access_token"):
            mcp_auth.exchange_code_for_token(
                token_url="https://provider.example.com/oauth/token",
                code="auth-code-123",
                post=post,
            )

    def test_transport_failure_raises_token_exchange_error(self):
        def post(url, data, headers):
            raise httpx.ConnectError("connection refused")

        with pytest.raises(mcp_auth.TokenExchangeError):
            mcp_auth.exchange_code_for_token(
                token_url="https://provider.example.com/oauth/token",
                code="auth-code-123",
                post=post,
            )


class TestCompleteAuthHonestFailure:
    """Exercises _complete_auth, the shared helper invoked by both the
    server-callback branch (~line 90) and the manual-fallback branch
    (~line 101) of start_oauth_flow."""

    def test_configured_token_url_stores_real_token_and_reports_success(self, manager, capsys, monkeypatch):
        _add_server(manager, token_url="https://provider.example.com/oauth/token")
        post = _fake_post(200, {"access_token": "genuine-access-token", "expires_in": 3600})
        monkeypatch.setattr(mcp_auth, "_default_post", post)

        mcp_auth._complete_auth("srv", manager, "auth-code-123")

        server = manager.get_server("srv")
        assert server["token"] == "genuine-access-token"
        assert server["status"] == "Authenticated"
        assert server["expires_at"] is not None
        assert "simulated_token_for_" not in str(server["token"])

        out = capsys.readouterr().out
        assert "ready to use" in out.lower()

    def test_missing_token_url_stores_nothing_and_stays_unauthenticated(self, manager, capsys):
        _add_server(manager, token_url=None)

        mcp_auth._complete_auth("srv", manager, "auth-code-123")

        server = manager.get_server("srv")
        assert server["token"] is None
        assert server["status"] == "Needs authentication"
        assert server["expires_at"] is None
        assert server["refresh_token"] is None

        out = capsys.readouterr().out
        assert "not configured" in out.lower()
        assert "simulated_token_for_" not in out

    def test_400_from_token_endpoint_stores_nothing_and_reports_error(self, manager, capsys, monkeypatch):
        _add_server(manager, token_url="https://provider.example.com/oauth/token")
        post = _fake_post(400, {"error": "invalid_grant"}, text='{"error": "invalid_grant"}')
        monkeypatch.setattr(mcp_auth, "_default_post", post)

        mcp_auth._complete_auth("srv", manager, "bad-code")

        server = manager.get_server("srv")
        assert server["token"] is None
        assert server["status"] == "Needs authentication"
        assert server["expires_at"] is None

        out = capsys.readouterr().out
        assert "simulated_token_for_" not in out
        assert "failed" in out.lower()

    def test_no_stored_value_anywhere_ever_contains_simulated_token_marker(self, manager, monkeypatch):
        """Belt-and-suspenders sweep across every scenario's persisted
        config file, not just the fields we assert on individually above."""
        _add_server(manager, name="a", token_url="https://provider.example.com/oauth/token")
        _add_server(manager, name="b", token_url=None)
        _add_server(manager, name="c", token_url="https://provider.example.com/oauth/token")

        good_post = _fake_post(200, {"access_token": "genuine-token", "expires_in": 3600})
        bad_post = _fake_post(400, {"error": "invalid_grant"})

        monkeypatch.setattr(mcp_auth, "_default_post", good_post)
        mcp_auth._complete_auth("a", manager, "code-a")
        mcp_auth._complete_auth("b", manager, "code-b")
        monkeypatch.setattr(mcp_auth, "_default_post", bad_post)
        mcp_auth._complete_auth("c", manager, "code-c")

        config = manager._load_config()
        for server in config.values():
            for value in server.values():
                assert "simulated_token_for_" not in str(value)


class TestExchangeRefreshToken:
    def _resp(self, status_code=200, json_body=None, text=""):
        from unittest.mock import MagicMock
        r = MagicMock()
        r.status_code = status_code
        r.text = text
        if json_body is None:
            r.json.side_effect = ValueError("no json")
        else:
            r.json.return_value = json_body
        return r

    def test_refresh_returns_new_token_and_expiry(self):
        from arete_agents.mcp.auth import exchange_refresh_token
        captured = {}

        def fake_post(url, data, headers):
            captured["url"] = url
            captured["data"] = data
            return self._resp(
                json_body={
                    "access_token": "new-access",
                    "expires_in": 3600,
                    "refresh_token": "new-refresh",
                }
            )

        out = exchange_refresh_token("https://idp.example/token", "old-refresh", post=fake_post)
        assert out["access_token"] == "new-access"
        assert out["refresh_token"] == "new-refresh"
        assert out["expires_at"] is not None and out["expires_at"] > 0
        assert captured["url"] == "https://idp.example/token"
        assert captured["data"]["grant_type"] == "refresh_token"
        assert captured["data"]["refresh_token"] == "old-refresh"

    def test_refresh_non_2xx_raises_and_fabricates_nothing(self):
        import pytest

        from arete_agents.mcp.auth import TokenExchangeError, exchange_refresh_token

        with pytest.raises(TokenExchangeError):
            exchange_refresh_token(
                "https://idp.example/token",
                "old-refresh",
                post=lambda u, d, h: self._resp(status_code=400, text="bad"),
            )

    def test_refresh_missing_access_token_raises(self):
        import pytest

        from arete_agents.mcp.auth import TokenExchangeError, exchange_refresh_token

        with pytest.raises(TokenExchangeError):
            exchange_refresh_token(
                "https://idp.example/token",
                "old-refresh",
                post=lambda u, d, h: self._resp(json_body={"expires_in": 3600}),
            )
