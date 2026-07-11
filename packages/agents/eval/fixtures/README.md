# Golden Eval Fixtures

Each `*.json` file here is one `EvalFixture` (see `arete_agents.eval.models`): a small
PR (`pr`) plus zero or more `planted_defects`, or a `clean: true` fixture that must draw
no findings.

## Line-number convention

A planted defect's `line` is the **new-file line number** of the defective added line —
the number it has in the post-change file, inferred from the unified-diff hunk header
`@@ -a,b +c,d @@` by counting added and context lines starting at `c`. This matches what
a review agent infers from the diff and what GitHub reports on a PR.

The matcher (`arete_agents.eval.matcher`) accepts a comment whose reported line is within
`DEFAULT_WINDOW` (±3) of the planted `line`, on the same `path`, with `category` equal to
the defect's `target_agent`. Keep planted `line` values pointing at the actual changed
line so localization stays valid if the window is ever tightened.

## Fixture set

12 defective fixtures (2 per agent: security, performance, quality, test_coverage,
deployment_safety, business_logic) plus 3 clean fixtures (`clean-*.json`). Clean fixtures
carry genuinely defect-free diffs — including companion test files where a new public
function would otherwise invite a legitimate test-coverage comment.
