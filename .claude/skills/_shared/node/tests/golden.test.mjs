import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compareGolden, formatDiffs } from '../golden.mjs';
import { findPython, makeTempDir } from '../proc.mjs';

const tmp = makeTempDir('dmes-golden-test-');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const nodeScript = path.join(tmp, 'tool.mjs');
fs.writeFileSync(nodeScript, `import fs from 'node:fs';
const mode = process.argv[2] ?? 'same';
const input = fs.readFileSync(0, 'utf8');
process.stdout.write(mode === 'diff' ? 'node:' + input + '\\r\\n' : 'echo:' + input + '\\n');
process.exitCode = mode === 'code' ? 4 : 0;`);
const pyScript = path.join(tmp, 'tool.py');
fs.writeFileSync(pyScript, `import sys
mode = sys.argv[1] if len(sys.argv) > 1 else 'same'
data = sys.stdin.read()
if mode == 'diff':
    sys.stdout.write('py:' + data + '\\n')
else:
    sys.stdout.write('echo:' + data + '\\n')
sys.exit(3 if mode == 'code' else 0)
`);

test('compareGolden: python 이 없으면 skipped 를 돌려준다', () => {
  const r = compareGolden({ python: { cmd: [pyScript] }, node: { script: nodeScript }, input: 'x' }, { python: null });
  assert.equal(r.skipped, true);
  assert.match(r.reason, /python/);
  assert.deepEqual(r.diffs, []);
  assert.match(formatDiffs(r), /^skip/);
});

test('compareGolden: DMES_NO_PYTHON=1 이면 skipped', () => {
  const saved = process.env.DMES_NO_PYTHON;
  try {
    process.env.DMES_NO_PYTHON = '1';
    assert.equal(compareGolden({ python: { cmd: [pyScript] }, node: { script: nodeScript } }).skipped, true);
  } finally {
    if (saved === undefined) delete process.env.DMES_NO_PYTHON; else process.env.DMES_NO_PYTHON = saved;
  }
});

test('compareGolden: python 과 node 출력 비교(일치·차이·종료 코드·정규화)', (t) => {
  if (!findPython()) return t.skip('python3 없음');
  const same = compareGolden({ python: { cmd: [pyScript, 'same'] }, node: { script: nodeScript, args: ['same'] }, input: '한글\n' });
  assert.equal(same.ok, true, formatDiffs(same));
  assert.deepEqual(same.diffs, []);

  const diff = compareGolden({ python: { cmd: [pyScript, 'diff'] }, node: { script: nodeScript, args: ['diff'] }, input: 'q' });
  assert.equal(diff.ok, false);
  assert.deepEqual(diff.diffs.map((d) => d.field), ['stdout']);
  assert.equal(diff.diffs[0].python, 'py:q\n');
  assert.equal(diff.diffs[0].node, 'node:q\n'); // CRLF 는 기본 정규화로 LF
  assert.match(formatDiffs(diff), /\[stdout\]/);

  const strict = compareGolden({ python: { cmd: [pyScript, 'diff'] }, node: { script: nodeScript, args: ['diff'] }, input: 'q', normalize: { eol: false }, compare: ['stdout'] });
  assert.equal(strict.diffs[0].node, 'node:q\r\n');

  const code = compareGolden({ python: { cmd: ['python3', pyScript, 'code'] }, node: { script: nodeScript, args: ['code'] }, input: '' });
  assert.deepEqual(code.diffs.map((d) => [d.field, d.python, d.node]), [['status', 3, 4]]);
  assert.equal(compareGolden({ python: { cmd: [pyScript, 'code'] }, node: { script: nodeScript, args: ['code'] }, input: '', compare: ['stdout'] }).ok, true);
});
