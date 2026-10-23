// _wbs_md.mjs 시험. python 원본에는 단위 시험이 없어(wbs-validate·wbs-parse 시험이 간접으로만 덮음) 새로 쓴다.
//  1) 단위 시험: 펜스 짝짓기·들여쓰기 한계·미폐쇄 펜스·줄 시작 오프셋.
//  2) 골든 비교: 같은 문서들을 python legacy 와 node 판이 처리한 결과(JSON)를 비교(python 없으면 skip).
//  3) 기대값 비교: tests/golden/expected/md.json (python 으로 미리 계산).
// 문서에는 비 BMP 문자(이모지)를 넣지 않는다 — 오프셋 단위(python 코드포인트 / JS UTF-16)가 달라지기 때문이다.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import { FENCE_RE, _fenced_ranges, _in_ranges, line_start_offsets } from '../scripts/_wbs_md.mjs';
import { legacyEnv } from './legacy-env.mjs';
import { DOCS, PY_MD_DRIVER, nodeMd } from './md-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = legacyEnv();
const base = makeTempDir('wbs-md-test-');
after(() => {
  env.cleanup();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---- 1) 단위 시험 ------------------------------------------------------------

test('FENCE_RE: 백틱·물결표 3개 이상, 들여쓰기 3칸까지, 줄 시작만', () => {
  const pos = (s) => [...s.matchAll(FENCE_RE)].map((m) => m.index);
  assert.deepEqual(pos('```\n~~~\n````\n~~~~~'), [0, 4, 8, 13]);
  assert.deepEqual(pos('   ```\n'), [0]);
  assert.deepEqual(pos('    ```\n'), []); // 4칸은 들여쓴 코드 블록이지 펜스가 아니다
  assert.deepEqual(pos('a ```\n'), []);
  assert.deepEqual(pos('``\n~~\n'), []);
  assert.deepEqual(pos(''), []);
  assert.deepEqual(pos('x\n```js\ny'), [2]);
});

test('FENCE_RE: ^ 는 \\n 바로 뒤만(CR·LS·PS 뒤는 줄 시작이 아니다, python re.MULTILINE 과 같음)', () => {
  const pos = (s) => [...s.matchAll(FENCE_RE)].map((m) => m.index);
  assert.deepEqual(pos('a\r```\n'), []);
  assert.deepEqual(pos('a ```\n'), []);
  assert.deepEqual(pos('a ```\n'), []);
  assert.deepEqual(pos('a\f```\n'), []);
  assert.deepEqual(pos('a\n```\n'), [2]);
});

test('_fenced_ranges: 여는·닫는 펜스를 순서대로 짝짓고, 짝 없는 마지막은 버린다', () => {
  assert.deepEqual(_fenced_ranges('```\na\n```\n'), [[0, 6]]);
  assert.deepEqual(_fenced_ranges('```\na\n```\nb\n~~~\nc\n~~~\n'), [[0, 6], [12, 18]]);
  assert.deepEqual(_fenced_ranges('```\na\n'), []);
  assert.deepEqual(_fenced_ranges('```\na\n```\nb\n```\nc\n'), [[0, 6]]);
  assert.deepEqual(_fenced_ranges(''), []);
  assert.deepEqual(_fenced_ranges('no fence'), []);
});

test('_in_ranges: 시작은 포함, 끝은 제외', () => {
  const r = [[3, 7], [10, 12]];
  assert.equal(_in_ranges(2, r), false);
  assert.equal(_in_ranges(3, r), true);
  assert.equal(_in_ranges(6, r), true);
  assert.equal(_in_ranges(7, r), false);
  assert.equal(_in_ranges(11, r), true);
  assert.equal(_in_ranges(5, []), false);
});

test('line_start_offsets: splitlines 와 같은 줄 구분으로 시작 오프셋을 센다', () => {
  assert.deepEqual(line_start_offsets(''), []);
  assert.deepEqual(line_start_offsets('a'), [0]);
  assert.deepEqual(line_start_offsets('a\nb\n'), [0, 2]);
  assert.deepEqual(line_start_offsets('a\n\nb'), [0, 2, 3]);
  assert.deepEqual(line_start_offsets('a\r\nb\rc'), [0, 3, 5]);
  assert.deepEqual(line_start_offsets('a b\fc\u0085d'), [0, 2, 4, 6]);
});

test('펜스 안 줄 판정: line_start_offsets 와 _in_ranges 를 함께 쓴다', () => {
  const doc = '# t\n```\n## x\n```\n## y\n';
  const ranges = _fenced_ranges(doc);
  const inside = line_start_offsets(doc).map((o) => _in_ranges(o, ranges));
  assert.deepEqual(inside, [false, true, true, false, false]);
});

// ---- 2)·3) 골든·기대값 ---------------------------------------------------------

test('golden 펜스 판정: python legacy 대 node (전 문서)', (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
  const r = env.python(['-c', PY_MD_DRIVER, env.dir], { input: JSON.stringify(DOCS), cwd: base });
  assert.equal(r.status, 0, r.stderr);
  const py = JSON.parse(r.stdout);
  const nd = nodeMd();
  assert.deepEqual(Object.keys(nd), Object.keys(py));
  for (const k of Object.keys(py)) assert.deepEqual(nd[k], py[k], `문서 ${k}`);
});

test('expected 펜스 판정: node 판 결과가 python 으로 미리 계산한 기대값과 같다', () => {
  const f = path.join(HERE, 'golden', 'expected', 'md.json');
  assert.ok(fs.existsSync(f), 'golden/expected/md.json 이 없음 (make-expected.mjs 로 생성)');
  const exp = readJson(f);
  const nd = nodeMd();
  assert.deepEqual(Object.keys(nd), Object.keys(exp));
  for (const k of Object.keys(exp)) assert.deepEqual(nd[k], exp[k], `문서 ${k}`);
});

