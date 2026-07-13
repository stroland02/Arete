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

    # splitlines() (not split("\n")) so a trailing newline does not produce a
    # phantom empty final element that would be miscounted as a content line.
    # Genuine blank lines *inside* a hunk body are preserved.
    lines = patch.splitlines()
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
    as a substring of patch. A span written as a call with empty parens
    (e.g. `dangerous_eval()`) also matches when the bare callable name
    appears in the patch (e.g. ``dangerous_eval(user_input)``). False if
    body has no backtick spans at all, or none of them match."""
    spans = _BACKTICK_SPAN.findall(body)
    if not spans:
        return False
    for span in spans:
        if span in patch:
            return True
        if span.endswith("()") and span[:-2] and span[:-2] in patch:
            return True
    return False
