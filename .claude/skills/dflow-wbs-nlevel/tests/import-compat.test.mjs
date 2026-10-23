// wbs-nlevel-parse.mjs validate 의 import 사전 검사 시험 (2026-10).
// D'Flow POST /wbs/import 와 웹 "WBS 마크다운" 탭 적용이 거부하는 값을 validate 가 미리 잡는지 본다.
//  - module: frontmatter 에 있어야 하고 `^[A-Za-z0-9_-]{1,32}$` (골격·PL 모두)
//  - priority: critical|high|medium|low
//  - w: 가중치는 양수
// python 원본에는 없던 검사라 golden 비교와 별개의 케이스로 둔다(golden 자료는 건드리지 않는다).

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse_wbs, validate } from '../scripts/wbs-nlevel-parse.mjs';

const LEVELS = `levels:
  - { name: Phase,     prefix: PH,  progress: rollup }
  - { name: System,    prefix: SYS, progress: rollup }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, upload: fold }`;

const pl = (front = 'module: mes-op', body = '') => `---
project: MES
${front}
attach: PH-03/SYS-OP
${LEVELS}
---
## SUB-OP-IN: 입측
### WP-OP-IN: 프로세스
- [ ] TSK-OP-IN-01: 실적 수집 w:5 ~2026-10-17
${body}`;

const skel = (front = 'module: mes-skel') => `---
project: MES
${front}
${LEVELS}
---
## PH-03: 구축
### SYS-OP: 조업
`;

const errs = (md, role = 'pl') => validate(parse_wbs(md), role).errors;
const has = (list, re) => list.some((e) => re.test(e));

test('module: 정상 값은 PL·골격 모두 통과', () => {
  assert.deepEqual(errs(pl()), []);
  assert.deepEqual(errs(skel(), 'skeleton'), []);
  for (const ok of ['a', 'MES_op-2', 'x'.repeat(32)]) assert.deepEqual(errs(pl(`module: ${ok}`)), [], ok);
});

test('module: 골격 파일에 없으면 오류', () => {
  assert.ok(has(errs(skel('project: X'), 'skeleton'), /골격 파일에 module 이 없습니다/));
});

test('module: PL 파일에 없으면 기존 문구 그대로', () => {
  assert.ok(errs(pl('project: X'), 'pl').includes('PL 파일에 module 이 없습니다.'));
});

test('module: 형식이 틀리면 PL·골격 모두 오류', () => {
  for (const bad of ['mes op', 'mes/op', '한글모듈', 'mes.op', 'x'.repeat(33), '"mes-op"']) {
    assert.ok(has(errs(pl(`module: ${bad}`)), /module 형식 오류/), `pl ${bad}`);
    assert.ok(has(errs(skel(`module: ${bad}`), 'skeleton'), /module 형식 오류/), `skeleton ${bad}`);
  }
});

test('module: 줄 끝 # 주석은 값에서 빠진다(frontmatter 파서 규칙)', () => {
  assert.deepEqual(errs(pl('module: mes-op   # PL 모듈')), []);
});

test('priority: 4종은 통과', () => {
  for (const p of ['critical', 'high', 'medium', 'low']) {
    assert.deepEqual(errs(pl('module: m', `  - priority: ${p}\n`)), [], p);
  }
});

test('priority: 그 밖의 값과 빈 값은 오류', () => {
  for (const bad of ['P1', 'urgent', 'High', '-', '50']) {
    const e = errs(pl('module: m', `  - priority: ${bad}\n`));
    assert.ok(has(e, /TSK-OP-IN-01: priority .* 허용 밖/), bad);
  }
  assert.ok(has(errs(pl('module: m', '  - priority:\n')), /priority .* 허용 밖/), '빈 값');
});

test('priority: 올라가지 않는 fold 층 노드의 값은 보지 않는다', () => {
  const body = '  - [ ] STK-OP-IN-01-1: 점검\n    - priority: P1\n';
  assert.deepEqual(errs(pl('module: m', body)), []);
});

test('w: 양수만 통과', () => {
  const doc = (w) => pl('module: m').replace('w:5', w);
  for (const ok of ['w:5', 'w:2.5', 'w:0.5', 'w:.5', 'w:10']) assert.deepEqual(errs(doc(ok)), [], ok);
});

test('w: 0 과 숫자 아닌 값은 오류', () => {
  const doc = (w) => pl('module: m').replace('w:5', w);
  for (const bad of ['w:0', 'w:0.0', 'w:1.2.3', 'w:.']) {
    assert.ok(has(errs(doc(bad)), /TSK-OP-IN-01: w:/), bad);
  }
});

test('export 는 검증 게이트에서 막힌다(module 형식 오류)', () => {
  const r = validate(parse_wbs(pl('module: bad name')), 'pl');
  assert.equal(r.ok, false);
});
