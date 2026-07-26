# Grounding & Verification Hardening (SP2) — Design Spec

**Date:** 2026-07-13
**Branch:** `main` (docs lane; implementation will branch off this spec)
**Package lane touched:** `packages/agents` only
**Master plan:** SP2 of the Kuma competitor-research master plan (see memory `project-arete-context-mapping-cmp`). SP1 (agentic evidence-gathering) is already shipped on `main`.

## Goal

Add two deterministic (non-LLM) verification gates to the review pipeline, run after the existing Synthesizer and independent Critic stages:

1. **Line-citation validation** — every surviving comment's line number must actually exist in the file's real diff. No exceptions, any category.
2. **Evidence-gated security findings** — security comments specifically must additionally quote real code from the diff, not just assert a claim.

Both gates are pure text-parsing, no API calls, no LLM judgment — a hard backstop under the existing LLM-based verification (Synthesizer's self-check, the Critic's cross-tier check), which can never be 100% reliable at catching a hallucinated line number the way a deterministic parser can.

## Why this is additive, not a rework

The pipeline already has two verification layers: the Synthesizer's own same-model self-check (`dropped_count`) and the independent cross-tier Critic (`critic_dropped_count`). Both are LLM-based and can miss things an LLM misjudges as "grounded." This spec adds a third, final layer that isn't LLM-based at all, following the exact same additive-gate pattern already established by `ReviewOrchestrator._apply_critic` — one more method, called at the end of `_synthesize_reviews`, no changes to the Synthesizer, Critic, or any specialist agent.

## Architecture

```
arete_agents/grounding.py (new)
  valid_lines_for_patch(patch: str) -> set[int]
    Parses @@ -a,b +c,d @@ unified-diff hunk headers (real GitHub API
    patch format, e.g. via packages/webhook/src/pr-fetcher.ts's f.patch)
    and returns every line number that exists in the NEW version of the
    file — i.e. context lines (leading space) and added lines (leading +)
    within each hunk, numbered from each hunk's +c starting line.
    Returns an empty set (not an exception) for an unparseable/empty patch
    — callers treat an empty set specially (see Error Handling).

  has_quoted_evidence(body: str, patch: str) -> bool
    Extracts backtick-quoted spans from body (`` `like_this` ``, the
    existing convention these agents already use for identifiers/snippets)
    and returns True if at least one such span appears verbatim as a
    substring anywhere in patch. Returns False if body has no backtick
    spans at all.

orchestrator.py — ReviewOrchestrator._apply_grounding(pr, result) -> ReviewResult
  For each surviving comment:
    - Look up its file's patch by path (from pr.files).
    - If the patch is unparseable (valid_lines_for_patch returns an empty
      set AND the patch string itself is non-empty — see Error Handling
      for how this is distinguished from a genuinely empty/tiny diff),
      skip Gate 1 for this comment (pass through) rather than drop it.
    - Otherwise, drop the comment if comment.line not in valid_lines.
    - If comment.category == "security" and it survived Gate 1, additionally
      drop it if not has_quoted_evidence(comment.body, patch).
  Tracks citation_dropped_count (Gate 1) and security_evidence_dropped_count
  (Gate 2) separately, mirroring dropped_count/critic_dropped_count's
  existing precedent of separately-attributed, testable drop counts.

_synthesize_reviews gains one line after the existing
  final_result = self._apply_critic(pr, final_result)
  final_result = self._apply_grounding(pr, final_result)
```

## Data Model Changes

Two new fields on `ReviewResult` (`models/review.py`), following the exact style of the two existing drop counters:

```python
citation_dropped_count: int = 0
security_evidence_dropped_count: int = 0
```

## Error Handling

- **Unparseable/empty patch:** a file whose patch can't be parsed into any hunks must not cause its comments to be dropped — that would make the review *worse* than not having this feature at all, breaking the same fail-open philosophy already established for Context-Mapping and the Critic. Distinguishing "genuinely no valid lines" (patch parses cleanly but happens to be a pure-deletion diff with no added/context lines — comments SHOULD be dropped here, they're citing a diff with no surviving content) from "patch didn't parse at all" (skip validation) is done structurally: `valid_lines_for_patch` returns `None` (not an empty set) when it can't find any `@@ ... @@` hunk markers at all in a non-empty patch string; an empty set (not `None`) means it parsed real hunks that happen to contain zero context/added lines. `_apply_grounding` skips Gate 1 only on `None`.
- **Security comment with no quoted evidence:** dropped outright (fail-closed). This is the one deliberate exception to the "never make things worse" rule — holding security specifically to a stricter bar is the point of this gate, not a bug.
- **A comment whose `path` doesn't match any file in `pr.files`:** treated the same as an unparseable patch (skip Gate 1, pass through) — this shouldn't happen given the existing pipeline's structure, but the gate must not crash the whole review over a data-shape surprise it didn't cause.

## Testing

Matches the existing convention in this codebase — real, small unified-diff fixture strings (no mocking needed, since these are pure functions with no external dependencies):
- `tests/test_grounding.py` — `valid_lines_for_patch` against real small diffs: single hunk, multiple hunks, pure-deletion diff (empty set, not None), garbage/non-diff string (None), empty string (None). `has_quoted_evidence` against bodies with a real quoted match, a quoted-but-wrong span, no backticks at all, multiple spans where only one matches.
- `tests/test_orchestrator.py` — additions covering `_apply_grounding`: a comment citing a real line survives; a comment citing a fabricated line number is dropped and counted; a security comment with a real quoted snippet survives; a security comment with an invented snippet is dropped and counted separately; an unparseable patch doesn't drop anything.
- No real LLM/API calls needed anywhere in this sub-project's tests — same as every existing test in `packages/agents`.

## Out of Scope

- Tool-use provenance gating for security findings (requiring an actual SP1 context-map tool call before a security finding counts as evidenced) — deferred; the quoted-content check is the chosen bar for this round.
- Any change to the Synthesizer's or Critic's own prompts/logic.
- Extending citation/evidence gating to non-security categories beyond the universal line-citation check (e.g. requiring quoted evidence for Business Logic or Deployment Safety findings too) — no evidence yet that's needed; security was singled out because a false-positive security claim is the most costly kind of noise.
