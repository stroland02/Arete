import argparse
import json
import sys
from typing import List

from .auth import start_oauth_flow
from .manager import MCPManager
from .token_crypto import KEY_ENV_VAR, store_status


def _raw_config(manager: MCPManager) -> dict:
    """The store exactly as it sits on disk, still encrypted.

    An unreadable or absent store reports as empty here — the same posture
    `_load_config` takes — because "cannot read the file" and "no servers" look
    identical to an operator, and neither is a reason to claim protection.
    """
    try:
        with open(manager.config_file, "r") as handle:
            return json.load(handle)
    except Exception:
        return {}


def print_status(manager: MCPManager) -> None:
    """Report what is registered and whether the stored tokens are readable.

    Exists because the plaintext warning fires once, at write time, into the
    log — an operator asking "are my tokens safe on disk?" had no way to ask.
    Prints auth state and encryption tallies; never a token value, not even
    truncated, because a partial credential in a terminal is still a
    credential in a terminal.
    """
    # Deliberately the raw store, never _load_config(): that decrypts, and
    # decryption raises when the file is encrypted but no key is set — which is
    # the exact situation this command exists to diagnose. A status command
    # that dies on the fault it reports is worse than no status command.
    config = _raw_config(manager)

    if not config:
        print("No MCP servers registered.")
        print("  Add one:  arete-agents mcp add <name> <url>")
        return

    print(f"{len(config)} MCP server(s):\n")
    for name, server in sorted(config.items()):
        if not isinstance(server, dict):
            continue
        authed = "authenticated" if server.get("token") else "needs authentication"
        print(f"  {name}")
        print(f"    transport  {server.get('transport', 'unknown')}")
        print(f"    target     {server.get('target', 'unknown')}")
        print(f"    auth       {authed}")

    status = store_status(config)
    print()
    if status["at_rest_protected"]:
        print(f"Tokens are encrypted at rest ({status['encrypted']} value(s)).")
    elif status["plaintext"]:
        print(f"WARNING: {status['plaintext']} token value(s) are stored in CLEARTEXT.")
        if not status["key_configured"]:
            print(f"  {KEY_ENV_VAR} is not set. Generate a key:")
            print(
                '  python -c "from arete_agents.mcp.token_crypto import generate_key; '
                'print(generate_key())"'
            )
        else:
            print(
                f"  {KEY_ENV_VAR} is set, but these were written before it was — "
                "re-authenticate those servers to encrypt them."
            )
    else:
        print("No tokens stored yet.")


def handle_mcp_cli(args: List[str]) -> None:
    parser = argparse.ArgumentParser(prog="arete-agents mcp", description="Manage MCP servers for Areté")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    # Add command
    add_parser = subparsers.add_parser("add", help="Add an MCP server")
    add_parser.add_argument("--transport", default="http", choices=["http", "stdio"], help="Transport type")
    add_parser.add_argument(
        "--agents",
        default="all",
        help=(
            "Comma-separated list of agents to attach these tools to "
            "(e.g. 'SecurityAgent,PerformanceAgent'). Default is 'all'."
        ),
    )
    add_parser.add_argument("name", help="Name of the MCP server")
    add_parser.add_argument("url_or_cmd", help="URL for HTTP transport, or Command for stdio transport")
    
    # Auth command
    auth_parser = subparsers.add_parser("auth", help="Authenticate an MCP server")
    auth_parser.add_argument("name", help="Name of the MCP server to authenticate")

    # Status command
    subparsers.add_parser(
        "status",
        help="Show registered servers and whether their tokens are encrypted at rest",
    )

    parsed_args = parser.parse_args(args)
    manager = MCPManager()

    if parsed_args.command == "status":
        print_status(manager)
        return

    if parsed_args.command == "add":
        manager.add_server(
            name=parsed_args.name, 
            transport=parsed_args.transport, 
            url_or_cmd=parsed_args.url_or_cmd,
            allowed_agents=parsed_args.agents
        )
    elif parsed_args.command == "auth":
        start_oauth_flow(parsed_args.name, manager)
    else:
        parser.print_help()
        sys.exit(1)
