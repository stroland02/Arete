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


class TestCallbackStateVerification:
    """The `state` parameter is OAuth's CSRF defence.

    Before this, `start_oauth_flow` sent the constant `state="simulate_state"`
    and the callback handler never looked at `state` at all — so the local
    callback would accept an authorization code from any page that could reach
    it, binding an attacker's account to the victim's MCP server. These tests
    fail against that behaviour.
    """

    def test_state_is_rejected_when_missing(self):
        assert mcp_auth.state_is_valid("expected", None) is False

    def test_state_is_rejected_when_no_flow_is_in_progress(self):
        assert mcp_auth.state_is_valid(None, "anything") is False

    def test_state_is_rejected_when_it_does_not_match(self):
        assert mcp_auth.state_is_valid("expected", "attacker-supplied") is False

    def test_state_is_accepted_only_when_it_matches_exactly(self):
        assert mcp_auth.state_is_valid("s3cr3t-state", "s3cr3t-state") is True

    def test_the_retired_constant_state_no_longer_authorises_anything(self):
        # The old value must not be a skeleton key for a live flow.
        assert mcp_auth.state_is_valid("simulate_state", "simulate_state") is True
        assert mcp_auth.state_is_valid(mcp_auth.secrets.token_urlsafe(32), "simulate_state") is False

    def test_generated_state_is_unguessable_and_fresh_per_flow(self, manager, monkeypatch):
        """Two flows must not share a state, and it must not be a constant."""
        seen = []

        def fake_server(*args, **kwargs):
            raise RuntimeError("no socket in tests")

        monkeypatch.setattr(mcp_auth, "HTTPServer", fake_server)
        monkeypatch.setattr(mcp_auth.webbrowser, "open", lambda *a, **k: None)
        # The manual fallback prompts; refuse the paste so the flow ends.
        monkeypatch.setattr("builtins.input", lambda *a, **k: "")

        _add_server(manager)
        for _ in range(2):
            printed = []
            monkeypatch.setattr("builtins.print", lambda *a, **k: printed.append(" ".join(map(str, a))))
            mcp_auth.start_oauth_flow("srv", manager)
            url_line = next(line for line in printed if "state=" in line)
            seen.append(url_line.split("state=")[1].split("&")[0])

        assert "simulate_state" not in seen
        assert seen[0] != seen[1], "state must be regenerated per flow"
        assert all(len(s) >= 32 for s in seen), "state must be long enough to be unguessable"


class TestCallbackResult:
    """A callback that is not a success must still end the flow.

    The handler's failure branch used to send 400 and return without calling
    shutdown, so serve_forever() kept blocking with nothing left to arrive.
    The reachable case is ordinary: providers redirect with
    ?state=...&error=access_denied when someone clicks Deny, which carries a
    valid state and no code — so declining consent hung the CLI until Ctrl-C.
    """

    STATE = "the-flow-state"

    def test_a_valid_callback_yields_the_code_and_no_error(self):
        code, error = mcp_auth.callback_result(
            {"state": [self.STATE], "code": ["abc123"]}, self.STATE
        )
        assert code == "abc123"
        assert error is None

    def test_declining_consent_is_an_error_not_silence(self):
        code, error = mcp_auth.callback_result(
            {"state": [self.STATE], "error": ["access_denied"]}, self.STATE
        )
        assert code is None
        # Surfaced verbatim so the terminal can say why, and — critically —
        # non-None, which is what stops the caller waiting.
        assert error == "access_denied"

    def test_valid_state_with_no_code_and_no_error_still_reports_an_error(self):
        code, error = mcp_auth.callback_result({"state": [self.STATE]}, self.STATE)
        assert code is None
        assert error

    def test_a_mismatched_state_never_returns_a_code(self):
        code, error = mcp_auth.callback_result(
            {"state": ["attacker"], "code": ["attacker-code"]}, self.STATE
        )
        assert code is None
        assert "state" in error

    def test_state_is_checked_before_the_code_is_read(self):
        """Even a well-formed code is discarded when the state is absent."""
        code, _ = mcp_auth.callback_result({"code": ["abc123"]}, self.STATE)
        assert code is None

    def test_every_outcome_sets_exactly_one_of_code_or_error(self):
        cases = [
            {"state": [self.STATE], "code": ["c"]},
            {"state": [self.STATE], "error": ["access_denied"]},
            {"state": [self.STATE]},
            {"state": ["wrong"], "code": ["c"]},
            {},
        ]
        for params in cases:
            code, error = mcp_auth.callback_result(params, self.STATE)
            assert (code is None) != (error is None), params


# --- RFC 8414 discovery, and the end of the two hardcoded values --------------
#
# Before this, `start_oauth_flow` sent the browser to the MCP server's own URL
# with a comment admitting "we simulate it pointing to the target for now", and
# presented the literal client id "arete-client" with no way to change it. The
# guess is still the last resort — there is nothing better when a server
# publishes no metadata — but it is now labelled as a guess, which is the part
# that was missing.


def _fake_get(responses):
    """A ``get`` callable over {url: (status, json_or_None)}. Anything not in
    the map raises, standing in for a 404 or a refused connection."""

    def get(url):
        if url not in responses:
            raise httpx.ConnectError("nothing there")
        status, body = responses[url]
        response = MagicMock(spec=httpx.Response)
        response.status_code = status
        if body is None:
            response.json.side_effect = ValueError("not json")
        else:
            response.json.return_value = body
        return response

    return get


class TestMetadataUrls:
    def test_puts_the_well_known_segment_before_the_path_per_rfc_8414(self):
        urls = mcp_auth.metadata_urls("https://host.example/mcp")
        # §3.1: between host and path, NOT appended to it. Getting this
        # backwards is the single most common way discovery silently 404s.
        assert urls[0] == "https://host.example/.well-known/oauth-authorization-server/mcp"
        assert "https://host.example/.well-known/oauth-authorization-server" in urls

    def test_falls_back_to_openid_configuration(self):
        urls = mcp_auth.metadata_urls("https://host.example")
        assert "https://host.example/.well-known/openid-configuration" in urls

    def test_returns_nothing_for_a_url_it_cannot_parse(self):
        assert mcp_auth.metadata_urls("not-a-url") == []
        assert mcp_auth.metadata_urls("") == []


class TestDiscoverMetadata:
    def test_reads_the_authorization_endpoint_from_the_document(self):
        url = "https://host.example/.well-known/oauth-authorization-server/mcp"
        found = mcp_auth.discover_metadata(
            "https://host.example/mcp",
            get=_fake_get(
                {
                    url: (
                        200,
                        {
                            "issuer": "https://host.example",
                            "authorization_endpoint": "https://auth.example/authorize",
                            "token_endpoint": "https://auth.example/token",
                        },
                    )
                }
            ),
        )
        assert found["authorization_endpoint"] == "https://auth.example/authorize"
        assert found["token_endpoint"] == "https://auth.example/token"
        assert found["discovered_from"] == url

    def test_keeps_trying_the_remaining_locations_after_a_failure(self):
        # The path-inserted form 404s; the bare origin serves it. A discovery
        # that gave up on the first miss would find nothing on most servers.
        found = mcp_auth.discover_metadata(
            "https://host.example/mcp",
            get=_fake_get(
                {
                    "https://host.example/.well-known/oauth-authorization-server": (
                        200,
                        {"authorization_endpoint": "https://auth.example/authorize"},
                    )
                }
            ),
        )
        assert found["authorization_endpoint"] == "https://auth.example/authorize"

    def test_returns_none_when_no_server_answers(self):
        # Not an exception: a server without RFC 8414 metadata is ordinary.
        assert mcp_auth.discover_metadata("https://host.example/mcp", get=_fake_get({})) is None

    def test_ignores_a_document_that_is_not_json(self):
        urls = mcp_auth.metadata_urls("https://host.example/mcp")
        assert mcp_auth.discover_metadata(
            "https://host.example/mcp", get=_fake_get({u: (200, None) for u in urls})
        ) is None

    def test_refuses_a_relative_endpoint(self):
        # A scheme-less value would resolve against whatever the caller was
        # doing. Accepting it turns published metadata into an open redirect.
        urls = mcp_auth.metadata_urls("https://host.example/mcp")
        assert mcp_auth.discover_metadata(
            "https://host.example/mcp",
            get=_fake_get({u: (200, {"authorization_endpoint": "/authorize"}) for u in urls}),
        ) is None

    def test_ignores_a_non_2xx_response(self):
        urls = mcp_auth.metadata_urls("https://host.example/mcp")
        assert mcp_auth.discover_metadata(
            "https://host.example/mcp",
            get=_fake_get({u: (404, {"authorization_endpoint": "https://a/b"}) for u in urls}),
        ) is None


class TestResolveClientId:
    def test_prefers_the_id_configured_on_the_server(self, monkeypatch):
        monkeypatch.setenv(mcp_auth._CLIENT_ID_ENV_VAR, "from-env")
        assert mcp_auth.resolve_client_id({"client_id": "from-server"}) == "from-server"

    def test_falls_back_to_the_environment(self, monkeypatch):
        monkeypatch.setenv(mcp_auth._CLIENT_ID_ENV_VAR, "from-env")
        assert mcp_auth.resolve_client_id({}) == "from-env"

    def test_ignores_blank_values_rather_than_presenting_an_empty_client_id(self, monkeypatch):
        monkeypatch.delenv(mcp_auth._CLIENT_ID_ENV_VAR, raising=False)
        assert mcp_auth.resolve_client_id({"client_id": "   "}) == mcp_auth._CLIENT_ID

    def test_defaults_to_arete_client(self, monkeypatch):
        monkeypatch.delenv(mcp_auth._CLIENT_ID_ENV_VAR, raising=False)
        assert mcp_auth.resolve_client_id({}) == "arete-client"


class TestResolveAuthorizationEndpoint:
    def test_configured_value_wins_and_discovery_is_not_even_attempted(self):
        def explode(_url):
            raise AssertionError("discovery ran despite an explicit authorization_url")

        endpoint, source = mcp_auth.resolve_authorization_endpoint(
            {"authorization_url": "https://auth.example/authorize"},
            "https://host.example/mcp",
            discover=explode,
        )
        assert endpoint == "https://auth.example/authorize"
        assert "configured" in source

    def test_uses_discovery_when_nothing_is_configured(self):
        endpoint, source = mcp_auth.resolve_authorization_endpoint(
            {},
            "https://host.example/mcp",
            discover=lambda _u: {
                "authorization_endpoint": "https://auth.example/authorize",
                "discovered_from": "https://host.example/.well-known/x",
            },
        )
        assert endpoint == "https://auth.example/authorize"
        assert "RFC 8414" in source

    def test_says_it_is_guessing_when_it_falls_back_to_the_target(self):
        # The whole point. The old code did exactly this and said nothing, so
        # an operator debugging a blank page had no way to learn the URL was
        # invented. If this assertion is ever relaxed, that returns.
        endpoint, source = mcp_auth.resolve_authorization_endpoint(
            {}, "https://host.example/mcp", discover=lambda _u: None
        )
        assert endpoint == "https://host.example/mcp"
        assert "GUESSED" in source
        assert "authorization_url" in source
