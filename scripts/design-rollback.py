#!/usr/bin/env python3
"""Restore only recorded design files; refuse to overwrite subsequent edits."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Restore after full preflight; default is check only')
    parser.add_argument('--reapply', action='store_true', help='Restore recorded design version instead of baseline')
    parser.add_argument('--group', help='Restore only one recorded change group')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / 'docs/design-ux/rollback-manifest.json').read_text())
    groups = sorted({entry['group'] for entry in manifest['files']})
    if args.group and args.group not in groups:
        parser.error(f'Unknown group; choose from: {", ".join(groups)}')
    pending = []
    for entry in manifest['files']:
        if args.group and entry['group'] != args.group:
            continue
        relative = Path(entry['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise SystemExit('Unsafe path in manifest')
        path = root / relative
        if path.is_symlink():
            raise SystemExit(f'Refusing symlink: {relative}')
        current = path.read_bytes() if path.exists() else None
        if digest(current) not in [entry['before'], entry['after']]:
            raise SystemExit(f'Subsequent edits detected; no files changed: {relative}')
        revision = manifest['design_commit'] if args.reapply else manifest['baseline_commit']
        expected = entry['after'] if args.reapply else entry['before']
        target = subprocess.check_output(['git', 'show', f'{revision}:{relative}'], cwd=root) if expected else None
        if digest(target) != expected:
            raise SystemExit(f'Snapshot hash mismatch: {relative}')
        if current != target:
            pending.append((path, relative, current, target))
    print(f'Preflight passed: {len(pending)} files to change')
    if not args.apply or not pending:
        return
    backup = Path(tempfile.mkdtemp(prefix='d-flow-design-rollback-'))
    for _, relative, current, _ in pending:
        if current is not None:
            saved = backup / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_bytes(current)
    for path, _, _, target in pending:
        if target is None:
            path.unlink(missing_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(target)
    print(f'Completed. Previous files saved at: {backup}')


if __name__ == '__main__':
    main()
