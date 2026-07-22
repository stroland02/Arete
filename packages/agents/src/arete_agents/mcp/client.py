import asyncio
import threading
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool

from .manager import MCPManager

# We use lazy imports to ensure we don't break the CLI if mcp is missing
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.sse import sse_client
    from mcp.client.stdio import stdio_client
    HAS_MCP = True
except ImportError:
    HAS_MCP = False

# Global state to maintain open connections across synchronous agent calls
_bg_loop: Optional[asyncio.AbstractEventLoop] = None
_bg_thread: Optional[threading.Thread] = None
_sessions: Dict[str, "ClientSession"] = {}
_tool_definitions: Dict[str, List[Any]] = {}

def _run_bg_loop(loop: asyncio.AbstractEventLoop):
    asyncio.set_event_loop(loop)
    loop.run_forever()

def _ensure_bg_loop():
    global _bg_loop, _bg_thread
    if _bg_loop is None:
        _bg_loop = asyncio.new_event_loop()
        _bg_thread = threading.Thread(target=_run_bg_loop, args=(_bg_loop,), daemon=True)
        _bg_thread.start()
    return _bg_loop

async def _connect_stdio(server_name: str, target: str):
    parts = target.split()
    server_params = StdioServerParameters(command=parts[0], args=parts[1:])
    transport = stdio_client(server_params)
    read, write = await transport.__aenter__()
    
    session = ClientSession(read, write)
    await session.__aenter__()
    await session.initialize()
    
    _sessions[server_name] = session
    tools = await session.list_tools()
    _tool_definitions[server_name] = tools.tools

async def _connect_http(server_name: str, url: str, token: str):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    transport = sse_client(url, headers=headers)
    read, write = await transport.__aenter__()
    
    session = ClientSession(read, write)
    await session.__aenter__()
    await session.initialize()
    
    _sessions[server_name] = session
    tools = await session.list_tools()
    _tool_definitions[server_name] = tools.tools

def _create_langchain_tool(server_name: str, mcp_tool_def: Any) -> Any:
    """
    Dynamically creates a LangChain tool function that executes the MCP tool.
    """
    tool_name = mcp_tool_def.name
    tool_desc = mcp_tool_def.description
    
    # We must use a synchronous wrapper that bridges to the async background loop
    def _execute_tool(**kwargs) -> str:
        session = _sessions.get(server_name)
        if not session:
            return "Error: MCP session is not connected."
            
        async def _call():
            # In MCP, call_tool takes the tool name and arguments dictionary
            result = await session.call_tool(tool_name, arguments=kwargs)
            # Basic parsing of MCP CallToolResult
            return str(result.content) if result.content else "Executed successfully."
            
        future = asyncio.run_coroutine_threadsafe(_call(), _bg_loop)
        try:
            return future.result(timeout=15)
        except Exception as e:
            return f"Error executing tool {tool_name}: {e}"

    # Use LangChain's StructuredTool or standard tool decorator
    # For simplicity, we create a function with a matching docstring
    _execute_tool.__name__ = tool_name
    _execute_tool.__doc__ = tool_desc
    
    return tool(_execute_tool)

def get_mcp_tools_for_agent(agent_name: str, workspace_root: str = None) -> List[Any]:
    """
    Reads the MCP server configurations, establishes background connections if needed, 
    and returns the LangChain tools that the specified agent is allowed to use.
    """
    if not HAS_MCP:
        print("Warning: 'mcp' package is not installed. MCP tools will be ignored.")
        return []
        
    loop = _ensure_bg_loop()
    manager = MCPManager(workspace_root)
    config = manager._load_config()
    
    langchain_tools = []
    
    for server_name, details in config.items():
        if details.get("status") != "Authenticated":
            continue
            
        allowed_agents = details.get("allowed_agents", ["all"])
        
        # Check if this agent is allowed to use this MCP server's tools
        if "all" not in allowed_agents and agent_name not in allowed_agents:
            continue
            
        # Connect to server if not already connected
        if server_name not in _sessions:
            try:
                if details["transport"] == "stdio":
                    future = asyncio.run_coroutine_threadsafe(_connect_stdio(server_name, details["target"]), loop)
                    future.result(timeout=10)
                elif details["transport"] == "http":
                    # Materialize the Bearer via get_valid_token so a near-expiry
                    # token is refreshed first, and an unrefreshable expired token
                    # fails closed (MCPTokenRefreshError -> caught below -> server
                    # skipped) instead of being presented stale.
                    token = manager.get_valid_token(server_name)
                    future = asyncio.run_coroutine_threadsafe(
                        _connect_http(server_name, details["target"], token), loop
                    )
                    future.result(timeout=10)
            except Exception as e:
                print(f"Failed to connect to MCP server {server_name}: {e}")
                continue
                
        # Convert MCP tools to LangChain tools
        if server_name in _tool_definitions:
            for mcp_tool in _tool_definitions[server_name]:
                langchain_tools.append(_create_langchain_tool(server_name, mcp_tool))

    return langchain_tools


def get_or_create_session(server_name: str, command: str) -> "ClientSession":
    """Public entry point for callers that need a raw stdio MCP session
    directly (not a LangChain tool list) — e.g. context_map.indexer talking
    to a local codebase-memory-mcp binary that needs no auth/config file at
    all. Reuses the same background event loop and session cache as
    get_mcp_tools_for_agent so both code paths share one connection per
    server_name."""
    if not HAS_MCP:
        raise RuntimeError("The 'mcp' package is not installed.")

    loop = _ensure_bg_loop()
    if server_name not in _sessions:
        future = asyncio.run_coroutine_threadsafe(_connect_stdio(server_name, command), loop)
        future.result(timeout=15)
    return _sessions[server_name]


def wrap_server_tools(server_name: str, allowed_names: "frozenset[str] | None" = None) -> List[Any]:
    """Wrap the already-advertised tools of a CONNECTED MCP server (see
    get_or_create_session) into LangChain tools. Optionally restrict to an
    allowlist of tool names. Returns [] when the mcp package is unavailable,
    the server has no live session, or it advertised no tools. Opens no new
    connection — read-only over the existing session cache."""
    if not HAS_MCP:
        return []
    if server_name not in _sessions:
        return []
    tools: List[Any] = []
    for mcp_tool in _tool_definitions.get(server_name, []):
        if allowed_names is not None and mcp_tool.name not in allowed_names:
            continue
        tools.append(_create_langchain_tool(server_name, mcp_tool))
    return tools


def call_tool_sync(server_name: str, tool_name: str, arguments: dict, timeout: float = 60) -> Any:
    """Synchronously call a tool on an already-connected stdio session
    (see get_or_create_session). Raises RuntimeError if server_name has no
    active session."""
    session = _sessions.get(server_name)
    if not session:
        raise RuntimeError(f"No MCP session for server '{server_name}'.")

    async def _call():
        return await session.call_tool(tool_name, arguments=arguments)

    future = asyncio.run_coroutine_threadsafe(_call(), _bg_loop)
    return future.result(timeout=timeout)
