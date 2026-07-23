import secrets
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Optional
from urllib.parse import parse_qs, urlparse

import httpx

_TOKEN_REQUEST_TIMEOUT_S = 10.0
_CLIENT_ID = "arete-client"
_REDIRECT_URI = "http://localhost:3118/callback"

PostFn = Callable[[str, dict, dict], httpx.Response]


class TokenExchangeError(Exception):
    """Raised when the token endpoint can't be trusted for a real
    credential: a transport failure, a non-2xx status, an unparsable body,
    or a response missing `access_token`. The caller must never respond to
    this by fabricating a token -- it must fail closed."""


def _default_post(url: str, data: dict, headers: dict) -> httpx.Response:
    return httpx.post(url, data=data, headers=headers, timeout=_TOKEN_REQUEST_TIMEOUT_S)


def exchange_code_for_token(
    token_url: str,
    code: str,
    redirect_uri: str = _REDIRECT_URI,
    client_id: str = _CLIENT_ID,
    post: Optional[PostFn] = None,
) -> dict:
    """Real `grant_type=authorization_code` exchange against `token_url`.

    Models packages/webhook/src/oauth/oauth-token-exchange.ts: a real POST
    to the provider's token endpoint, `expires_at = now + expires_in`.
    Raises TokenExchangeError -- and NEVER returns a fabricated
    placeholder -- on transport failure, a non-2xx response, an unparsable
    body, or a response missing `access_token`.

    ``post`` is injectable for testing without a real network call; when
    omitted, resolved from the module-level `_default_post` at CALL time
    (not bind time) so tests can monkeypatch it.
    """
    post_fn = post if post is not None else _default_post

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    try:
        response = post_fn(token_url, data, headers)
    except httpx.HTTPError as exc:
        raise TokenExchangeError(f"could not reach the token endpoint ({exc})") from exc

    if not (200 <= response.status_code < 300):
        raise TokenExchangeError(
            f"token endpoint returned HTTP {response.status_code}: {response.text[:500]}"
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise TokenExchangeError(f"token endpoint returned a non-JSON response ({exc})") from exc

    access_token = payload.get("access_token")
    if not access_token:
        raise TokenExchangeError("token endpoint response is missing 'access_token'")

    expires_in = payload.get("expires_in")
    expires_at = time.time() + expires_in if isinstance(expires_in, (int, float)) else None

    return {
        "access_token": access_token,
        "expires_at": expires_at,
        "refresh_token": payload.get("refresh_token"),
    }


def exchange_refresh_token(
    token_url: str,
    refresh_token: str,
    client_id: str = _CLIENT_ID,
    post: Optional[PostFn] = None,
) -> dict:
    """Real `grant_type=refresh_token` exchange against `token_url`.

    A sibling to exchange_code_for_token for renewing an access token that is
    at/near expiry. Same fail-closed contract: raises TokenExchangeError -- and
    NEVER returns a fabricated placeholder -- on transport failure, a non-2xx
    response, an unparsable body, or a response missing `access_token`.

    Returns {access_token, expires_at, refresh_token}; per RFC 6749 the response
    MAY omit refresh_token (the caller keeps the prior one via
    update_server_token, which only overwrites on a non-None value).
    """
    post_fn = post if post is not None else _default_post

    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    try:
        response = post_fn(token_url, data, headers)
    except httpx.HTTPError as exc:
        raise TokenExchangeError(f"could not reach the token endpoint ({exc})") from exc

    if not (200 <= response.status_code < 300):
        raise TokenExchangeError(
            f"token endpoint returned HTTP {response.status_code}: {response.text[:500]}"
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise TokenExchangeError(f"token endpoint returned a non-JSON response ({exc})") from exc

    access_token = payload.get("access_token")
    if not access_token:
        raise TokenExchangeError("token endpoint response is missing 'access_token'")

    expires_in = payload.get("expires_in")
    expires_at = time.time() + expires_in if isinstance(expires_in, (int, float)) else None

    return {
        "access_token": access_token,
        "expires_at": expires_at,
        "refresh_token": payload.get("refresh_token"),
    }


def _complete_auth(name: str, manager, code: str) -> None:
    """Shared by both the local-callback-server branch and the manual
    fallback branch of start_oauth_flow: exchange the real authorization
    `code` for a real token, or fail closed with an honest message.

    This used to fabricate `simulated_token_for_{code}` and print a
    success message with no exchange ever happening (the honesty defect
    this function replaces). Now: no `token_url` configured -> nothing is
    stored, status stays "Needs authentication", and we say so plainly.
    Exchange failure -> nothing is stored, the real error is printed.
    Only a genuine `access_token` response reaches `update_server_token`
    and the "ready to use" message.
    """
    server_info = manager.get_server(name) or {}
    token_url = server_info.get("token_url")
    if not token_url:
        print(
            f"Token endpoint not configured for '{name}'; server left unauthenticated. "
            "Set token_url on this MCP server to complete a real OAuth exchange."
        )
        return

    try:
        result = exchange_code_for_token(token_url, code)
    except TokenExchangeError as exc:
        print(f"Authentication failed: {exc}")
        return

    manager.update_server_token(
        name,
        access_token=result["access_token"],
        expires_at=result["expires_at"],
        refresh_token=result["refresh_token"],
    )
    print(f"Authentication complete! {name} is now ready to use.")


def state_is_valid(expected: Optional[str], received: Optional[str]) -> bool:
    """Whether a callback's `state` proves it belongs to the flow we started.

    The `state` parameter is OAuth's CSRF defence: an attacker who can make the
    victim's browser hit our callback with an authorization code of the
    attacker's choosing would otherwise bind the attacker's account to the
    victim's MCP server. Only a value we generated ourselves is acceptable, so a
    missing or mismatched `state` fails closed.

    Compared with `secrets.compare_digest` so the check does not leak the
    expected value through timing.
    """
    if not expected or not received:
        return False
    return secrets.compare_digest(expected, received)


def callback_result(
    query_params: dict, expected_state: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    """Decide a callback's outcome as `(code, error)` — exactly one is set.

    Pure, so the branches can be tested without binding a socket. The order
    matters: `state` is checked before the code is even looked at, because an
    unverified code must never reach the caller.

    A callback carrying a valid `state` but no `code` is a *failure*, not a
    non-event — the usual cause is the provider redirecting with
    `?error=access_denied` when someone declines consent. It gets an error so
    the caller stops waiting; see the shutdown note in `do_GET`.
    """
    received = (query_params.get("state") or [None])[0]
    if not state_is_valid(expected_state, received):
        return None, "callback state did not match the value this flow generated"

    code = (query_params.get("code") or [None])[0]
    if code:
        return code, None

    provider_error = (query_params.get("error") or [None])[0]
    return None, provider_error or "callback carried no authorization code"


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return

        code, error = callback_result(
            parse_qs(parsed_path.query), getattr(self.server, "expected_state", None)
        )

        if code:
            self.server.oauth_code = code
            body = (
                b"<html><body><h1>Authentication Successful!</h1><p>You can close this tab "
                b"and return to the terminal.</p></body></html>"
            )
            self.send_response(200)
        else:
            self.server.oauth_error = error
            body = (
                b"<html><body><h1>Authentication Failed!</h1><p>This callback was rejected "
                b"and nothing was stored. Return to the terminal for the reason.</p></body></html>"
            )
            self.send_response(400)

        self.send_header("Content-type", "text/html")
        self.end_headers()
        self.wfile.write(body)

        # Every /callback outcome stops the server, success or not. Failing to
        # shut down on the failure paths left serve_forever() blocking with
        # nothing left to wait for, so declining consent hung the CLI until
        # Ctrl-C.
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def log_message(self, format, *args):
        # Suppress logging to keep the terminal clean
        pass

def start_oauth_flow(name: str, manager) -> None:
    server_info = manager.get_server(name)
    if not server_info:
        print(f"Error: MCP server '{name}' not found. Please add it first.")
        return
        
    target_url = server_info.get("target")

    # A fresh, unguessable state per flow. This was previously the constant
    # "simulate_state" and was never checked on the way back, so the callback
    # accepted any authorization code any page could send it — the CSRF hole
    # `state` exists to close.
    state = secrets.token_urlsafe(32)
    client_id = "arete-client"
    redirect_uri = urllib.parse.quote("http://localhost:3118/callback")
    
    # Ideally, we would fetch the auth_endpoint from the MCP server, 
    # but we simulate it pointing to the target for now.
    auth_url = (
        f"{target_url}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code"
        f"&state={state}&scope=mcp:read"
    )
    
    print("\nOAuth flow started. Open this URL in your browser to authorize:")
    print(auth_url)
    print("\nAfter you approve, your browser redirects to a http://localhost:3118/callback?code=... page.")
    print("- If it loads fine, authentication completes automatically — just let me know.")
    print(
        "- If the page shows a connection error (common when nothing is listening on port 3118), "
        "copy the full URL from the address bar and paste it here. I'll finish the flow with it.\n"
    )
    
    # Open browser automatically if possible
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass
        
    # Start local server to catch the callback
    port = 3118
    try:
        server = HTTPServer(("localhost", port), OAuthCallbackHandler)
        server.oauth_code = None
        server.oauth_error = None
        server.expected_state = state

        # Start serving in the main thread (blocks until shutdown is called)
        server.serve_forever()

        if server.oauth_error:
            print(f"Authentication rejected: {server.oauth_error}. Nothing was stored.")
        elif server.oauth_code:
            print("Successfully received authorization code.")
            _complete_auth(name, manager, server.oauth_code)
        else:
            print("OAuth flow did not return a code.")
    except Exception:
        print(f"Failed to start local server on port {port}. Please use manual fallback.")
        manual_url = input("Paste the redirected callback URL here: ")
        parsed = urlparse(manual_url)
        params = parse_qs(parsed.query)
        # The pasted URL gets the same check as the automatic callback — a
        # fallback that skipped it would be the same hole by another door.
        if not state_is_valid(state, (params.get("state") or [None])[0]):
            print(
                "That callback URL does not carry the state this flow generated, "
                "so it was rejected. Nothing was stored."
            )
        elif "code" in params:
            _complete_auth(name, manager, params["code"][0])
        else:
            print("Invalid URL provided. Authentication failed.")
