#!/usr/bin/env python3
"""Generate docs/API_FRONTEND_REFERENCE.md from frontend/api.js."""
import re
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_JS = ROOT / "frontend" / "api.js"
OUT_MD = ROOT / "docs" / "API_FRONTEND_REFERENCE.md"


def find_matching_paren(text: str, start: int) -> int:
    """Find the index of the matching ) for ( at text[start]."""
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


def find_matching_brace(text: str, start: int) -> int:
    """Find the index of the matching } for { at text[start]."""
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
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def extract_json_stringify_payload(chunk: str) -> str:
    """Extract the argument passed to JSON.stringify(...) in a chunk."""
    m = re.search(r"JSON\.stringify\s*\(", chunk)
    if not m:
        return ""
    start = m.end() - 1  # index of the opening ( of stringify
    end = find_matching_paren(chunk, start)
    if end == -1:
        return ""
    return chunk[start + 1 : end].strip()


def extract_endpoint(chunk: str) -> str:
    m = re.search(r"api\.request\s*\(\s*['\"]([^'\"]+)['\"]", chunk)
    if m:
        return m.group(1)
    m = re.search(r"fetch\s*\(\s*`?\$\{API_BASE_URL\}`?\s*\+\s*['\"]([^'\"]+)['\"]", chunk)
    if m:
        return m.group(1)
    m = re.search(r"xhr\.open\s*\(\s*['\"][A-Z]+['\"]\s*,\s*`?\$\{API_BASE_URL\}`?\s*\+\s*['\"]([^'\"]+)['\"]", chunk)
    if m:
        return m.group(1)
    return ""


def extract_method(chunk: str) -> str:
    m = re.search(r"method:\s*['\"]([A-Z]+)['\"]", chunk)
    if m:
        return m.group(1)
    # fetch defaults to POST; check fetch call pattern
    if re.search(r"fetch\s*\(", chunk):
        return "POST"
    return "GET"


def extract_body_desc(chunk: str) -> str:
    """Return a human-readable body description."""
    if "body: formData" in chunk or "body: new FormData" in chunk or "formData" in chunk:
        return "FormData (multipart)"
    if re.search(r"body:\s*JSON\.stringify\s*\(\s*\w+\s*\)", chunk):
        m = re.search(r"body:\s*JSON\.stringify\s*\(\s*(\w+)\s*\)", chunk)
        return f"`{m.group(1)}` object"
    payload = extract_json_stringify_payload(chunk)
    if payload:
        return f"JSON.stringify({payload})"
    if "body:" in chunk:
        # plain variable
        m = re.search(r"body:\s*([^,\n]+)", chunk)
        if m:
            return m.group(1).strip()
    return "(none)"


def extract_return_promise(chunk: str) -> str:
    # If the chunk has .then(r => ...), note cache invalidation
    invs = re.findall(r"invalidateCache\(['\"]([^'\"]+)['\"]\)", chunk)
    return invs


def build_markdown(entries):
    lines = [
        "# FlipStar Frontend API Reference",
        "",
        "Auto-generated from `frontend/api.js`. Lists the endpoints the web/mobile app calls.",
        "",
        "Base URL: `config.API_BASE_URL`",
        "",
    ]
    for e in entries:
        lines.append(f"## {e['name']}")
        lines.append(f"- **Endpoint:** `{e['endpoint']}`")
        lines.append(f"- **Method:** {e['method']}")
        if e.get("params"):
            lines.append(f"- **Frontend params:** `{e['params']}`")
        lines.append(f"- **Payload:** {e['body']}")
        if e.get("invalidates"):
            lines.append(f"- **Cache invalidation:** {', '.join(e['invalidates'])}")
        lines.append("")
    return "\n".join(lines)


def main():
    text = API_JS.read_text(encoding="utf-8")
    # Split on property definitions at the start of a line: two spaces + name + colon
    parts = re.split(r"(?m)^  (\w+):\s*", text)
    # parts[0] is boilerplate; then pairs of (name, chunk)
    entries = []
    for i in range(1, len(parts), 2):
        name = parts[i]
        chunk = parts[i + 1]
        # Skip generic utility methods that are not concrete API calls
        if name in ("request", "get", "post", "patch", "delete", "setAuthToken",
                    "setAdminToken", "getToken", "hasToken", "clearAuth",
                    "clearToken", "invalidateCache"):
            continue
        params_match = re.match(r"\((.*?)\)\s*(?:=>)?", chunk, re.DOTALL)
        params = params_match.group(1).strip() if params_match else ""
        endpoint = extract_endpoint(chunk)
        if not endpoint:
            continue
        method = extract_method(chunk)
        body = extract_body_desc(chunk)
        invalidates = extract_return_promise(chunk)
        entries.append({
            "name": name,
            "params": params,
            "endpoint": endpoint,
            "method": method,
            "body": body,
            "invalidates": invalidates,
        })

    os.makedirs(OUT_MD.parent, exist_ok=True)
    OUT_MD.write_text(build_markdown(entries), encoding="utf-8")
    print(f"Wrote {OUT_MD} with {len(entries)} endpoints")


if __name__ == "__main__":
    main()
