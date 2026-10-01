#!/usr/bin/env python3
"""Fix relative import paths for the reorganized frontend.

After moving components/pages/admin into subfolders, imports may point to the
wrong directory. This script resolves each `../` import to an existing file
under the same application tree (admin or frontend root) and rewrites the
relative path accordingly.
"""
import os
import re
import sys

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')

IMPORT_RE = re.compile(
    r"(import\s+(?:.*?\s+from\s+|from\s+)?['\"])"
    r"(\.\./[^'\"]+)"
    r"(['\"])",
    re.DOTALL,
)


def all_source_files(root_dir):
    for dirpath, _dirnames, filenames in os.walk(root_dir):
        for fn in filenames:
            if fn.endswith(('.jsx', '.js')):
                yield os.path.join(dirpath, fn)


def try_resolve(import_path, current_dir):
    """Check whether the import already resolves to an existing file."""
    candidate = os.path.normpath(os.path.join(current_dir, import_path))
    for suffix in ('', '.jsx', '.js', '/index.jsx', '/index.js'):
        if os.path.isfile(candidate + suffix):
            return candidate
    return None


def is_inside_admin(filepath):
    return filepath.startswith(os.path.join(FRONTEND_DIR, 'admin') + os.sep)


def find_file_by_basename(basename, prefer_admin=False):
    """Search the entire frontend tree for a file matching the import basename."""
    # Normalize basename to filename (strip .jsx/.js if present)
    root = os.path.splitext(basename)[0]
    found = []

    for dirpath, _dirnames, filenames in os.walk(FRONTEND_DIR):
        # Avoid node_modules
        if 'node_modules' in dirpath.split(os.sep):
            continue
        for fn in filenames:
            if not fn.endswith(('.jsx', '.js')):
                continue
            name = os.path.splitext(fn)[0]
            if name == root:
                found.append(dirpath)

    if not found:
        return None

    if prefer_admin:
        admin_found = [p for p in found if p.startswith(os.path.join(FRONTEND_DIR, 'admin'))]
        if admin_found:
            # Prefer the shallowest one
            return min(admin_found, key=lambda p: p.count(os.sep))

    # Default: prefer the shallowest match, with frontend root files prioritized
    return min(found, key=lambda p: (p.count(os.sep), p))


def search_for_target(import_path, current_dir, prefer_admin=False):
    """Find the target directory for an unresolved import."""
    rel = import_path.lstrip('./')
    rel_dir = os.path.dirname(rel)
    basename = os.path.basename(rel) if rel else ''

    # First try exact relative under frontend root (e.g. api, config, contexts)
    candidate = os.path.join(FRONTEND_DIR, rel)
    for suffix in ('', '.jsx', '.js', '/index.jsx', '/index.js'):
        if os.path.isfile(candidate + suffix):
            return os.path.dirname(candidate) if candidate.endswith(('.jsx', '.js')) else candidate

    # Try inside admin root if current file is admin
    if prefer_admin:
        admin_dir = os.path.join(FRONTEND_DIR, 'admin')
        candidate = os.path.join(admin_dir, rel)
        for suffix in ('', '.jsx', '.js', '/index.jsx', '/index.js'):
            if os.path.isfile(candidate + suffix):
                return os.path.dirname(candidate) if candidate.endswith(('.jsx', '.js')) else candidate

    # Search by basename under the correct tree
    target_dir = find_file_by_basename(basename, prefer_admin=prefer_admin)
    return target_dir


def compute_relative(current_dir, target_file_or_dir):
    current_dir = os.path.abspath(current_dir)
    target = os.path.abspath(target_file_or_dir)
    rel = os.path.relpath(target, current_dir).replace(os.sep, '/')
    if not rel.startswith('.'):
        rel = './' + rel
    return rel


def fix_file(filepath):
    current_dir = os.path.dirname(filepath)
    prefer_admin = is_inside_admin(filepath)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    changes = 0

    def repl(match):
        nonlocal changes
        prefix = match.group(1)
        import_path = match.group(2)
        suffix = match.group(3)

        if not import_path.startswith('../'):
            return match.group(0)

        if try_resolve(import_path, current_dir):
            return match.group(0)

        target_dir = search_for_target(import_path, current_dir, prefer_admin=prefer_admin)
        if target_dir:
            rel = import_path.lstrip('./')
            basename = os.path.splitext(os.path.basename(rel))[0]
            # Keep import pointing to the directory if the file is index.*
            # Otherwise point to the file without extension
            target_file = os.path.join(target_dir, basename + '.jsx')
            if os.path.isfile(target_file):
                new_path = compute_relative(current_dir, target_dir) + '/' + basename
            else:
                target_file_js = os.path.join(target_dir, basename + '.js')
                if os.path.isfile(target_file_js):
                    new_path = compute_relative(current_dir, target_dir) + '/' + basename
                else:
                    new_path = compute_relative(current_dir, target_dir)
            changes += 1
            return f"{prefix}{new_path}{suffix}"

        return match.group(0)

    new_content = IMPORT_RE.sub(repl, content)
    if changes:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Fixed {changes} import(s) in {os.path.relpath(filepath, FRONTEND_DIR)}")
    return changes


def main():
    total = 0
    for fp in all_source_files(FRONTEND_DIR):
        # Only fix files inside components, pages, or admin
        rel = os.path.relpath(fp, FRONTEND_DIR)
        if not rel.startswith(('components', 'pages', 'admin')):
            continue
        total += fix_file(fp)
    if total:
        print(f"\nTotal fixed: {total} import(s)")
    else:
        print("No broken imports found.")


if __name__ == '__main__':
    main()
