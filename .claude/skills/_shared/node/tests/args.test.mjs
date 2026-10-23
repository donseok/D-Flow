import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCli, exitUsage, finish, OK, VIOLATION, USAGE } from '../args.mjs';
import { makeTempDir, runNode } from '../proc.mjs';

const tmp = makeTempDir('dmes-args-test-');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// process.exitCode 를 건드리는 시험이므로 끝나면 원래 값으로 되돌린다
function withExitCode(fn) {
  const saved = process.exitCode;
  try {
    process.exitCode = undefined;
    return fn();
  } finally {
    process.exitCode = saved;
  }
}
function fakeIo() {
  const io = { out: '', err: '' };
  io.stdout = { write: (s) => { io.out += s; } };
  io.stderr = { write: (s) => { io.err += s; } };
  return io;
}

const SPEC = {
  prog: 'tool',
  options: { root: { type: 'string', short: 'r', default: '.' }, json: { type: 'boolean' } },
  commands: {
    add: {
      options: { level: { type: 'int', choices: [1, 2, 3], default: 1 }, tag: { type: 'string', multiple: true }, name: { type: 'string', required: true } },
      positionals: [{ name: 'target' }, { name: 'more', variadic: true, required: false }],
    },
    list: { options: {}, positionals: [] },
  },
};

test('상수와 finish: 종료 코드 규약', () => {
  assert.deepEqual([OK, VIOLATION, USAGE], [0, 1, 2]);
  withExitCode(() => {
    assert.equal(finish(VIOLATION), 1);
    assert.equal(process.exitCode, 1);
  });
});

test('parseCli: 서브커맨드·옵션·위치 인자·기본값·타입 변환', () => {
  withExitCode(() => {
    const io = fakeIo();
    const r = parseCli(['--root', 'x', '--json', 'add', 'T', 'a', 'b', '--name=n', '--level', '2', '--tag', 'p', '--tag', 'q'], SPEC, io);
    assert.equal(r.command, 'add');
    assert.deepEqual(r.values, { root: 'x', json: true, level: 2, tag: ['p', 'q'], name: 'n' });
    assert.deepEqual(r.positionals, { target: 'T', more: ['a', 'b'] });
    const r2 = parseCli(['list'], SPEC, io);
    assert.deepEqual(r2.values, { root: '.', json: false });
    assert.equal(process.exitCode, undefined);
    assert.equal(io.err, '');
  });
});

test('parseCli: 사용 오류는 stderr 에 사용: 메시지, 종료 코드 2, null 반환', () => {
  const bad = [
    [['add', 'T'], /name/],                       // 필수 옵션 누락
    [['add', '--name', 'n'], /target/],            // 필수 위치 인자 누락
    [['add', 'T', '--name', 'n', '--level', '9'], /choices/], // 잘못된 choices
    [['add', 'T', '--name', 'n', '--level', 'x'], /정수/],
    [['add', 'T', '--name', 'n', '--bogus'], /알 수 없는 옵션/],
    [['--bogus', 'list'], /알 수 없는 옵션/],
    [['nope'], /잘못된 명령/],
    [[], /명령이 필요/],
    [['list', 'extra'], /인식할 수 없는 인자/],
  ];
  for (const [argv, re] of bad) {
    withExitCode(() => {
      const io = fakeIo();
      assert.equal(parseCli(argv, SPEC, io), null, argv.join(' '));
      assert.equal(process.exitCode, USAGE, argv.join(' '));
      assert.match(io.err, /^사용: /);
      assert.match(io.err, re, argv.join(' '));
    });
  }
});

test('parseCli: 서브커맨드 없는 spec, --help 는 종료 코드 0', () => {
  withExitCode(() => {
    const io = fakeIo();
    const spec = { prog: 'p', options: { v: { type: 'boolean', short: 'v' } }, positionals: [{ name: 'file' }] };
    const r = parseCli(['-v', 'a.md'], spec, io);
    assert.deepEqual(r.values, { v: true });
    assert.deepEqual(r.positionals, { file: 'a.md' });
    assert.equal(parseCli(['--help'], spec, io), null);
    assert.equal(process.exitCode, OK);
    assert.match(io.out, /^사용: p \[--v\] file/);
  });
});

test('exitUsage: 사용: 줄과 오류 줄, 종료 코드 2', () => {
  withExitCode(() => {
    const io = fakeIo();
    exitUsage('값이 이상함', { usage: 'tool X', prog: 'tool', stderr: io.stderr });
    assert.equal(io.err, '사용: tool X\ntool: 오류: 값이 이상함\n');
    assert.equal(process.exitCode, 2);
  });
});

test('프로세스 종료 코드: 사용 오류 2, 위반 1, 정상 0, 큰 stdout 유지', () => {
  const lib = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'args.mjs')).href;
  const script = path.join(tmp, 'cli.mjs');
  fs.writeFileSync(script, `import { parseCli, finish, VIOLATION } from ${JSON.stringify(lib)};
const cli = parseCli(process.argv.slice(2), { prog: 'cli', options: { fail: { type: 'boolean' }, big: { type: 'boolean' } } });
if (!cli) { /* 종료 코드는 parseCli 가 지정 */ }
else {
  if (cli.values.big) process.stdout.write('x'.repeat(3 * 1024 * 1024));
  if (cli.values.fail) finish(VIOLATION);
}`);
  const bad = runNode(script, ['--nope']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^사용: cli/);
  assert.equal(runNode(script, ['--fail']).status, 1);
  assert.equal(runNode(script, []).status, 0);
  const big = runNode(script, ['--big', '--fail']);
  assert.equal(big.status, 1);
  assert.equal(big.stdout.length, 3 * 1024 * 1024);
});
