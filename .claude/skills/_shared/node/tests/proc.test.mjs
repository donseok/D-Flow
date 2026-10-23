import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNode, runCommand, findPython, resolveBin, makeTempDir } from '../proc.mjs';

const tmp = makeTempDir('dmes-proc-test-');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('makeTempDir: os.tmpdir() 아래에 생성', () => {
  const d = makeTempDir('dmes-mk-');
  try {
    assert.ok(fs.statSync(d).isDirectory());
    assert.ok(d.startsWith(os.tmpdir()));
    assert.ok(path.basename(d).startsWith('dmes-mk-'));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('runNode: stdout·stderr·status 정규화, input·cwd·env 전달, EOL 옵션', () => {
  const s = path.join(tmp, 'echo.mjs');
  fs.writeFileSync(s, `import fs from 'node:fs';
const input = fs.readFileSync(0, 'utf8');
process.stdout.write('in=' + input + '|cwd=' + process.cwd() + '|env=' + process.env.DMES_T + '|args=' + process.argv.slice(2).join(',') + '\\r\\nx\\r');
process.stderr.write('err\\r\\n');
process.exitCode = 3;`);
  const r = runNode(s, ['a', 'b'], { input: 'hello', cwd: tmp, env: { DMES_T: 'v' } });
  assert.equal(r.status, 3);
  assert.equal(r.stdout, `in=hello|cwd=${fs.realpathSync(tmp)}|env=v|args=a,b\r\nx\r`);
  assert.equal(r.stderr, 'err\r\n');
  const n = runNode(s, [], { normalizeEol: true, cwd: tmp });
  assert.ok(!n.stdout.includes('\r') && !n.stderr.includes('\r'));
});

test('runCommand: 존재하지 않는 명령은 status -1 과 error 필드', () => {
  const r = runCommand('dmes-no-such-command-xyz', []);
  assert.equal(r.status, -1);
  assert.ok(r.error);
  const ok = runCommand(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.deepEqual([ok.status, ok.stdout], [0, 'ok']);
});

test('findPython: 문자열 또는 null, 있으면 실제로 Python 3 을 실행', () => {
  const py = findPython({ refresh: true });
  assert.ok(py === null || typeof py === 'string');
  if (py) assert.match(runCommand(py, ['--version']).stdout + runCommand(py, ['--version']).stderr, /^Python 3\./);
  const saved = process.env.DMES_NO_PYTHON;
  try {
    process.env.DMES_NO_PYTHON = '1';
    assert.equal(findPython({ refresh: true }), null);
  } finally {
    if (saved === undefined) delete process.env.DMES_NO_PYTHON; else process.env.DMES_NO_PYTHON = saved;
    findPython({ refresh: true });
  }
});

test('resolveBin: .bin 탐색, 윈도우면 .cmd 우선', () => {
  const bin = path.join(tmp, 'proj', 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tsc'), '');
  assert.equal(resolveBin(path.join(tmp, 'proj'), 'tsc', { platform: 'linux' }), path.join(bin, 'tsc'));
  assert.equal(resolveBin(path.join(tmp, 'proj'), 'tsc', { platform: 'win32' }), path.join(bin, 'tsc')); // .cmd 없으면 폴백
  fs.writeFileSync(path.join(bin, 'tsc.cmd'), '');
  assert.equal(resolveBin(path.join(tmp, 'proj'), 'tsc', { platform: 'win32' }), path.join(bin, 'tsc.cmd'));
  assert.equal(resolveBin(path.join(tmp, 'proj'), 'tsc', { platform: 'linux' }), path.join(bin, 'tsc'));
  assert.equal(resolveBin(path.join(tmp, 'proj'), 'nope'), null);
});
