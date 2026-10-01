#!/usr/bin/env python3
"""Generate docs/API_FLOW_REFERENCE.md mapping client endpoints through backend to third-party APIs."""
import ast, importlib.util, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
URLS_PY = BACKEND_DIR / "api" / "urls.py"
FRONTEND_DOC = ROOT / "docs" / "API_FRONTEND_REFERENCE.md"
ADMIN_DOC = ROOT / "docs" / "API_ADMIN_REFERENCE.md"
OUT_MD = ROOT / "docs" / "API_FLOW_REFERENCE.md"


def modpath(py_path: Path) -> str:
    rel = py_path.relative_to(BACKEND_DIR).with_suffix("")
    return str(rel).replace("\\", ".").replace("/", ".")


def unparse(node):
    try:
        return ast.unparse(node).strip()
    except Exception:
        return ast.dump(node, include_attributes=False)


def parse_imports(tree, current_module: str):
    """Return alias -> (module_path, object_name). object_name None for module aliases."""
    imports = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                name = alias.asname if alias.asname else alias.name
                imports[name] = (alias.name, None)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                # relative import: step up from current package
                parts = current_module.split(".")
                base_parts = parts[:-node.level] if node.level <= len(parts) else [""]
                base = ".".join(base_parts)
                prefix = f"{base}.{node.module}" if node.module and base else (node.module or base)
            else:
                # absolute import
                prefix = node.module or ""
            for alias in node.names:
                name = alias.asname if alias.asname else alias.name
                # Treat imported name as an object inside prefix module
                imports[name] = (prefix, alias.name)
    return imports


def resolve_chain(node, imports, current_module):
    """Resolve an ast.Attribute/Name call target to (module_path, func_name)."""
    if isinstance(node, ast.Name):
        if node.id in imports:
            return imports[node.id]
        return (current_module, node.id)
    if isinstance(node, ast.Attribute):
        if isinstance(node.value, ast.Name) and node.value.id in imports:
            mod, obj = imports[node.value.id]
            if obj is None:
                return (mod, node.attr)
            return (mod, node.attr)
        if isinstance(node.value, ast.Name) and node.value.id == 'self':
            return (current_module, node.attr)
        if isinstance(node.value, ast.Attribute):
            base_mod, base_obj = resolve_chain(node.value, imports, current_module)
            if base_obj is None:
                return (f"{base_mod}", node.attr)
            # If base was an object, the next attr is a method
            return (base_mod, node.attr)
        if isinstance(node.value, ast.Call):
            mod, obj = resolve_chain(node.value.func, imports, current_module)
            return (mod, node.attr)
    return (None, None)


def http_method_from_call(node, imports):
    """Detect if a Call is an external HTTP request and return (method, url_expr, payload_expr)."""
    if not isinstance(node, ast.Call):
        return None
    mod, func = resolve_chain(node.func, imports, "")
    if not mod:
        return None
    lib = mod.split(".")[0] if mod else ""
    if lib not in ("requests", "httpx"):
        return None
    method = func.upper() if func else "?"
    args = node.args
    kwargs = {kw.arg: kw.value for kw in node.keywords if kw.arg}
    url_expr = ""
    payload_expr = ""
    if func == "request" and args:
        # requests.request(method, url, ...)
        method_node = args[0]
        if isinstance(method_node, ast.Constant):
            method = str(method_node.value).upper()
        else:
            method = f"request({unparse(method_node)})"
        if len(args) > 1:
            url_expr = unparse(args[1])
    else:
        if args:
            url_expr = unparse(args[0])
    if "json" in kwargs:
        payload_expr = f"json={unparse(kwargs['json'])}"
    elif "data" in kwargs:
        payload_expr = f"data={unparse(kwargs['data'])}"
    elif "params" in kwargs:
        payload_expr = f"params={unparse(kwargs['params'])}"
    elif len(args) > 1:
        payload_expr = unparse(args[1])
    return {"method": method, "url": url_expr, "payload": payload_expr}


def scan_backend():
    """Scan backend Python files for external callers and call graph."""
    external = {}  # (module, func) -> [call dict]
    callees = {}   # (module, func) -> set of (module, func)
    views = {}     # path_without_slash -> (module, view_name)
    for py_path in BACKEND_DIR.rglob("*.py"):
        try:
            text = py_path.read_text(encoding="utf-8")
            tree = ast.parse(text)
        except Exception:
            continue
        current_module = modpath(py_path)
        imports = parse_imports(tree, current_module)

        # find top-level and class functions
        funcs = []
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                funcs.append(("", node))
            elif isinstance(node, ast.ClassDef):
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        funcs.append((node.name, item))

        for cls, func in funcs:
            bare_name = func.name
            class_prefixed = f"{cls}.{func.name}" if cls else func.name
            ext_calls = []
            child_calls = set()
            for child in ast.walk(func):
                if isinstance(child, ast.Call):
                    hc = http_method_from_call(child, imports)
                    if hc:
                        ext_calls.append(hc)
                        continue
                    mod2, fn2 = resolve_chain(child.func, imports, current_module)
                    if mod2 and mod2.startswith("api.") and fn2:
                        child_calls.add((mod2, fn2))
            # Store under both; aliases like service.create_payment hit the bare name
            for key in {(current_module, class_prefixed), (current_module, bare_name)}:
                if ext_calls:
                    external[key] = ext_calls
                if child_calls:
                    callees[key] = child_calls

    # Also parse urls.py for views
    if URLS_PY.exists():
        try:
            text = URLS_PY.read_text(encoding="utf-8")
            tree = ast.parse(text)
        except Exception:
            tree = None
        if tree:
            current_module = "api.urls"
            imports = parse_imports(tree, current_module)
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    mod, fn = resolve_chain(node.func, imports, current_module)
                    if fn == "path" and node.args:
                        route_node = node.args[0]
                        view_node = node.args[1] if len(node.args) > 1 else None
                        if isinstance(route_node, ast.Constant) and view_node is not None:
                            route = route_node.value.strip("/")
                            if isinstance(view_node, ast.Name) and view_node.id in imports:
                                mod2, fn2 = imports[view_node.id]
                                if fn2:
                                    views[route] = (mod2, fn2)
                            elif isinstance(view_node, ast.Attribute):
                                mod2, fn2 = resolve_chain(view_node, imports, current_module)
                                if mod2 and fn2:
                                    views[route] = (mod2, fn2)
        # Try simple regex fallback for path('route', view_name, name=...)
        if not views:
            for m in re.finditer(r"path\(\s*['\"]([^'\"]+)['\"]\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)", text):
                route = m.group(1).strip("/")
                view_name = m.group(2)
                # view modules import list is huge; skip fallback detail
    return external, callees, views


def transitive_calls(start_key, external, callees, seen=None):
    if seen is None:
        seen = set()
    if start_key in seen:
        return []
    seen.add(start_key)
    results = list(external.get(start_key, []))
    for child in callees.get(start_key, set()):
        results.extend(transitive_calls(child, external, callees, seen))
    return results


def parse_client_doc(path: Path, default_source: str):
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    entries = []
    blocks = re.split(r"(?m)^## ", text)
    for block in blocks[1:]:
        heading = block.split("\n", 1)[0].strip()
        body = block.split("\n", 1)[1] if "\n" in block else ""
        endpoint = ""
        method = ""
        payload = ""
        source = default_source
        # Admin heading contains METHOD `endpoint`
        admin_match = re.match(r"^(GET|POST|PUT|PATCH|DELETE)\s+`+([^`]+)`+", heading)
        if admin_match:
            method = admin_match.group(1)
            endpoint = admin_match.group(2)
            name = endpoint
        else:
            name = heading
        for line in body.splitlines():
            m = re.search(r"- \*\*Endpoint:\*\*\s*`?([^`]+)`?", line)
            if m:
                endpoint = m.group(1).strip()
            m = re.search(r"- \*\*Method:\*\*\s*(\w+)", line)
            if m:
                method = m.group(1).upper()
            m = re.search(r"- \*\*Payload:\*\*\s*(.*)", line)
            if m:
                payload = m.group(1).strip()
            m = re.search(r"- \*\*Source:\*\*\s*`?([^`]+)`?", line)
            if m:
                source = m.group(1).strip()
        if not endpoint:
            continue
        entries.append({"name": name, "method": method or "GET", "endpoint": endpoint, "payload": payload, "source": source})
    return entries


def build_markdown(client_entries, views, external, callees):
    # Reverse map: backend view -> list of url routes
    view_to_routes = {}
    for route, view in views.items():
        view_to_routes.setdefault(view, []).append(route)

    # Map client endpoint path -> list of client entries
    path_to_clients = {}
    for e in client_entries:
        bare_path = e["endpoint"].split("?")[0].strip("/")
        path_to_clients.setdefault(bare_path, []).append(e)

    shown = 0
    lines = [
        "# FlipStar External API Flow Reference",
        "",
        "Lists only client-to-backend flows that trigger outside (Telebirr/Onevas/CRM/B2C/etc.) API calls.",
        "",
    ]
    for view, routes in sorted(view_to_routes.items(), key=lambda kv: kv[0]):
        view_key = view
        third = transitive_calls(view_key, external, callees)
        if not third:
            continue
        for route in sorted(routes):
            lines.append(f"## `/{route}/`")
            lines.append(f"- **Backend view:** `{view[0]}.{view[1]}`")
            clients = path_to_clients.get(route, [])
            if clients:
                for c in clients:
                    lines.append(f"- **Client call:** `{c['method']}` `{c['endpoint']}` from `{c['source']}`")
                    if c['payload']:
                        lines.append(f"  - **Payload:** {c['payload']}")
            else:
                lines.append("- **Client call:** not found in generated client docs")
            lines.append("- **Third-party calls:**")
            for call in third:
                lines.append(f"  - `{call['method']} {call['url']}`  payload: {call['payload'] or '(none)'}")
            lines.append("")
            shown += 1
    return "\n".join(lines), shown


def main():
    external, callees, views = scan_backend()

    # Load the admin doc scanner to parse api.* calls from actual source files
    admin_scanner_path = ROOT / "scripts" / "generate_admin_api_doc.py"
    spec = importlib.util.spec_from_file_location("admin_scanner", str(admin_scanner_path))
    admin_scanner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(admin_scanner)

    client_entries = []
    for ext in ("*.js", "*.jsx"):
        for path in (ROOT / "frontend").rglob(ext):
            if "dist" in path.parts or "node_modules" in path.parts:
                continue
            for e in admin_scanner.scan_file(path):
                client_entries.append({
                    "name": e["endpoint"],
                    "method": e["method"],
                    "endpoint": e["endpoint"],
                    "payload": e["body"],
                    "source": e["source"],
                })

    markdown, shown = build_markdown(client_entries, views, external, callees)
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text(markdown, encoding="utf-8")
    print(f"Wrote {OUT_MD} with {shown} external-facing flows")


if __name__ == "__main__":
    main()
