import argparse
import sys
from typing import List

from .auth import start_oauth_flow
from .manager import MCPManager


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
    
    parsed_args = parser.parse_args(args)
    manager = MCPManager()
    
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
