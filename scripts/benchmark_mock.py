import time
import os
import sys

# Add packages/agents to path so we can import directly
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages", "agents", "src")))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages", "agents", "tests")))

from arete_agents.models.pr import PRContext, FileChange
from arete_agents.orchestrator import ReviewOrchestrator
from langchain_core.messages import AIMessage
from unittest.mock import MagicMock

def make_mock_llm(responses):
    mock = MagicMock()
    # If responses is a list, pop one by one
    def side_effect(*args, **kwargs):
        return AIMessage(content=responses.pop(0) if responses else responses[-1])
    mock.invoke.side_effect = side_effect
    mock.with_retry.return_value = mock
    return mock

# The complex PR
pr = PRContext(
    repo="acme/benchmark",
    pr_number=999,
    title="feat: Bulk user fetching with custom SQL",
    description="Added a new endpoint to fetch users.",
    files=[
        FileChange(
            path="src/users.py",
            additions=10,
            deletions=0,
            patch="+def get_all_users_info(user_ids):\n+    for uid in user_ids:\n+        query = f\"SELECT * FROM users WHERE id = {uid}\""
        )
    ]
)

# Mock responses for the 6 agents + 1 synthesizer
MOCK_RESPONSES = [
    # 1. Security: Flags SQL Injection
    '{"comments": [{"path": "src/users.py", "line": 3, "body": "Critical SQL Injection vulnerability.", "severity": "error", "category": "security"}], "summary": "SQLi found"}',
    # 2. Performance: Flags N+1
    '{"comments": [{"path": "src/users.py", "line": 3, "body": "N+1 Query inside loop.", "severity": "warning", "category": "performance"}], "summary": "N+1 found"}',
    # 3. Quality: Flags f-string
    '{"comments": [{"path": "src/users.py", "line": 3, "body": "Use parameterized queries, not f-strings.", "severity": "warning", "category": "quality"}], "summary": "Quality issue"}',
    # 4. Test Coverage
    '{"comments": [], "summary": "No tests added."}',
    # 5. Deployment
    '{"comments": [], "summary": "No deployment risk."}',
    # 6. Business Logic
    '{"comments": [], "summary": "No business logic issue."}',
    
    # 7. Synthesizer: Merges the 3 overlapping line 3 comments into ONE highly dense comment
    '{"comments": [{"path": "src/users.py", "line": 3, "body": "[SECURITY & PERFORMANCE] Severe issue: This line contains a critical SQL Injection AND an N+1 query loop. You must use parameterized bulk queries.", "severity": "error", "category": "synthesized"}], "summary": "Synthesized 3 issues into 1 comment.", "risk_level": "critical", "total_comments": 1, "file_reviews": []}'
]

def run():
    print("Starting Areté LangGraph Benchmark (MOCKED)...")
    llm = make_mock_llm(MOCK_RESPONSES)
    orch = ReviewOrchestrator(llm=llm)
    
    start = time.time()
    result = orch.run(pr)
    latency = time.time() - start
    
    print("\n--- BENCHMARK RESULTS ---")
    print(f"Latency:           {latency:.2f} seconds (Mocked)")
    print(f"Risk Level:        {result.risk_level.upper()}")
    print(f"Total Comments:    {result.total_comments}")
    
    overlapping = 0
    # In this mock, the synthesizer reduced it to 1 comment
    print("\nDetailed Comments:")
    for fr in result.file_reviews:
        for c in fr.comments:
            print(f"  [{c.severity.upper()}] Line {c.line} ({c.category}):")
            print(f"    {c.body}")

if __name__ == "__main__":
    run()
