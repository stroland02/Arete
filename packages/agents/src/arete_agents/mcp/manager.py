import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional


class MCPTokenRefreshError(Exception):
    """Raised when an MCP access token is past its skew window and cannot be
    refreshed (no refresh_token, no token_url, or the refresh POST failed).
    Fail closed: the caller must skip the server, never present a stale token."""


class MCPManager:
    def __init__(self, workspace_root: str = None):
        self.workspace_root = Path(workspace_root) if workspace_root else Path.cwd()
        self.config_file = self.workspace_root / ".agents" / "mcp_servers.json"
        
    def _load_config(self) -> Dict[str, Any]:
        if not self.config_file.exists():
            return {}
        try:
            with open(self.config_file, "r") as f:
                return json.load(f)
        except Exception:
            return {}
            
    def _save_config(self, config: Dict[str, Any]) -> None:
        # The file holds real OAuth access + refresh tokens in cleartext, so it
        # must be owner-only. mkdir the parent 0o700 and chmod the file 0o600
        # after write (chmod is a no-op on Windows, harmless).
        self.config_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with open(self.config_file, "w") as f:
            json.dump(config, f, indent=2)
        try:
            os.chmod(self.config_file, 0o600)
        except (OSError, NotImplementedError):
            pass

    def add_server(
        self,
        name: str,
        transport: str,
        url_or_cmd: str,
        allowed_agents: str = "all",
        token_url: Optional[str] = None,
    ) -> None:
        config = self._load_config()
        
        if name in config:
            print(
                f"The {name} MCP server was already added — that's why the command errored. "
                "It's registered and connecting, but shows 'Needs authentication'.\n"
            )
            print("To finish setup, authenticate it. You can either:")
            print(f"- Run the auth flow yourself in this session with: arete-agents mcp auth {name}\n")
            
            # Simple prompt logic replicating the example
            choice = input("Want me to start the authentication flow now? (Yes/No): ")
            if choice.lower() in ["y", "yes"]:
                from .auth import start_oauth_flow
                start_oauth_flow(name, self)
            return

        agents_list = [a.strip() for a in allowed_agents.split(",")] if allowed_agents != "all" else ["all"]
        config[name] = {
            "transport": transport,
            "target": url_or_cmd,
            "status": "Needs authentication",
            "token": None,
            # OAuth token endpoint for this server. When absent, the auth
            # flow (mcp/auth.py) fails closed rather than fabricating a
            # token -- see Task 6 (MCP auth honesty).
            "token_url": token_url,
            "expires_at": None,
            "refresh_token": None,
            "allowed_agents": agents_list
        }
        self._save_config(config)
        print(f"Successfully added MCP server: {name}")
        if allowed_agents != "all":
            print(f"This MCP server will ONLY be available to: {', '.join(agents_list)}")
        else:
            print("This MCP server will be available universally to all agents.")
        
    def get_server(self, name: str) -> Optional[Dict[str, Any]]:
        return self._load_config().get(name)
        
    def update_server_token(
        self,
        name: str,
        access_token: str,
        expires_at: Optional[float] = None,
        refresh_token: Optional[str] = None,
    ) -> None:
        """Store a REAL token obtained from a real OAuth exchange (see
        mcp/auth.py::exchange_code_for_token). Only ever called after a
        genuine `access_token` has been received -- never with a fabricated
        placeholder. ``refresh_token`` is only overwritten when the token
        response actually included one, so a prior refresh token survives
        an exchange whose response omits it."""
        config = self._load_config()
        if name in config:
            config[name]["token"] = access_token
            config[name]["expires_at"] = expires_at
            if refresh_token is not None:
                config[name]["refresh_token"] = refresh_token
            config[name]["status"] = "Authenticated"
            self._save_config(config)

    _REFRESH_SKEW_SECONDS = 60

    def get_valid_token(self, name: str, *, now: Optional[float] = None, post=None) -> Optional[str]:
        """Return a currently-valid access token for `name`, refreshing first if
        it is within _REFRESH_SKEW_SECONDS of (or past) expiry. Returns None if
        the server is unknown or has no stored token. Raises MCPTokenRefreshError
        if a refresh is required but impossible -- callers fail closed on that.

        `now`/`post` are injectable for testing without a real clock/network."""
        server = self.get_server(name)
        if not server:
            return None
        token = server.get("token")
        if not token:
            return None
        expires_at = server.get("expires_at")
        clock = time.time() if now is None else now
        # No expiry info -> present as-is (matches pre-refresh behavior; some
        # providers issue non-expiring tokens or omit expires_in).
        if expires_at is None:
            return token
        if clock < expires_at - self._REFRESH_SKEW_SECONDS:
            return token

        refresh_token = server.get("refresh_token")
        token_url = server.get("token_url")
        if not refresh_token or not token_url:
            raise MCPTokenRefreshError(
                f"MCP server '{name}' token is expired and cannot be refreshed "
                f"(missing {'refresh_token' if not refresh_token else 'token_url'})."
            )

        from .auth import TokenExchangeError, exchange_refresh_token
        try:
            result = exchange_refresh_token(token_url, refresh_token, post=post)
        except TokenExchangeError as exc:
            raise MCPTokenRefreshError(f"MCP token refresh for '{name}' failed: {exc}") from exc

        self.update_server_token(
            name,
            access_token=result["access_token"],
            expires_at=result["expires_at"],
            refresh_token=result["refresh_token"],
        )
        return result["access_token"]
