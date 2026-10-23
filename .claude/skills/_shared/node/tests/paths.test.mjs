import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toPosix, repoRootFrom, findUp, walkSorted, expandHome } from '../paths.mjs';
import { findPython, runCommand, makeTempDir } from '../proc.mjs';

const tmp = makeTempDir('dmes-paths-test-');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function touch(rel) {
  const f = path.join(tmp, 'tree', rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '');
}
for (const rel of ['a/b.md', 'a-c.md', 'a.md', 'B.md', 'Z/z.txt', 'a/sub/d.md', '가.md', 'node_modules/x/y.md', 'e.TXT', 'a/B/c.md', 'a/a.md']) touch(rel);
const root = path.join(tmp, 'tree');
const rels = (arr) => arr.map((p) => toPosix(path.relative(root, p)));

// 성분별 코드포인트 순: 'a' 폴더 내용이 'a-c.md' 보다 앞이고, '-'(0x2d) < '.'(0x2e) 이므로 a-c.md < a.md
const EXPECTED_PATH = ['B.md', 'Z/z.txt', 'a/B/c.md', 'a/a.md', 'a/b.md', 'a/sub/d.md', 'a-c.md', 'a.md', 'e.TXT', 'node_modules/x/y.md', '가.md'];
const EXPECTED_STRING = ['B.md', 'Z/z.txt', 'a-c.md', 'a.md', 'a/B/c.md', 'a/a.md', 'a/b.md', 'a/sub/d.md', 'e.TXT', 'node_modules/x/y.md', '가.md'];

test('walkSorted: 성분별 코드포인트 순(기본)과 문자열 순', () => {
  assert.deepEqual(rels(walkSorted(root)), EXPECTED_PATH);
  assert.deepEqual(rels(walkSorted(root, { order: 'string' })), EXPECTED_STRING);
});

test('walkSorted: 호출마다 같은 순서(안정), skipDirs·extensions·includeDirs', () => {
  const a = walkSorted(root);
  const b = walkSorted(root);
  assert.deepEqual(a, b);
  assert.ok(a.every((p) => p.startsWith(root)));
  assert.deepEqual(rels(walkSorted(root, { skipDirs: ['node_modules', 'sub'], extensions: ['.md'] })),
    ['B.md', 'a/B/c.md', 'a/a.md', 'a/b.md', 'a-c.md', 'a.md', '가.md']);
  assert.deepEqual(rels(walkSorted(root, { extensions: ['.txt'] })), ['Z/z.txt']); // 대소문자 구분
  assert.ok(rels(walkSorted(root, { includeDirs: true, skipDirs: (n) => n === 'node_modules' })).includes('a/sub'));
});

test('walkSorted: 심볼릭 링크 폴더는 기본적으로 따라가지 않는다', (t) => {
  const link = path.join(root, 'link-to-a');
  try { fs.symlinkSync(path.join(root, 'a'), link, 'dir'); } catch { return t.skip('심볼릭 링크 생성 불가'); }
  assert.ok(!rels(walkSorted(root)).some((p) => p.startsWith('link-to-a')));
  assert.ok(rels(walkSorted(root, { followSymlinks: true })).includes('link-to-a/b.md'));
  fs.rmSync(link);
});

test('walkSorted: python sorted(Path.rglob) 와 같다(python 있을 때)', (t) => {
  const py = findPython();
  if (!py) return t.skip('python3 없음');
  const script = 'import sys, json, pathlib\nr = pathlib.Path(sys.argv[1])\nprint(json.dumps([p.relative_to(r).as_posix() for p in sorted(r.rglob("*")) if p.is_file()]))';
  const r = runCommand(py, ['-c', script, root], { env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(rels(walkSorted(root)), JSON.parse(r.stdout));
});

test('toPosix·findUp·repoRootFrom·expandHome', () => {
  assert.equal(toPosix('a\\b\\c'), 'a/b/c');
  fs.mkdirSync(path.join(tmp, 'repo', '.git'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'repo', 'x', 'y'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'wt', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'wt', '.git'), 'gitdir: ../repo/.git\n'); // 워크트리는 .git 파일
  assert.equal(repoRootFrom(path.join(tmp, 'repo', 'x', 'y')), path.join(tmp, 'repo'));
  assert.equal(repoRootFrom(path.join(tmp, 'wt', 'sub')), path.join(tmp, 'wt'));
  assert.equal(findUp(path.join(tmp, 'repo', 'x', 'y'), '.git'), path.join(tmp, 'repo', '.git'));
  assert.equal(findUp(path.join(tmp, 'repo', 'x'), 'no-such-file-dmes-xyz'), null);
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/a/b'), path.join(os.homedir(), 'a', 'b'));
  assert.equal(expandHome('/x/~y'), '/x/~y');
});

test('walkSorted: includeDirs 면 심볼릭 링크 폴더도 목록에 넣되 안으로 들어가지는 않는다(python rglob)', (t) => {
  const base = path.join(tmp, 'symtree');
  fs.mkdirSync(path.join(base, 'real'), { recursive: true });
  fs.writeFileSync(path.join(base, 'real', 'f.md'), '');
  try { fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), 'dir'); } catch { t.skip('심볼릭 링크를 만들 수 없는 환경(윈도우 일반 권한)'); return; }
  const r = (arr) => arr.map((p) => toPosix(path.relative(base, p)));
  assert.deepEqual(r(walkSorted(base, { includeDirs: true })), ['link', 'real', 'real/f.md']);
  assert.deepEqual(r(walkSorted(base)), ['real/f.md']);
});
