# Grounding & Verification Hardening (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two deterministic, non-LLM verification gates to the review pipeline — every comment's line number must exist in the real diff, and security comments must additionally quote real code from it.

**Architecture:** A new pure-function module (`grounding.py`) parses unified-diff patches to compute valid line numbers and check for quoted-evidence substrings. `ReviewOrchestrator` gains one more additive gate (`_apply_grounding`), called right after the existing `_apply_critic`, following that exact same pattern.

**Tech Stack:** Python 3.12, `arete_agents` (pytest), pure stdlib (`re`) — no new dependencies.

## Global Constraints

- **Line-citation validation applies to every category, no exceptions** — but only when the file's patch actually parsed into at least one real `@@ ... @@` hunk (see the refinement below).
- **Evidence-gating (quoted-content check) applies to `category == "security"` only**, and — this is a refinement discovered during planning, not in the original spec's exact wording, but a direct consequence of its stated fail-open principle — **only runs when the patch also parsed successfully.** If Gate 1 can't parse a file's patch at all, Gate 2 must not run either: a stricter check has no business executing against a diff we've already decided we can't trust ourselves to parse. Applying Gate 2 independently of Gate 1's parse result would mean an unparseable/malformed patch could still cause security comments to be dropped — the opposite of "fail-open on unparseable patches."
- **Fail-open on unparseable patches:** a file whose patch has zero `@@ ... @@` hunk markers must not have ANY of its comments touched by either gate — `valid_lines_for_patch` returns `None` (not an empty set) to signal "couldn't parse," and the caller treats `None` as "skip both gates for this file's comments entirely, pass them all through."
- **Fail-closed for missing security evidence — but only on a successfully-parsed diff:** a security comment with zero backtick-quoted spans in its body, on a file whose patch DID parse, is dropped. This is the one deliberate exception to the fail-open rule above, and it only applies once we trust our own parse of the diff.
- **Two new `ReviewResult` fields**, matching the exact naming/style of the existing `dropped_count`/`critic_dropped_count`: `citation_dropped_count: int = 0`, `security_evidence_dropped_count: int = 0`.
- **No changes to the Synthesizer, Critic, or any specialist agent** — this is a pure post-processing gate.
- **Testing convention:** real small unified-diff fixture strings (no mocking needed — these are pure functions with zero external dependencies).

---

### Task 1: `grounding.py` — pure diff-parsing functions

**Files:**
- Create: `packages/agents/src/arete_agents/grounding.py`
- Create: `packages/agents/tests/test_grounding.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `valid_lines_for_patch(patch: str) -> set[int] | None`, `has_quoted_evidence(body: str, patch: str) -> bool`. Task 3 imports both directly.

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/tests/test_grounding.py`:

```python
from arete_agents.grounding import has_quoted_evidence, valid_lines_for_patch


def test_valid_lines_single_hunk_all_kinds():
    patch = (
        "@@ -1,3 +1,4 @@\n"
        " line1\n"
        "+line2\n"
        " line3\n"
        " line4\n"
    )
    assert valid_lines_for_patch(patch) == {1, 2, 3, 4}


def test_valid_lines_deleted_lines_not_counted():
    patch = (
        "@@ -1,4 +1,2 @@\n"
        " line1\n"
        "-line2\n"
        "-line3\n"
        " line4\n"
    )
    # new-file numbering: line1 -> 1, line4 -> 2 (deleted lines consume no
    # new-file line number and are never "valid" citation targets)
    assert valid_lines_for_patch(patch) == {1, 2}


def test_valid_lines_multiple_hunks():
    patch = (
        "@@ -1,2 +1,2 @@\n"
        " a\n"
        "+b\n"
        "@@ -10,2 +11,2 @@\n"
        " c\n"
        "+d\n"
    )
    # hunk 1: new-file lines 1 (a), 2 (b). hunk 2 starts at new-file line 11:
    # 11 (c), 12 (d).
    assert valid_lines_for_patch(patch) == {1, 2, 11, 12}


def test_valid_lines_pure_deletion_diff_returns_empty_set_not_none():
    patch = (
        "@@ -1,3 +1,0 @@\n"
        "-line1\n"
        "-line2\n"
        "-line3\n"
    )
    # Real hunk marker found, but nothing survives into the new file — this
    # is a parsed-but-empty result, distinct from "couldn't parse at all".
    assert valid_lines_for_patch(patch) == set()


def test_valid_lines_garbage_string_returns_none():
    assert valid_lines_for_patch("this is not a diff at all") is None


def test_valid_lines_empty_string_returns_none():
    assert valid_lines_for_patch("") is None


def test_has_quoted_evidence_finds_real_match():
    body = "This calls `dangerous_eval()` directly on user input."
    patch = "+result = dangerous_eval(user_input)\n"
    assert has_quoted_evidence(body, patch) is True


def test_has_quoted_evidence_false_when_quoted_span_not_in_patch():
    body = "This calls `made_up_function()` which doesn't exist here."
    patch = "+result = something_else(user_input)\n"
    assert has_quoted_evidence(body, patch) is False


def test_has_quoted_evidence_false_with_no_backticks_at_all():
    body = "This looks like a SQL injection risk in the query builder."
    patch = "+query = f'SELECT * FROM users WHERE id={user_id}'\n"
    assert has_quoted_evidence(body, patch) is False


def test_has_quoted_evidence_true_when_any_one_of_multiple_spans_matches():
    body = "Compare `real_symbol` against `fake_symbol` for context."
    patch = "+def real_symbol():\n+    pass\n"
    assert has_quoted_evidence(body, patch) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_grounding.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arete_agents.grounding'`

- [ ] **Step 3: Implement grounding.py**

Create `packages/agents/src/arete_agents/grounding.py`:

```python
import re

_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
_BACKTICK_SPAN = re.compile(r"`([^`]+)`")


def valid_lines_for_patch(patch: str) -> set[int] | None:
    """Parse a unified-diff patch (real GitHub API format) and return every
    line number that exists in the NEW version of the file — context lines
    and added lines within each hunk, numbered from that hunk's declared
    new-file starting line. Deleted lines consume no new-file line number.

    Returns None (not an empty set) when the patch has no parseable @@ hunk
    header at all — callers must treat that as "couldn't validate this
    file" and skip all grounding checks for it. Returns an empty set when
    hunks were found but none of them retain any line in the new file (e.g.
    a pure-deletion diff) — that IS a valid, meaningful result: any comment
    citing a line in that file is provably wrong.
    """
    if not patch or not patch.strip():
        return None

    lines = patch.split("\n")
    hunk_start_indices = [i for i, line in enumerate(lines) if _HUNK_HEADER.match(line)]
    if not hunk_start_indices:
        return None

    valid: set[int] = set()
    for idx in hunk_start_indices:
        match = _HUNK_HEADER.match(lines[idx])
        current_line = int(match.group(3))
        for line in lines[idx + 1:]:
            if _HUNK_HEADER.match(line):
                break
            if line.startswith("-"):
                continue
            if line.startswith("\\"):
                # e.g. "\ No newline at end of file" — not a real content line
                continue
            # "+added" or " context" (or a bare blank line inside a hunk
            # body) all represent a line that exists in the new file.
            valid.add(current_line)
            current_line += 1

    return valid


def has_quoted_evidence(body: str, patch: str) -> bool:
    """True if at least one backtick-quoted span in body appears verbatim
    as a substring of patch. False if body has no backtick spans at all,
    or none of them match."""
    spans = _BACKTICK_SPAN.findall(body)
    if not spans:
        return False
    return any(span in patch for span in spans)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_grounding.py -v`
Expected: PASS (10 passed)

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q`
Expected: all passing (baseline count + 10 new, 0 failed).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/grounding.py packages/agents/tests/test_grounding.py
git commit -m "feat(grounding): add deterministic diff-parsing for line-citation and evidence checks"
```

---

### Task 2: `ReviewResult` new fields

**Files:**
- Modify: `packages/agents/src/arete_agents/models/review.py`
- Modify: `packages/agents/tests/test_models.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ReviewResult.citation_dropped_count: int = 0`, `ReviewResult.security_evidence_dropped_count: int = 0`. Task 3 sets these fields.

- [ ] **Step 1: Write the failing test**

Add to `packages/agents/tests/test_models.py` (append at end of file):

```python
def test_review_result_grounding_counters_default_to_zero():
    from arete_agents.models.pr import PRContext
    from arete_agents.models.review import ReviewResult

    result = ReviewResult(
        pr_context=PRContext(repo="r/r", pr_number=1, title="t", description="d", files=[]),
        file_reviews=[],
        overall_summary="none",
        risk_level="low",
    )
    assert result.citation_dropped_count == 0
    assert result.security_evidence_dropped_count == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents && uv run pytest tests/test_models.py -k grounding_counters -v`
Expected: FAIL — `AttributeError: 'ReviewResult' object has no attribute 'citation_dropped_count'`

- [ ] **Step 3: Add the two fields**

In `packages/agents/src/arete_agents/models/review.py`, add two fields to `ReviewResult` right after the existing `critic_dropped_count` field:

```python
    # Number of already-synthesized-and-critiqued comments dropped by the
    # deterministic (non-LLM) grounding gate for citing a line number that
    # doesn't exist in the file's real diff. Distinct from dropped_count
    # (Synthesizer's own LLM self-check) and critic_dropped_count (the
    # independent cross-tier LLM critic) — this one is pure text parsing,
    # never an LLM judgment call.
    citation_dropped_count: int = 0
    # Number of security-category comments dropped specifically for lacking
    # any quoted code snippet that actually appears in the diff — a
    # stricter, security-only bar on top of the universal citation check
    # above.
    security_evidence_dropped_count: int = 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agents && uv run pytest tests/test_models.py -k grounding_counters -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q`
Expected: all passing (baseline + 1 new, 0 failed).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/models/review.py packages/agents/tests/test_models.py
git commit -m "feat(grounding): add citation_dropped_count and security_evidence_dropped_count to ReviewResult"
```

---

### Task 3: Wire `_apply_grounding` into the orchestrator

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Modify: `packages/agents/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `valid_lines_for_patch`, `has_quoted_evidence` from `arete_agents.grounding` (Task 1); `ReviewResult.citation_dropped_count`/`security_evidence_dropped_count` (Task 2).
- Produces: `ReviewOrchestrator._apply_grounding(pr: PRContext, result: ReviewResult) -> ReviewResult`. No change to `ReviewOrchestrator.run()`'s public signature or return type.

**IMPORTANT implementation note (a bug caught during planning, not in the original spec's literal wording):** Gate 2 (security evidence) must ONLY run for a file whose patch successfully parsed (`valid_lines_for_patch(...) is not None`). If Gate 2 ran independently of Gate 1's parse result, then every existing orchestrator test using this codebase's simple fake-patch fixtures (e.g. `conftest.py`'s `sample_pr`, whose patch is `"+SELECT * FROM users WHERE id='" + "+user_id"` — no `@@` header at all) would have its `category: "security"` comment silently dropped, since that fixture's `SEC` response body ("SQL injection.") has no backtick-quoted spans. That would break `test_orchestrator_merges_comments_from_all_agents` and any other existing test asserting a security comment survives the full `run()` pipeline. The implementation below skips BOTH gates together when the patch doesn't parse — do not implement it any other way.

- [ ] **Step 1: Write the failing tests**

Add to `packages/agents/tests/test_orchestrator.py` (uses `FileChange`/`PRContext`/`ReviewComment`/`FileReview`/`ReviewResult` already imported in that file; append near the existing `_apply_critic` tests):

```python
def _grounding_pr(patch: str):
    from arete_agents.models.pr import FileChange, PRContext

    return PRContext(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="",
        files=[FileChange(path="src/auth.py", patch=patch, additions=1, deletions=0)],
    )


def _grounding_result(comments: list[ReviewComment]) -> ReviewResult:
    return ReviewResult(
        pr_context=_grounding_pr(""),
        file_reviews=[FileReview(path="src/auth.py", comments=comments, summary="s")],
        overall_summary="s",
        risk_level="low",
    )


def test_apply_grounding_keeps_comment_citing_a_real_line(cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator

    patch = "@@ -1,2 +1,2 @@\n line1\n+line2\n"
    pr = _grounding_pr(patch)
    result = _grounding_result([
        ReviewComment(path="src/auth.py", line=2, body="ok", severity="info", category="quality"),
    ])

    orch = ReviewOrchestrator(llm=cyclic_llm)
    out = orch._apply_grounding(pr, result)

    assert len(out.file_reviews[0].comments) == 1
    assert out.citation_dropped_count == 0


def test_apply_grounding_drops_comment_citing_a_fabricated_line(cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator

    patch = "@@ -1,2 +1,2 @@\n line1\n+line2\n"
    pr = _grounding_pr(patch)
    result = _grounding_result([
        ReviewComment(path="src/auth.py", line=999, body="ok", severity="info", category="quality"),
    ])

    orch = ReviewOrchestrator(llm=cyclic_llm)
    out = orch._apply_grounding(pr, result)

    assert len(out.file_reviews[0].comments) == 0
    assert out.citation_dropped_count == 1


def test_apply_grounding_keeps_security_comment_with_real_quoted_evidence(cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator

    patch = "@@ -1,1 +1,1 @@\n+result = dangerous_eval(user_input)\n"
    pr = _grounding_pr(patch)
    result = _grounding_result([
        ReviewComment(
            path="src/auth.py", line=1,
            body="Calls `dangerous_eval(user_input)` on untrusted input.",
            severity="error", category="security",
        ),
    ])

    orch = ReviewOrchestrator(llm=cyclic_llm)
    out = orch._apply_grounding(pr, result)

    assert len(out.file_reviews[0].comments) == 1
    assert out.security_evidence_dropped_count == 0


def test_apply_grounding_drops_security_comment_without_quoted_evidence_on_parsed_patch(cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator

    patch = "@@ -1,1 +1,1 @@\n+result = something_safe(user_input)\n"
    pr = _grounding_pr(patch)
    result = _grounding_result([
        ReviewComment(
            path="src/auth.py", line=1,
            body="This looks like a SQL injection risk.",
            severity="error", category="security",
        ),
    ])

    orch = ReviewOrchestrator(llm=cyclic_llm)
    out = orch._apply_grounding(pr, result)

    assert len(out.file_reviews[0].comments) == 0
    assert out.security_evidence_dropped_count == 1


def test_apply_grounding_skips_all_gates_when_patch_unparseable(cyclic_llm):
    """Both gates must be skipped together when the patch can't be parsed —
    including for a security comment with no quoted evidence at all, which
    would otherwise be wrongly dropped by Gate 2 running independently of
    Gate 1's parse result. This is the exact regression this plan's Task 3
    note warns about."""
    from arete_agents.orchestrator import ReviewOrchestrator

    pr = _grounding_pr("not a real diff")
    result = _grounding_result([
        ReviewComment(path="src/auth.py", line=999, body="ok", severity="info", category="quality"),
        ReviewComment(
            path="src/auth.py", line=1, body="SQL injection.",
            severity="error", category="security",
        ),
    ])

    orch = ReviewOrchestrator(llm=cyclic_llm)
    out = orch._apply_grounding(pr, result)

    assert len(out.file_reviews[0].comments) == 2
    assert out.citation_dropped_count == 0
    assert out.security_evidence_dropped_count == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py -k apply_grounding -v`
Expected: FAIL — `AttributeError: 'ReviewOrchestrator' object has no attribute '_apply_grounding'`

- [ ] **Step 3: Implement _apply_grounding and wire it in**

In `packages/agents/src/arete_agents/orchestrator.py`, add this import alongside the existing imports at the top of the file:

```python
from arete_agents.grounding import has_quoted_evidence, valid_lines_for_patch
```

Add this new method right after the existing `_apply_critic` method (after its `return result` line):

```python
    def _apply_grounding(self, pr: PRContext, result: ReviewResult) -> ReviewResult:
        """Deterministic (non-LLM) final gate, run after the Critic stage.
        Every surviving comment's line number must exist in its file's real
        diff (any category); security comments must additionally quote real
        code from that diff. Both checks for a given file are skipped
        together when that file's patch can't be parsed at all (pass
        every comment through unfiltered) — a bug in this gate must never
        make a review worse than not having it, and Gate 2 must never run
        against a diff we don't trust ourselves to have parsed correctly.
        A security comment with no quoted evidence, on a patch that DID
        parse, is dropped outright — the one deliberate fail-closed
        exception to that rule."""
        patches_by_path = {f.path: f.patch for f in pr.files}

        citation_dropped = 0
        security_evidence_dropped = 0
        new_file_reviews = []

        for fr in result.file_reviews:
            patch = patches_by_path.get(fr.path)
            valid_lines = valid_lines_for_patch(patch) if patch is not None else None

            if valid_lines is None:
                new_file_reviews.append(fr)
                continue

            kept = []
            for c in fr.comments:
                if c.line not in valid_lines:
                    citation_dropped += 1
                    continue
                if c.category == "security" and not has_quoted_evidence(c.body, patch):
                    security_evidence_dropped += 1
                    continue
                kept.append(c)
            new_file_reviews.append(FileReview(path=fr.path, comments=kept, summary=fr.summary))

        result.file_reviews = new_file_reviews
        result.citation_dropped_count = citation_dropped
        result.security_evidence_dropped_count = security_evidence_dropped
        return result
```

Then change the existing line in `_synthesize_reviews` from:

```python
        final_result = self._apply_critic(pr, final_result)
```

to:

```python
        final_result = self._apply_critic(pr, final_result)
        final_result = self._apply_grounding(pr, final_result)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py -k apply_grounding -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q`
Expected: all passing (baseline + 6 new, 0 failed). Every existing orchestrator test's fixtures use simple fake patches like `conftest.py`'s `"+SELECT * FROM users WHERE id='" + "+user_id"` (no `@@` hunk header) — these hit the `valid_lines_for_patch(...) is None` branch, so both gates are skipped entirely and no existing test's comment-count assertions change, INCLUDING the ones whose security-category comment ("SQL injection.") has no backtick-quoted evidence.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/orchestrator.py packages/agents/tests/test_orchestrator.py
git commit -m "feat(grounding): wire _apply_grounding into the synthesis pipeline"
```
