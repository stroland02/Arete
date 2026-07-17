from arete_agents.tools.actions import propose_pr

# A real, grounded unified diff (adds two lines to app.py).
_GOOD_PATCH = """--- a/app.py
+++ b/app.py
@@ -1,3 +1,4 @@
 def f():
-    return 1
+    return 2
+    # fixed
"""

# A syntactically valid diff that only deletes lines -> no resulting new lines.
_PURE_DELETION = """--- a/app.py
+++ b/app.py
@@ -1,2 +1,0 @@
-line1
-line2
"""


def _invoke(**overrides):
    args = dict(
        repo_full_name="owner/repo",
        title="Fix off-by-one",
        body="grounded fix",
        branch_name="arete/fix-offbyone",
        base_branch="main",
        patch_content=_GOOD_PATCH,
    )
    args.update(overrides)
    return propose_pr.invoke(args)


def test_rejects_branch_not_prefixed():
    out = _invoke(branch_name="feature/x")
    assert "Rejected" in out
    assert "arete/fix-" in out
    assert "Successfully proposed" not in out


def test_rejects_non_unified_diff():
    out = _invoke(patch_content="here is my fix: change return 1 to return 2")
    assert "Rejected" in out
    assert "unified diff" in out.lower()
    assert "Successfully proposed" not in out


def test_rejects_empty_patch():
    out = _invoke(patch_content="")
    assert "Rejected" in out
    assert "Successfully proposed" not in out


def test_rejects_pure_deletion_with_no_resulting_lines():
    out = _invoke(patch_content=_PURE_DELETION)
    assert "Rejected" in out
    assert "Successfully proposed" not in out


def test_grounded_patch_is_validated_and_pr_open_deferred_to_platform():
    out = _invoke()
    # Never fabricates a completed PR.
    assert "Successfully proposed" not in out
    # Truthful: the patch was validated as a real grounded diff...
    assert "Validated" in out
    assert "confirmed against the diff" in out
    # ...and honest about where the PR actually gets opened (not this process).
    assert "apply path" in out.lower()
