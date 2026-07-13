import json
from pathlib import Path
from typing import Dict, Any, Optional

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
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_file, "w") as f:
            json.dump(config, f, indent=2)

    def add_server(self, name: str, transport: str, url_or_cmd: str, allowed_agents: str = "all") -> None:
        config = self._load_config()
        
        if name in config:
            print(f"The {name} MCP server was already added — that's why the command errored. It's registered and connecting, but shows 'Needs authentication'.\n")
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
        
    def update_server_token(self, name: str, token: str) -> None:
        config = self._load_config()
        if name in config:
            config[name]["token"] = token
            config[name]["status"] = "Authenticated"
            self._save_config(config)
