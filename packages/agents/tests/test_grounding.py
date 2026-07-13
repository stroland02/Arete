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


def test_has_quoted_evidence_rejects_short_generic_name_via_empty_parens():
    """A short/generic bare name (from `x()`-style stripping) must not
    trivially match unrelated diff text via raw substring containment —
    the whole point of this gate is to prevent exactly that kind of
    trivially-satisfied 'evidence'."""
    body = "This calls `x()` somewhere dangerous."
    patch = "+def existing_function():\n+    return context.get('x_value')\n"
    # "x" is a substring of "context" and "x_value", but this must NOT
    # count as real evidence for a one-character stripped name.
    assert has_quoted_evidence(body, patch) is False


def test_has_quoted_evidence_rejects_partial_word_match_for_stripped_name():
    """A stripped name must match a real whole word in the patch, not just
    appear as a substring inside a longer, unrelated identifier."""
    body = "This calls `eval()` on user input."
    patch = "+result = my_evaluator(user_input)\n"
    # "eval" is a substring of "my_evaluator", but they are not the same
    # symbol — must not count as evidence.
    assert has_quoted_evidence(body, patch) is False


def test_has_quoted_evidence_accepts_real_whole_word_match_for_stripped_name():
    """A sufficiently long stripped name matching a real whole word in the
    patch still counts as evidence (this is the legitimate case the
    empty-parens normalization exists for)."""
    body = "This calls `dangerous_eval()` on user input."
    patch = "+result = dangerous_eval(user_input)\n"
    assert has_quoted_evidence(body, patch) is True
