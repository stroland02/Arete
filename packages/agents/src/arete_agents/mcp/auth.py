import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import sys
import time
import urllib.parse
import webbrowser

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == "/callback":
            query_params = parse_qs(parsed_path.query)
            if "code" in query_params:
                code = query_params["code"][0]
                self.server.oauth_code = code
                
                self.send_response(200)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"<html><body><h1>Authentication Successful!</h1><p>You can close this tab and return to the terminal.</p></body></html>")
                
                # Signal the server to stop
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            else:
                self.send_response(400)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"<html><body><h1>Authentication Failed!</h1><p>Missing authorization code.</p></body></html>")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress logging to keep the terminal clean
        pass

def start_oauth_flow(name: str, manager) -> None:
    server_info = manager.get_server(name)
    if not server_info:
        print(f"Error: MCP server '{name}' not found. Please add it first.")
        return
        
    target_url = server_info.get("target")
    
    # Construct a simulated OAuth URL
    state = "simulate_state"
    client_id = "arete-client"
    redirect_uri = urllib.parse.quote("http://localhost:3118/callback")
    
    # Ideally, we would fetch the auth_endpoint from the MCP server, 
    # but we simulate it pointing to the target for now.
    auth_url = f"{target_url}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code&state={state}&scope=mcp:read"
    
    print("\nOAuth flow started. Open this URL in your browser to authorize:")
    print(auth_url)
    print("\nAfter you approve, your browser redirects to a http://localhost:3118/callback?code=... page.")
    print("- If it loads fine, authentication completes automatically — just let me know.")
    print("- If the page shows a connection error (common when nothing is listening on port 3118), copy the full URL from the address bar and paste it here. I'll finish the flow with it.\n")
    
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
        
        # Start serving in the main thread (blocks until shutdown is called)
        server.serve_forever()
        
        if server.oauth_code:
            print(f"Successfully received authorization code.")
            # In a real scenario, we'd exchange the code for a token here.
            # We'll simulate receiving a token.
            token = f"simulated_token_for_{server.oauth_code}"
            manager.update_server_token(name, token)
            print(f"Authentication complete! {name} is now ready to use.")
        else:
            print("OAuth flow did not return a code.")
    except Exception as e:
        print(f"Failed to start local server on port {port}. Please use manual fallback.")
        manual_url = input("Paste the redirected callback URL here: ")
        parsed = urlparse(manual_url)
        params = parse_qs(parsed.query)
        if "code" in params:
            token = f"simulated_token_for_{params['code'][0]}"
            manager.update_server_token(name, token)
            print(f"Authentication complete! {name} is now ready to use.")
        else:
            print("Invalid URL provided. Authentication failed.")
