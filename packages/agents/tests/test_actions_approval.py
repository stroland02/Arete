from arete_agents.tools.actions import request_infrastructure_approval


def test_request_infra_approval_is_truthful_not_fake_resume():
    out = request_infrastructure_approval.invoke(
        {"command": "aws s3 rm x", "reason": "leak"}
    )
    assert "aws s3 rm x" in out and "leak" in out
    assert "Resuming" not in out  # no longer lies about resuming inline
    assert "await" in out.lower() or "suspend" in out.lower()
