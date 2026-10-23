// wbs-envelope.mjs 시험.
//  1) 단위: 인자 해석(사용 오류 2), splitSet·assemble, 출력 형식(끝 개행 없음·LF·BOM 없음·키 순서).
//  2) 골든(python 이 있을 때): SKILL.md 의 인라인 python 두 가지(PY_V1·PY_V2, envelope-cases.mjs 에 문자열로 보관)를
//     임시 폴더에서 그대로 돌려 node 판과 종료 코드·출력 파일 바이트를 비교한다.
//     입력: 합성 경계 입력(syntheticCases) + nlevel export 샘플 3종 + 리포의 실제 WBS(`wbs-parse.mjs --export` 결과).
//  3) python 이 없어도 도는 보조 시험: 미리 python 으로 계산한 tests/golden/expected/envelope.json 과 비교
//     (기대값은 `node dflow-export/tests/make-expected-envelope.mjs` 로 다시 만든다).
// 임시 폴더는 모두 makeTempDir 로 만들고 끝나면 지운다.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findPython, makeTempDir, runNode } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import { walkSorted } from '../../_shared/node/paths.mjs';
import { splitSet, assemble, importProblem, MODULE_RE, MAX_NODES } from '../scripts/wbs-envelope.mjs';
import {
  VARIANTS, syntheticCases, nlevelInputs, pyCode, runLegacy, runEnvelope, readOut, PY_V1, PY_V2,
} from './envelope-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'wbs-envelope.mjs');
const PARSE = path.join(HERE, '..', 'scripts', 'wbs-parse.mjs');
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const EXPECTED = path.join(HERE, 'golden', 'expected', 'envelope.json');
const UUID = '3f2b8c1e-5a7d-4e90-9b21-0c6d4a8e1f77';

const base = makeTempDir('wbs-envelope-test-');
after(() => fs.rmSync(base, { recursive: true, force: true }));

let seq = 0;
const newDir = () => {
  const d = path.join(base, `d${seq++}`);
  fs.mkdirSync(d);
  return d;
};

const py = findPython();
const NO_PY = py ? false : 'python 3 를 찾지 못함(또는 DMES_NO_PYTHON=1) — 골든 비교 skip';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 한 줄짜리 짧은 오류 출력인지. */
function assertShortError(r, label) {
  assert.equal(r.status, 1, `${label}: 종료 코드`);
  assert.match(r.stderr, /^ERROR: [^\n]{1,400}\n$/, `${label}: stderr 는 한 줄 ERROR`);
  assert.equal(r.stdout, '', `${label}: stdout 없음`);
}

// ─────────────────────────────────────────────────────────────── 1) 단위

test('splitSet: 첫 = 에서만 나누고 키가 비면 거부', () => {
  assert.deepEqual(splitSet('project_id=abc'), ['project_id', 'abc']);
  assert.deepEqual(splitSet('module=a=b'), ['module', 'a=b']);
  assert.deepEqual(splitSet('module='), ['module', '']);
  assert.equal(splitSet('novalue'), null);
  assert.equal(splitSet('=x'), null);
});

test('assemble: 기존 키는 제자리, 새 키는 뒤, 값은 문자열', () => {
  assert.equal(assemble('{"a":1,"project_id":"old","b":2}', [['project_id', 'N'], ['module', 'M']]),
    '{"a": 1, "project_id": "N", "b": 2, "module": "M"}');
  assert.equal(assemble('{}', [['project_id', 'N']]), '{"project_id": "N"}');
  assert.equal(assemble('{}', []), '{}');
  assert.equal(assemble('{}', [['project_id', 'N']], 2), '{\n  "project_id": "N"\n}');
});

test('assemble: 같은 키를 두 번 주면 마지막 값(위치는 처음)', () => {
  assert.equal(assemble('{"x":1}', [['k', '1'], ['y', 'a'], ['k', '2']]), '{"x": 1, "k": "2", "y": "a"}');
});

test('assemble: 정수형 문자열 키·float·큰 정수·비 ASCII 를 python 처럼 쓴다', () => {
  const out = assemble('{"10":1,"2":1.0,"b":12345678901234567890123,"한글":"😀","e":1E5}', [['project_id', 'P']]);
  assert.equal(out, '{"10": 1, "2": 1.0, "b": 12345678901234567890123, "한글": "😀", "e": 100000.0, "project_id": "P"}');
});

test('assemble: 객체가 아닌 최상위·깨진 JSON·짝 없는 서로게이트는 예외', () => {
  assert.throws(() => assemble('[1]', []), /객체가 아님/);
  assert.throws(() => assemble('{"a":', []), /Expecting value/);
  assert.throws(() => assemble('﻿{}', []), /BOM/);
  assert.throws(() => assemble('{"s":"\\ud800"}', []), /서로게이트/);
  // 정상 쌍은 통과
  assert.equal(assemble('{"s":"\\ud83d\\ude00"}', []), '{"s": "😀"}');
});

function runCli(args, opts = {}) {
  return runNode(SCRIPT, args, { cwd: base, ...opts });
}

test('CLI: 쓰기 형식 — 끝 개행 없음, LF, BOM 없음, stdout 비어 있음', () => {
  const d = newDir();
  fs.writeFileSync(path.join(d, 'in.json'), '{\r\n "a": "한글",\r\n "n": [1, 2]\r\n}\r\n');
  const r = runCli(['--in', path.join(d, 'in.json'), '--out', path.join(d, 'out.json'), '--set', 'project_id=P', '--set', 'module=M', '--indent', '2']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  const buf = fs.readFileSync(path.join(d, 'out.json'));
  assert.notEqual(buf[0], 0xef, 'BOM 없음');
  assert.ok(!buf.includes(0x0d), 'CR 없음');
  assert.notEqual(buf[buf.length - 1], 0x0a, '끝 개행 없음');
  assert.equal(buf.toString('utf8'), '{\n  "a": "한글",\n  "n": [\n    1,\n    2\n  ],\n  "project_id": "P",\n  "module": "M"\n}');
});

test('CLI: --indent 생략 = 들여쓰기 없음(python 기본 구분자), 0 은 줄바꿈만', () => {
  const d = newDir();
  fs.writeFileSync(path.join(d, 'in.json'), '{"a":[1,2],"b":{"c":null}}');
  const a = path.join(d, 'a.json');
  assert.equal(runCli(['--in', path.join(d, 'in.json'), '--out', a, '--set', 'project_id=P']).status, 0);
  assert.equal(fs.readFileSync(a, 'utf8'), '{"a": [1, 2], "b": {"c": null}, "project_id": "P"}');
  const z = path.join(d, 'z.json');
  assert.equal(runCli(['--in', path.join(d, 'in.json'), '--out', z, '--set', 'project_id=P', '--indent', '0']).status, 0);
  assert.equal(fs.readFileSync(z, 'utf8'), '{\n"a": [\n1,\n2\n],\n"b": {\n"c": null\n},\n"project_id": "P"\n}');
  const f = path.join(d, 'f.json');
  assert.equal(runCli(['--in', path.join(d, 'in.json'), '--out', f, '--set', 'project_id=P', '--indent', '4']).status, 0);
  assert.equal(fs.readFileSync(f, 'utf8'), JSON.stringify({ a: [1, 2], b: { c: null }, project_id: 'P' }, null, 4));
});

test('CLI: 같은 파일을 입출력으로 줘도 읽은 뒤 덮어쓴다', () => {
  const d = newDir();
  const f = path.join(d, 'x.json');
  fs.writeFileSync(f, '{"a":1}');
  assert.equal(runCli(['--in', f, '--out', f, '--set', 'project_id=P']).status, 0);
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a": 1, "project_id": "P"}');
});

test('CLI: 사용 오류는 종료 코드 2', () => {
  const d = newDir();
  const inf = path.join(d, 'in.json');
  fs.writeFileSync(inf, '{}');
  const outf = path.join(d, 'out.json');
  for (const args of [
    [],
    ['--in', inf],
    ['--out', outf],
    ['--in', inf, '--out', outf, '--set', 'novalue'],
    ['--in', inf, '--out', outf, '--set', '=x'],
    ['--in', inf, '--out', outf, '--indent', 'x'],
    ['--in', inf, '--out', outf, '--indent', '-1'],
    ['--in', inf, '--out', outf, '--bogus'],
    ['--in', inf, '--out', outf, 'extra'],
  ]) {
    const r = runCli(args);
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.match(r.stderr, /오류/);
    assert.equal(fs.existsSync(outf), false, `${JSON.stringify(args)}: 출력 파일을 만들지 않음`);
  }
});

test('CLI: --set 이 하나도 없으면 종료 코드 2 + 한 줄 stderr, 출력 파일을 만들지 않는다', () => {
  const d = newDir();
  const inf = path.join(d, 'in.json');
  fs.writeFileSync(inf, '{"a":1}');
  const outf = path.join(d, 'out.json');
  for (const extra of [[], ['--indent', '2']]) {
    const r = runCli(['--in', inf, '--out', outf, ...extra]);
    assert.equal(r.status, 2, JSON.stringify(extra));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^wbs-envelope: 오류: --set [^\n]*\n$/, '한 줄 stderr');
    assert.equal(fs.existsSync(outf), false);
  }
  // 입력 파일이 없어도 인자 검사가 먼저다(사용 오류가 입력 오류보다 앞선다)
  assert.equal(runCli(['--in', path.join(d, 'nope.json'), '--out', outf]).status, 2);
});

test('CLI: 입력이 없거나 깨지면 종료 코드 1 + 한 줄 ERROR, 출력 파일 없음', () => {
  const d = newDir();
  const outf = path.join(d, 'out.json');
  assertShortError(runCli(['--in', path.join(d, 'nope.json'), '--out', outf, '--set', 'project_id=P']), '입력 없음');
  fs.writeFileSync(path.join(d, 'bad.json'), '{"a":');
  const r = runCli(['--in', path.join(d, 'bad.json'), '--out', outf, '--set', 'project_id=P']);
  assertShortError(r, '깨진 JSON');
  assert.match(r.stderr, /Expecting value: line 1 column 6 \(char 5\)/);
  assert.equal(fs.existsSync(outf), false);
});

test('CLI: 출력 폴더가 없으면 오류이고 폴더를 만들지 않는다', () => {
  const d = newDir();
  fs.writeFileSync(path.join(d, 'in.json'), '{}');
  const r = runCli(['--in', path.join(d, 'in.json'), '--out', path.join(d, 'sub', 'out.json'), '--set', 'project_id=P']);
  assertShortError(r, '출력 폴더 없음');
  assert.equal(fs.existsSync(path.join(d, 'sub')), false);
});

test('CLI: 상대 경로(cwd 기준)로도 같은 결과', () => {
  const d = newDir();
  fs.writeFileSync(path.join(d, 'in.json'), '{"a":1}');
  const r = runNode(SCRIPT, ['--in', 'in.json', '--out', 'out.json', '--set', 'project_id=P'], { cwd: d });
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(path.join(d, 'out.json'), 'utf8'), '{"a": 1, "project_id": "P"}');
});

test('legacy 문자열이 SKILL.md 의 두 코드와 같은 모양이다(문서 자리표시자만 다름)', () => {
  const code1 = pyCode('v1', { inFile: '/i', outFile: '/o', uuid: 'U', mod: 'M' });
  assert.match(code1, /indent=2\)\n$/);
  assert.match(code1, /d\["project_id"\] = "U"; d\["module"\] = "M"/);
  const code2 = pyCode('v2', { inFile: '/i', outFile: '/o', uuid: 'U' });
  assert.match(code2, /ensure_ascii=False\)\n$/);
  assert.ok(!code2.includes('indent'));
  assert.ok(PY_V1.includes('json.load(open(') && PY_V2.includes('json.load(open('));
});

// ─────────────────────────────────────────────────────────────── 1b) import 사전 검사 (python 판에는 없던 검사)

/**
 * 케이스·variant 에서 import 사전 검사가 거부하는지. python 원본은 그런 입력도 그대로 써 주므로(의도한 차이)
 * 골든·기대값 비교는 이런 케이스를 "node 가 한 줄 ERROR 로 거부한다"로 바꿔 확인한다.
 */
function rejectedByImportCheck(c, variant) {
  if (c.input === null) return false;
  const sets = variant === 'v1' ? [['project_id', c.uuid], ['module', c.mod]] : [['project_id', c.uuid]];
  try {
    return importProblem(Buffer.from(c.input).toString('utf8').replace(/\r\n?/g, '\n'), sets) !== null;
  } catch {
    return false; // 깨진 JSON 등은 python 과 같은 경로(assemble 의 오류)로 간다
  }
}

const envOf = (nodes) => JSON.stringify({ schema_version: '2.1', source: 'x', nodes });
const oneNode = { id: 'TSK-01-01', title: 't' };
const runBody = (body, sets, extra = []) => {
  const d = newDir();
  const inFile = path.join(d, 'in.json');
  const outFile = path.join(d, 'out.json');
  fs.writeFileSync(inFile, body);
  const r = runNode(SCRIPT, ['--in', inFile, '--out', outFile, ...sets.flatMap((x) => ['--set', x]), ...extra], { cwd: d });
  return { ...r, outFile };
};

test('importProblem: module 형식 — 영문·숫자·_·- 1~32자만', () => {
  for (const ok of ['c10', 'MES_op-2', 'a', 'x'.repeat(32)]) {
    assert.ok(MODULE_RE.test(ok), ok);
    assert.equal(importProblem(envOf([oneNode]), [['module', ok]]), null, ok);
  }
  for (const bad of ['', 'x'.repeat(33), 'a b', 'a/b', '한글', 'a.b', ' a', 'a\n']) {
    assert.match(importProblem(envOf([oneNode]), [['module', bad]]) ?? '', /^module 형식 오류/, JSON.stringify(bad));
  }
  assert.equal(importProblem(envOf([oneNode]), [['project_id', 'a b']]), null, 'module 이 아닌 키는 보지 않는다');
});

test('importProblem: nodes 건수 — 비어 있음과 상한 초과를 거부, 상한 건수는 통과', () => {
  assert.match(importProblem(envOf([]), [['module', 'm']]), /nodes 가 비어 있음/);
  const many = (n) => envOf(Array.from({ length: n }, (_, i) => ({ id: `T-${i}`, title: 't' })));
  assert.equal(importProblem(many(MAX_NODES), [['module', 'm']]), null);
  assert.match(importProblem(many(MAX_NODES + 1), [['module', 'm']]), new RegExp(`nodes ${MAX_NODES + 1}건`));
});

test('CLI: 잘못된 module 은 종료 코드 1 + 한 줄 ERROR, 출력 파일을 만들지 않는다', () => {
  const r = runBody(envOf([oneNode]), [`project_id=${UUID}`, 'module=bad name']);
  assertShortError(r, 'bad module');
  assert.match(r.stderr, /module 형식 오류/);
  assert.equal(readOut(r.outFile), null);
});

test('CLI: nodes 가 비면 종료 코드 1 + 한 줄 ERROR, 출력 파일을 만들지 않는다', () => {
  const r = runBody(envOf([]), [`project_id=${UUID}`, 'module=m']);
  assertShortError(r, 'empty nodes');
  assert.match(r.stderr, /nodes 가 비어 있음/);
  assert.equal(readOut(r.outFile), null);
});

test('CLI: nodes 1001건이면 종료 코드 1, 1000건이면 통과', () => {
  const many = (n) => envOf(Array.from({ length: n }, (_, i) => ({ id: `T-${i}`, title: 't' })));
  const over = runBody(many(MAX_NODES + 1), [`project_id=${UUID}`, 'module=m']);
  assertShortError(over, 'over limit');
  assert.match(over.stderr, /상한 1000건 초과/);
  const edge = runBody(many(MAX_NODES), [`project_id=${UUID}`, 'module=m']);
  assert.equal(edge.status, 0, edge.stderr);
});

test('CLI: 정상 봉투는 이전과 같은 바이트(module 이 유효하고 nodes 가 1건 이상)', () => {
  const r = runBody(envOf([oneNode]), [`project_id=${UUID}`, 'module=c10'], ['--indent', '2']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(readOut(r.outFile).toString('utf8'));
  assert.equal(out.module, 'c10');
  assert.equal(out.project_id, UUID);
});

// ─────────────────────────────────────────────────────────────── 2) 골든(python)

const CASES = syntheticCases();

for (const c of CASES) {
  for (const v of VARIANTS) {
    test(`golden: ${c.id} | ${v}`, { skip: NO_PY }, () => {
      if (rejectedByImportCheck(c, v)) {
        const n = runEnvelope(SCRIPT, v, c, newDir());
        assertShortError(n, c.id);
        assert.equal(readOut(n.outFile), null, '출력 파일 없음');
        return;
      }
      const p = runLegacy(py, v, c, newDir());
      const n = runEnvelope(SCRIPT, v, c, newDir());
      assert.equal(n.status, p.status, `종료 코드 python=${p.status} node=${n.status}\npython stderr: ${p.stderr.split('\n').slice(-3).join(' | ')}\nnode stderr: ${n.stderr}`);
      if (p.status === 0) {
        assert.equal(n.stderr, '');
        const pb = readOut(p.outFile);
        const nb = readOut(n.outFile);
        assert.ok(pb && nb, '출력 파일이 있어야 함');
        assert.ok(pb.equals(nb), `바이트 불일치\npython: ${pb.toString('utf8').slice(0, 300)}\nnode:   ${nb.toString('utf8').slice(0, 300)}`);
      } else {
        assertShortError(n, c.id);
        if (c.out === 'nodir') assert.equal(fs.existsSync(path.dirname(n.outFile)), false, '출력 폴더를 만들지 않음');
        if (c.out === 'nodir') assert.equal(fs.existsSync(path.dirname(p.outFile)), false);
        if (!c.loneSurrogate && c.out === 'file') assert.equal(readOut(n.outFile), null, '출력 파일 없음');
      }
    });
  }
}

test('golden: nlevel export 샘플(동결 입력 문서) × 두 variant', { skip: NO_PY }, async () => {
  const work = newDir();
  const inputs = await nlevelInputs(work);
  assert.equal(inputs.length, 3);
  for (const c of inputs) {
    for (const v of VARIANTS) {
      const p = runLegacy(py, v, c, newDir());
      const n = runEnvelope(SCRIPT, v, c, newDir());
      assert.equal(p.status, 0, `${c.id}: python`);
      assert.equal(n.status, 0, `${c.id}: node ${n.stderr}`);
      assert.ok(readOut(p.outFile).equals(readOut(n.outFile)), `${c.id} | ${v}: 바이트 불일치`);
    }
  }
});

test('golden: 리포의 실제 WBS(docs/**/wbs*.md)의 export 봉투 × 두 variant', { skip: NO_PY }, (t) => {
  const docs = walkSorted(path.join(REPO, 'docs'), { extensions: ['.md'], skipDirs: ['node_modules', '.git'] })
    .filter((p) => /^wbs.*\.md$/.test(path.basename(p)));
  if (docs.length === 0) return t.skip('이 리포에 실제 문서가 없다(D-Flow 정본 리포 — 실제 문서 비교는 스킬을 설치한 리포에서 돈다)');
  let compared = 0;
  for (const rel of docs) {
    const abs = path.isAbsolute(rel) ? rel : path.join(REPO, 'docs', rel);
    const ex = runNode(PARSE, [abs, '--export'], { cwd: REPO });
    if (ex.status !== 0) continue; // export 가 막히는 문서는 봉투가 없다
    const c = { id: rel, input: ex.stdout, uuid: UUID, mod: 'MDM', out: 'file' };
    for (const v of VARIANTS) {
      const p = runLegacy(py, v, c, newDir());
      const n = runEnvelope(SCRIPT, v, c, newDir());
      assert.equal(p.status, 0, `${rel}: python`);
      assert.equal(n.status, 0, `${rel}: node ${n.stderr}`);
      assert.ok(readOut(p.outFile).equals(readOut(n.outFile)), `${rel} | ${v}: 바이트 불일치`);
      compared++;
    }
  }
  assert.ok(compared >= 2, `실제 문서 비교가 한 건도 없음(${compared})`);
});

// ─────────────────────────────────────────────────────────────── 3) 기대값(python 없이)

let expected;
before(() => {
  expected = readJson(EXPECTED);
});

test('expected: 기대값 파일이 합성 케이스 전수(+nlevel 3종)를 덮는다', () => {
  const keys = new Set(Object.keys(expected));
  for (const c of CASES) for (const v of VARIANTS) assert.ok(keys.has(`${c.id} | ${v}`), `${c.id} | ${v} 기대값 없음`);
  for (const id of ['nlevel skeleton-sample export', 'nlevel PL_MD + skeleton(attach_ref)', 'nlevel SKEL_MIN 골격']) {
    for (const v of VARIANTS) assert.ok(keys.has(`${id} | ${v}`), `${id} | ${v} 기대값 없음`);
  }
  assert.ok(keys.size >= CASES.length * 2 + 6);
});

test('expected: python 기대값과 node 판 출력이 같다(종료 코드·sha256·짧은 출력은 본문)', () => {
  let n = 0;
  for (const [key, e] of Object.entries(expected)) {
    const c = {
      input: e.input === null ? null : Buffer.from(e.input, 'base64'),
      uuid: e.uuid, mod: e.mod, out: e.out,
    };
    const r = runEnvelope(SCRIPT, e.variant, c, newDir());
    if (e.status === 0 && rejectedByImportCheck(c, e.variant)) {
      // python 은 썼지만 import 사전 검사가 거부하는 입력(의도한 차이)
      assertShortError(r, key);
      n++;
      continue;
    }
    assert.equal(r.status, e.status, `${key}: 종료 코드`);
    if (e.status === 0) {
      const out = readOut(r.outFile);
      assert.ok(out, `${key}: 출력 파일`);
      assert.equal(out.length, e.bytes, `${key}: 바이트 수`);
      assert.equal(sha(out), e.sha256, `${key}: sha256`);
      if (e.text !== undefined) assert.equal(out.toString('utf8'), e.text, `${key}: 본문`);
    } else {
      assertShortError(r, key);
    }
    n++;
  }
  assert.ok(n >= 80, `기대값 케이스 수 ${n}`);
});

test('expected: 오류 케이스는 python 도 비정상 종료였다(기대값 자체 점검)', () => {
  for (const [key, e] of Object.entries(expected)) {
    assert.equal(e.error, e.status !== 0, `${key}: error 표시와 종료 코드 불일치`);
  }
});
