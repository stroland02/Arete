import time
import requests
import json

FASTAPI_URL = "http://127.0.0.1:8000/review"

# A synthetic PR carefully designed to trigger MULTIPLE agents at once.
# - SecurityAgent: SQL Injection
# - PerformanceAgent: N+1 query pattern inside a loop
# - QualityAgent: Unhandled exception / bad naming
# - TestCoverageAgent: Missing test path (implicitly)
# We want to see if the LangGraph Synthesizer successfully merges the overlapping 
# complaints into a single, high-quality, non-spammy review block.
COMPLEX_PR_PAYLOAD = {
    "repo": "acme/benchmark",
    "pr_number": 999,
    "title": "feat: Bulk user fetching with custom SQL",
    "description": "Added a new endpoint to fetch users. I used raw SQL for speed.",
    "files": [
        {
            "path": "src/users.py",
            "additions": 10,
            "deletions": 0,
            "patch": (
                "+def get_all_users_info(user_ids):\n"
                "+    # BAD LOOP\n"
                "+    results = []\n"
                "+    for uid in user_ids:\n"
                "+        # SECURITY + PERFORMANCE + QUALITY NIGHTMARE\n"
                "+        query = f\"SELECT * FROM users JOIN profiles ON users.id = profiles.user_id WHERE users.id = {uid}\"\n"
                "+        res = db.execute(query).fetchall()\n"
                "+        results.append(res)\n"
                "+    return results\n"
            )
        }
    ]
}

def run_benchmark():
    print("Starting Areté LangGraph Benchmark...\n")
    print(f"Payload Size: {len(json.dumps(COMPLEX_PR_PAYLOAD))} bytes")
    print("Targeting: Multiple agents (Security, Performance, Quality)\n")
    
    start_time = time.time()
    
    try:
        response = requests.post(FASTAPI_URL, json=COMPLEX_PR_PAYLOAD, timeout=60)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Failed to reach FastAPI server: {e}")
        print("Make sure it's running via: uv run uvicorn arete_agents.server:app --port 8000")
        return

    end_time = time.time()
    latency = end_time - start_time
    
    result = response.json()
    
    # Analyze the result
    file_reviews = result.get("file_reviews", [])
    total_comments = result.get("total_comments", 0)
    risk_level = result.get("risk_level", "low")
    
    # Calculate Deduplication / Quality Metric
    # If it was a naive ThreadPool, we'd have 3+ comments on the exact same line.
    # The LangGraph synthesizer should ideally condense this to 1-2 highly dense comments.
    all_comments = []
    for fr in file_reviews:
        all_comments.extend(fr.get("comments", []))
        
    line_counts = {}
    for c in all_comments:
        line = c.get("line")
        line_counts[line] = line_counts.get(line, 0) + 1
        
    overlapping_lines = sum(1 for v in line_counts.values() if v > 1)
    
    print("--- BENCHMARK RESULTS ---")
    print(f"Latency:           {latency:.2f} seconds")
    print(f"Risk Level:        {risk_level.upper()}")
    print(f"Total Comments:    {total_comments}")
    print(f"Overlapping Lines: {overlapping_lines} (Lower is better, indicates good Synthesizer deduplication)")
    print("\nSynthesizer Overall Summary:")
    print(result.get("overall_summary", ""))
    
    print("\nDetailed Comments:")
    for c in all_comments:
        print(f"  [{c.get('severity').upper()}] Line {c.get('line')} ({c.get('category')}):")
        print(f"    {c.get('body')}")
        print("-" * 40)
        
if __name__ == "__main__":
    run_benchmark()
