#!/usr/bin/env python3
"""Generate docs/API_ADMIN_REFERENCE.md from frontend/admin api.* calls."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADMIN_DIR = ROOT / "frontend" / "admin"
OUT_MD = ROOT / "docs" / "API_ADMIN_REFERENCE.md"


def find_matching_paren(text: str, start: int) -> int:
    """Return the index of the closing ) for the ( at text[start]."""
    depth = 0
    in_string = False
    string_char = None
    i = start
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == string_char and text[i - 1] != "\\":
                in_string = False
                string_char = None
            i += 1
            continue
        if ch in "'\"`":
            in_string = True
            string_char = ch
            i += 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def split_args(inside: str) -> list:
    """Split a call's argument list on top-level commas."""
    args = []
    depth = 0
    in_string = False
    string_char = None
    start = 0
    for i, ch in enumerate(inside):
        if in_string:
            if ch == string_char and inside[i - 1] != "\\":
                in_string = False
                string_char = None
            continue
        if ch in "'\"`":
            in_string = True
            string_char = ch
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            args.append(inside[start:i])
            start = i + 1
    tail = inside[start:]
    if tail.strip():
        args.append(tail)
    return [a.strip() for a in args if a.strip()]


def extract_json_stringify_arg(chunk: str, offset: int = 0) -> str:
    """Extract the inner argument of JSON.stringify(...) starting around offset."""
    m = re.search(r"JSON\.stringify\s*\(", chunk[offset:])
    if not m:
        return ""
    start = offset + m.end() - 1  # index of the opening (
    end = find_matching_paren(chunk, start)
    if end == -1:
        return ""
    return chunk[start + 1 : end].strip()


def extract_option_value(options: str, key: str) -> str:
    """Return the raw value for key: ... in an options object."""
    # Find key: at top level (not inside strings or nested objects)
    pattern = re.compile(rf"\b{re.escape(key)}\s*:")
    m = pattern.search(options)
    if not m:
        return ""
    i = m.end()
    depth = 0
    in_string = False
    string_char = None
    start = i
    while i < len(options):
        ch = options[i]
        if in_string:
            if ch == string_char and options[i - 1] != "\\":
                in_string = False
                string_char = None
            i += 1
            continue
        if ch in "'\"`":
            in_string = True
            string_char = ch
            i += 1
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            return options[start:i].strip()
        i += 1
    return options[start:].strip()


def format_body(body_expr: str) -> str:
    """Return a readable payload description."""
    body_expr = body_expr.strip()
    if not body_expr:
        return "(none)"
    if re.match(r"JSON\.stringify\s*\(", body_expr):
        inner = extract_json_stringify_arg(body_expr)
        if inner:
            return f"JSON.stringify({inner})"
    return body_expr


def parse_call(chunk: str, call_type: str) -> dict:
    """Parse a single api.<call_type>(...) call chunk."""
    inside_match = re.match(rf"api\.{call_type}\s*\(", chunk)
    if not inside_match:
        return None
    start = inside_match.end() - 1
    end = find_matching_paren(chunk, start)
    if end == -1:
        return None
    args_str = chunk[start + 1 : end]
    args = split_args(args_str)
    if not args:
        return None

    endpoint = args[0]
    # Strip surrounding quotes if plain string
    if (endpoint.startswith("'") and endpoint.endswith("'")) or (
        endpoint.startswith('"') and endpoint.endswith('"')
    ):
        endpoint = endpoint[1:-1]

    method = call_type.upper() if call_type != "request" else "GET"
    body_expr = ""

    if call_type == "request" and len(args) > 1:
        options = args[1]
        m = re.search(r"method\s*:\s*['\"]([A-Z]+)['\"]", options)
        if m:
            method = m.group(1)
        body_expr = extract_option_value(options, "body")
    elif call_type in ("post", "patch", "put") and len(args) > 1:
        body_expr = args[1]

    return {
        "endpoint": endpoint,
        "method": method,
        "body": format_body(body_expr),
    }


def scan_file(path: Path) -> list:
    """Return all parsed api.* calls in a file."""
    text = path.read_text(encoding="utf-8")
    entries = []
    # Match api.request( api.get( api.post( api.patch( api.put( api.delete(
    for match in re.finditer(r"api\.(request|get|post|patch|put|delete)\s*\(", text):
        end = find_matching_paren(text, match.end() - 1)
        if end == -1:
            continue
        call_type = match.group(1)
        call_chunk = text[match.start() : end + 1]
        parsed = parse_call(call_chunk, call_type)
        if not parsed:
            continue
        parsed["source"] = path.relative_to(ROOT).as_posix()
        entries.append(parsed)
    return entries


def build_markdown(entries: list) -> str:
    lines = [
        "# FlipStar Admin API Reference",
        "",
        "Auto-generated from `frontend/admin/` JSX/JS files. Lists the admin panel's backend calls.",
        "",
        "Base URL: `config.API_BASE_URL`",
        "",
    ]
    # Deduplicate by endpoint + method + body
    seen = set()
    for e in entries:
        key = (e["method"], e["endpoint"], e["body"], e["source"])
        if key in seen:
            continue
        seen.add(key)
        lines.append(f"## {e['method']} `{e['endpoint']}`")
        lines.append(f"- **Source:** `{e['source']}`")
        lines.append(f"- **Payload:** {e['body']}")
        lines.append("")
    return "\n".join(lines)


def main():
    entries = []
    for ext in ("*.js", "*.jsx"):
        for path in ADMIN_DIR.rglob(ext):
            entries.extend(scan_file(path))

    # Stable order by endpoint then method
    entries.sort(key=lambda e: (e["endpoint"], e["method"], e["source"]))

    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text(build_markdown(entries), encoding="utf-8")
    print(f"Wrote {OUT_MD} with {len(entries)} admin calls")


if __name__ == "__main__":
    main()
