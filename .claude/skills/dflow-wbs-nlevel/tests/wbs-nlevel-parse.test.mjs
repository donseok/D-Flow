// wbs-nlevel-parse.mjs 시험.
//  1) 원본 test_wbs_nlevel_parse.py 의 모든 케이스(19건: Validate 11 + Export 8)를 같은 의미로 옮긴 단위 시험.
//  2) 이식 도우미(python int/float/날짜/공백 의미)와 python 이 죽는 입력(PyCrash) 단위 시험, CLI(종료 코드·재실행 동일) 시험.
//  3) 골든 비교: 같은 인자·같은 cwd 로 python legacy 와 node 판을 돌려 stdout·stderr·종료 코드를 비교한다
//     (python 이 없거나 DMES_NO_PYTHON=1 이면 skip).
//     - 합성 경계 입력(nlevel-cases.mjs): 문서 80여 종 × 6 명령 + 골격·옵션·파일 문제 + 동결한 실제 문서 사본, 사용 오류(종료 코드만).
//     - 리포의 실제 문서: 스킬 references/skeleton-sample.md, docs/**/wbs*.md 전수(validate 3종 + export), export 는 두 번 돌려 byte 동일.
//     - 시드 고정 무작위 문서(fuzz-cases.mjs): 오류 경로용 줄 섞기 + 검증을 통과하는 트리(export 본문까지).
//  4) python 이 없어도 도는 보조 시험: 미리 python 으로 계산한 tests/golden/expected/parse.json 과 node 판 결과 비교
//     (기대값은 `node dflow-wbs-nlevel/tests/make-expected.mjs` 로 다시 만든다. 실제 문서는 포함하지 않는다).
// 임시 폴더는 모두 makeTempDir 로 만들고 끝나면 지운다.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import { walkSorted } from '../../_shared/node/paths.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import {
  parse_wbs, validate, export_payload, next_business_day, _parse_flow_map, _parse_frontmatter, _extract_tokens,
  readPyText, PyCrash, main,
} from '../scripts/wbs-nlevel-parse.mjs';
import { legacyEnv } from './legacy-env.mjs';
import { PL_MD, buildSynthetic, USAGE_CASES } from './nlevel-cases.mjs';
import { randomLineDocs, treeDocs } from './fuzz-cases.mjs';
import { SCRIPT, writeDocs, runNodeCase, runPythonCase, normResult } from './golden-run.mjs';
import { importCompatIssues, assertRejected } from './import-judge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const EXPECTED = path.join(HERE, 'golden', 'expected', 'parse.json');

const env = legacyEnv();
const base = makeTempDir('nlevel-test-');
const noPy = env.available ? false : 'python3 를 찾지 못해 골든 비교를 건너뜀(DMES_NO_PYTHON=1 포함)';
after(() => {
  fs.rmSync(base, { recursive: true, force: true });
  env.cleanup();
});

// 새 import 사전 검사(import-judge.mjs)가 거부해서 python 비교에서 빠지는 케이스 수. 입력 생성기나 검사가 바뀌어
// 이 수가 달라지면 시험이 실패한다 — 예상 밖 케이스가 조용히 비교에서 빠지는 일을 막는다.
const REJECTED_SYNTH = 40;
const REJECTED_FUZZ = { '줄 섞기': 47, '검증 통과 트리': 0 };

const _parse = (md) => parse_wbs(md);
const names = (payload) => payload.levels.map((l) => l.get('name'));

// ---- 1) 원본 python 단위 시험 이식 (test_wbs_nlevel_parse.py) ----------------

test('Validate: test_pl_file_ok', () => {
  const r = validate(_parse(PL_MD), 'pl');
  assert.deepEqual(r.errors, []);
});

test('Validate: test_unknown_prefix_error', () => {
  const bad = PL_MD.replace('## SUB-OP-IN: 입측', '## ZZZ-1: 미선언');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('접두어')));
});

test('Validate: test_child_level_must_descend', () => {
  const bad = PL_MD.replace('### WP-OP-IN-PR: 프로세스', '### SUB-OP-XX: 역행');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('순번')));
});

test('Validate: test_pl_body_must_not_contain_pmo_layers', () => {
  const bad = PL_MD.replace('## SUB-OP-IN: 입측', '## PH-03: 구축\n\n## SUB-OP-IN: 입측');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('골격')));
});

test('Validate: test_duplicate_id_error', () => {
  const bad = PL_MD.replace(
    '- [ ] TSK-OP-IN-PR-02: 입측 판정 프로세스   w:3  ~2026-11-21  credit:if  if-id:IF-0031',
    '- [ ] TSK-OP-IN-PR-01: 중복 ID   w:3  ~2026-11-21',
  );
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('중복')));
});

test('Validate: test_checked_state_only_on_checklist_layer', () => {
  const bad = PL_MD.replace('- [ ] TSK-OP-IN-PR-02:', '- [x] TSK-OP-IN-PR-02:');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('[ ]')));
});

test('Validate: test_percent_in_title_error', () => {
  const bad = PL_MD.replace('입측 판정 프로세스', '입측 판정 프로세스 30%');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('%')));
});

test('Validate: test_milestone_requires_id', () => {
  const bad = PL_MD.replace('- [M] TSK-OP-IN-PR-90: 입측 오픈 점검   ~2026-11-30', '- [M] 입측 오픈 점검   ~2026-11-30');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('마일스톤')));
});

test('Validate: test_rollup_leaf_is_warning_not_error', () => {
  const bad = PL_MD.replace(`### WP-OP-IN-PR: 프로세스
- [ ] TSK-OP-IN-PR-01`, `### WP-OP-IN-EMPTY: 빈 WP

### WP-OP-IN-PR: 프로세스
- [ ] TSK-OP-IN-PR-01`);
  const r = validate(_parse(bad), 'pl');
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('leaf') || w.includes('리프')));
});

test('Validate: test_depends_missing_target_warning', () => {
  const bad = PL_MD.replace('depends: TSK-OP-IN-PR-02', 'depends: TSK-OP-NOPE-99');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.warnings.some((w) => w.includes('depends')));
});

test('Validate: test_pl_role_requires_attach_and_module', () => {
  const bad = PL_MD.replace('attach: PH-03/SYS-OP\n', '');
  const r = validate(_parse(bad), 'pl');
  assert.ok(r.errors.some((e) => e.includes('attach')));
});

// Export (setUp: payload·nodes 를 매번 새로 만든다)
const exportSetUp = () => {
  const payload = export_payload(_parse(PL_MD), 'mes-skel/SYS-OP');
  return { payload, nodes: Object.fromEntries(payload.nodes.map((n) => [n.id, n])) };
};

test('Export: test_envelope', () => {
  const { payload } = exportSetUp();
  assert.equal(payload.schema_version, '2.2');
  assert.equal(payload.module, 'mes-op');
  assert.equal(payload.attach_ref, 'mes-skel/SYS-OP');
  assert.equal(names(payload)[0], 'Phase');
});

test('Export: test_top_node_has_no_parent', () => {
  const { nodes } = exportSetUp();
  assert.equal(nodes['SUB-OP-IN'].parent_id, null);
});

test('Export: test_levels_and_flags', () => {
  const { nodes } = exportSetUp();
  assert.equal(nodes['SUB-OP-IN'].level, 2);
  assert.equal(nodes['WP-OP-IN-PR'].level, 3);
  const t = nodes['TSK-OP-IN-PR-01'];
  assert.equal(t.level, 5);
  assert.equal(t.parent_id, 'WP-OP-IN-PR');
  assert.equal(t.weight, 5);
  assert.equal(t.assignee, '홍길동');
  assert.equal(t.schedule, '2026-11-14 ~ 2026-11-14'); // 선행(PR-02) 종료가 더 늦어 시작=종료로 고정
  assert.deepEqual(t.depends, ['TSK-OP-IN-PR-02']);
  assert.equal(t.category, 'dev');
  assert.equal(t.priority, 'critical');
  assert.deepEqual(t.tags, ['op', 'entry']);
  assert.equal(t.prd_ref, 'OP-PRD §4.2');
});

test('Export: test_stk_folds_into_parent_acceptance', () => {
  const { nodes } = exportSetUp();
  const t = nodes['TSK-OP-IN-PR-01'];
  assert.ok(!('STK-OP-IN-PR-01-1' in nodes)); // fold — 노드로 안 나감
  assert.ok(t.acceptance.includes('[ ] 크레인 계량 연계 확인'));
  assert.ok(t.acceptance.includes('[x] 중복 수신 방어 로직'));
  // 상세 블록 acceptance 도 유지(/ 분리)
  assert.ok(t.acceptance.includes('단일 트랜잭션'));
});

test('Export: test_credit_and_if_id', () => {
  const { nodes } = exportSetUp();
  const t2 = nodes['TSK-OP-IN-PR-02'];
  assert.equal(t2.credit, 'if');
  assert.equal(t2.if_id, 'IF-0031');
});

test('Export: test_milestone_flag', () => {
  const { nodes } = exportSetUp();
  const ms = nodes['TSK-OP-IN-PR-90'];
  assert.equal(ms.milestone, true);
  assert.equal(ms.schedule, '~ 2026-11-30');
});

test('Export: test_schedule_range_and_derived_start', () => {
  const md = `---
module: m
start_date: 2026-08-31
levels:
  - { name: WP,   prefix: WP,  progress: rollup }
  - { name: Task, prefix: TSK, progress: input }
---
## WP-01: 묶음
- [ ] TSK-01: 명시 2026-09-01~2026-09-03
- [ ] TSK-02: 선행 없음 ~2026-09-05
- [ ] TSK-03: 선행 있음 ~2026-09-10
  - depends: TSK-01
- [ ] TSK-04: 선행이 더 늦음 ~2026-09-02
  - depends: TSK-03
- [ ] TSK-06: 날짜 없음
- [M] TSK-07: 마일스톤 ~2026-09-30
`;
  const sched = Object.fromEntries(export_payload(parse_wbs(md)).nodes.map((n) => [n.id, n.schedule]));
  assert.equal(sched['TSK-01'], '2026-09-01 ~ 2026-09-03');
  assert.equal(sched['TSK-02'], '2026-08-31 ~ 2026-09-05');
  assert.equal(sched['TSK-03'], '2026-09-04 ~ 2026-09-10');
  assert.equal(sched['TSK-04'], '2026-09-02 ~ 2026-09-02');
  assert.equal(sched['TSK-06'], null);
  assert.equal(sched['TSK-07'], '~ 2026-09-30');
  assert.equal(next_business_day('2026-09-04'), '2026-09-07');
});

test('Export: test_deterministic', () => {
  const { payload } = exportSetUp();
  const again = export_payload(_parse(PL_MD), 'mes-skel/SYS-OP');
  assert.deepEqual(payload, again);
  assert.equal(pyJsonDumps(payload, { indent: 1, ensureAscii: false }), pyJsonDumps(again, { indent: 1, ensureAscii: false }));
});

// ---- 2) 이식 도우미·python 이 죽는 입력·CLI -------------------------------------

test('next_business_day: 주말·월말·연말·윤일을 건너뛴다', () => {
  assert.equal(next_business_day('2026-09-04'), '2026-09-07'); // 금 → 월
  assert.equal(next_business_day('2026-09-05'), '2026-09-07'); // 토 → 월
  assert.equal(next_business_day('2026-09-06'), '2026-09-07'); // 일 → 월
  assert.equal(next_business_day('2026-09-07'), '2026-09-08');
  assert.equal(next_business_day('2026-12-31'), '2027-01-01');
  assert.equal(next_business_day('2027-12-31'), '2028-01-03'); // 금 → 월(연말)
  assert.equal(next_business_day('2028-02-28'), '2028-02-29'); // 윤일
  assert.equal(next_business_day('2028-02-29'), '2028-03-01');
  assert.equal(next_business_day('2026-02-27'), '2026-03-02');
  assert.equal(next_business_day('0001-01-01'), '0001-01-02');
  assert.equal(next_business_day('9999-12-30'), '9999-12-31');
});

test('next_business_day: python 이 ValueError·OverflowError 로 죽는 입력', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01', '２０２６-１１-０２', '2026-1-1', '']) {
    assert.throws(() => next_business_day(bad), (e) => e instanceof PyCrash && e.pyName === 'ValueError', bad);
  }
  assert.throws(() => next_business_day('9999-12-31'), (e) => e instanceof PyCrash && e.pyName === 'OverflowError');
});

test('_parse_flow_map: true/false/정수(유니코드 숫자·큰 수)/문자열, 키 순서·정수형 키는 삽입순(Map)', () => {
  const m = _parse_flow_map('name: 5, prefix: WP, 7: seven, 10: ten, 2: two, a: true, b: false, neg: -3, z: -0, big: 123456789012345678901234567890, u: ٣٤, plus: +5, e: , nocolon, k: a: b, 한글: 값, dup: 1, dup: 2');
  assert.deepEqual([...m.keys()], ['name', 'prefix', '7', '10', '2', 'a', 'b', 'neg', 'z', 'big', 'u', 'plus', 'e', 'k', '한글', 'dup']);
  assert.equal(m.get('name'), 5);
  assert.equal(m.get('a'), true);
  assert.equal(m.get('b'), false);
  assert.equal(m.get('neg'), -3);
  assert.ok(Object.is(m.get('z'), 0)); // int("-0") == 0 (JS -0 아님)
  assert.equal(m.get('big'), 123456789012345678901234567890n);
  assert.equal(m.get('u'), 34);
  assert.equal(m.get('plus'), '+5');
  assert.equal(m.get('e'), '');
  assert.equal(m.get('k'), 'a: b');
  assert.equal(m.get('dup'), 2);
  assert.equal(pyJsonDumps(m, { ensureAscii: false }).startsWith('{"name": 5, "prefix": "WP", "7": "seven", "10": "ten", "2": "two"'), true);
});

test('_extract_tokens: 범위가 종료 단독보다 먼저, 같은 토큰은 첫 것만 뗀다', () => {
  const [title, t] = _extract_tokens('제목 2026-09-01 ~ 2026-09-03 ~2026-10-01 @a @b w:1 w:2 credit:x if-id:I');
  assert.equal(title, '제목 @b w:2');
  assert.deepEqual(t, { start: '2026-09-01', end: '2026-10-01', assignee: 'a', weight: '1', credit: 'x', if_id: 'I' });
  assert.deepEqual(_extract_tokens('   공백   많은   제목  '), ['공백 많은 제목', {}]);
  // python \s 는 NBSP·전각 공백·\x1f 를 공백으로 보고 BOM(U+FEFF)은 공백으로 보지 않는다
  assert.deepEqual(_extract_tokens('a 　b\u001f'), ['a b', {}]);
  assert.deepEqual(_extract_tokens('﻿a'), ['﻿a', {}]);
});

test('_parse_frontmatter: 주석·들여쓴 줄·문자열 levels', () => {
  const fm = _parse_frontmatter(['# 주석', 'module: m   # 끝 주석', 'levels:', '  - { name: A, prefix: A, progress: input }   # 주석', 'credits:', '  default: { a: 1 }']);
  assert.equal(fm.get('module'), 'm');
  assert.equal(fm.get('levels').length, 1);
  assert.deepEqual([...fm.get('credits').keys()], ['default']);
  assert.equal(_parse_frontmatter(['levels: foo']).get('levels'), 'foo');
  assert.throws(() => _parse_frontmatter(['levels: foo', 'levels:', '  - { name: A }']), (e) => e instanceof PyCrash && e.pyName === 'AttributeError');
  assert.throws(() => _parse_frontmatter(['credits: x', 'credits:', '  d: { a: 1 }']), (e) => e instanceof PyCrash && e.pyName === 'TypeError');
});

test('export_payload: 가중치(float·정수화·큰 수), 잘못된 가중치는 ValueError', () => {
  const md = (w) => `---\nmodule: m\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n  - { name: T, prefix: TSK, progress: input }\n---\n## WP-A: x\n- [ ] TSK-1: t  w:${w}\n`;
  const weight = (w) => export_payload(parse_wbs(md(w))).nodes.find((n) => n.id === 'TSK-1').weight;
  const dump = (w) => pyJsonDumps(weight(w));
  assert.equal(dump('5'), '5');
  assert.equal(dump('5.'), '5');
  assert.equal(dump('007'), '7');
  assert.equal(dump('2.5'), '2.5');
  assert.equal(dump('.5'), '0.5');
  assert.equal(dump('0.00001'), '1e-05');
  assert.equal(dump('100000000000000000000.0'), '100000000000000000000');
  assert.equal(dump('12345678901234567890'), '12345678901234567168');
  assert.equal(dump('٣.٥'), '3.5');
  assert.equal(dump('9'.repeat(400)), 'Infinity');
  assert.throws(() => weight('1.2.3'), (e) => e instanceof PyCrash && e.pyName === 'ValueError');
  assert.throws(() => weight('.'), (e) => e instanceof PyCrash && e.pyName === 'ValueError');
});

test('readPyText: BOM 은 남기고(python utf-8 과 같음) 줄끝만 통일, UTF-8 이 아니면 UnicodeDecodeError', () => {
  const dir = makeTempDir('nlevel-read-');
  try {
    const p = path.join(dir, 'a.md');
    fs.writeFileSync(p, '﻿a\r\nb\rc\n');
    assert.equal(readPyText(p), '﻿a\nb\nc\n');
    fs.writeFileSync(p, Buffer.from([0xff, 0xfe]));
    assert.throws(() => readPyText(p), (e) => e instanceof PyCrash && e.pyName === 'UnicodeDecodeError');
    assert.throws(() => readPyText(path.join(dir, 'none.md')), (e) => e instanceof PyCrash && e.pyName === 'FileNotFoundError' && /No such file or directory: '/.test(e.message));
    assert.throws(() => readPyText(dir), (e) => e instanceof PyCrash && e.pyName === 'IsADirectoryError');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parse_wbs: BOM 첫 줄은 frontmatter 로 읽히지 않는다(python 과 같음), CRLF 는 통일', () => {
  const withBom = parse_wbs(readPyText((() => { const p = path.join(base, 'bom.md'); fs.writeFileSync(p, `﻿${PL_MD}`); return p; })()));
  assert.equal(withBom.levels.length, 0);
  assert.ok(withBom.problems.length > 0);
  const crlf = parse_wbs(readPyText((() => { const p = path.join(base, 'crlf.md'); fs.writeFileSync(p, PL_MD.replace(/\n/g, '\r\n')); return p; })()));
  assert.equal(pyJsonDumps(export_payload(crlf, 'a/b')), pyJsonDumps(export_payload(parse_wbs(PL_MD), 'a/b')));
});

test('levels 가 문자열인 문서·빈 문서', () => {
  const doc = parse_wbs('---\nmodule: m\nlevels: foo\n---\n## SUB-A: x\n');
  assert.equal(doc.levels, 'foo');
  assert.equal(doc.nodes.length, 0);
  const r = validate(doc, 'skeleton');
  assert.equal(r.ok, false);
  assert.throws(() => validate(parse_wbs('---\nmodule: m\nattach: PH/X\nlevels: foo\n---\n'), 'pl'), (e) => e instanceof PyCrash);
  const empty = validate(parse_wbs(''), 'pl');
  assert.deepEqual(empty, { ok: false, errors: ['frontmatter levels 가 없습니다 — 단계 선언은 frontmatter 에서만 한다.'], warnings: [], counts: new Map() });
});

// CLI: 임시 폴더에 문서를 두고 node 로 직접 실행
const cliDir = makeTempDir('nlevel-cli-');
after(() => fs.rmSync(cliDir, { recursive: true, force: true }));
const cli = (args) => runNodeCase(args, { cwd: cliDir });

test('CLI: validate 출력 모양(indent=1, 한글 그대로)·종료 코드', () => {
  writeDocs(cliDir, { 'pl.md': PL_MD, 'bad.md': PL_MD.replace('## SUB-OP-IN: 입측', '## ZZZ-1: 미선언') });
  const ok = cli(['validate', '--wbs', 'pl.md']);
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, '');
  assert.ok(ok.stdout.startsWith('{\n "ok": true,\n "errors": [],\n "warnings": ['));
  assert.ok(ok.stdout.endsWith('\n}\n'));
  assert.ok(ok.stdout.includes('"counts": {\n  "Subsystem": 1,'));
  const bad = cli(['validate', '--wbs', 'bad.md']);
  assert.equal(bad.status, 1);
  assert.ok(bad.stdout.includes('미선언 접두어: ZZZ-1'));
  // --role skeleton 은 PL 전용 검사(attach·module·골격 층 본문 금지)를 하지 않는다
  assert.equal(cli(['validate', '--wbs', 'pl.md', '--role', 'skeleton']).status, 0);
});

test('CLI: export 는 두 번 돌려도 byte 동일, 오류 문서는 stdout 비고 stderr 에 검증 JSON', () => {
  writeDocs(cliDir, { 'pl.md': PL_MD, 'bad.md': PL_MD.replace('## SUB-OP-IN: 입측', '## ZZZ-1: 미선언') });
  const a = cli(['export', '--wbs', 'pl.md', '--attach-ref', 'mes-skel/SYS-OP']);
  const b = cli(['export', '--wbs', 'pl.md', '--attach-ref', 'mes-skel/SYS-OP']);
  assert.equal(a.status, 0);
  assert.equal(a.stderr, '');
  assert.equal(a.stdout, b.stdout);
  const payload = JSON.parse(a.stdout);
  assert.equal(payload.schema_version, '2.2');
  assert.equal(payload.attach_ref, 'mes-skel/SYS-OP');
  assert.deepEqual(Object.keys(payload), ['schema_version', 'module', 'levels', 'nodes', 'attach_ref']);
  assert.ok(a.stdout.includes('"schedule": "2026-11-14 ~ 2026-11-14"'));
  const bad = cli(['export', '--wbs', 'bad.md', '--attach-ref', 'x/y']);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.ok(JSON.parse(bad.stderr).errors.length > 0);
});

test('CLI: attach 인데 attach_ref 를 못 만들면 종료 코드 1 과 안내 문구', () => {
  writeDocs(cliDir, {
    'pl.md': PL_MD,
    'skel-nomodule.md': '---\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n---\n',
    'skel.md': PL_MD.replace('module: mes-op', 'module: mes-skel'),
  });
  const none = cli(['export', '--wbs', 'pl.md']);
  assert.equal(none.status, 1);
  assert.equal(none.stdout, '');
  assert.equal(none.stderr, 'attach 파일인데 attach_ref 를 조립할 수 없습니다 — --attach-ref 또는 --skeleton 필요.\n');
  const nomod = cli(['export', '--wbs', 'pl.md', '--skeleton', 'skel-nomodule.md']);
  assert.equal(nomod.status, 1);
  assert.equal(nomod.stderr, '골격 파일에 module 이 없습니다.\n');
  const ok = cli(['export', '--wbs', 'pl.md', '--skeleton', 'skel.md']);
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).attach_ref, 'mes-skel/SYS-OP');
});

test('CLI: python 이 죽는 입력은 종료 코드 1·stdout 빔 (w:1.2.3 은 node 판이 검증 게이트에서 먼저 거부한다)', () => {
  writeDocs(cliDir, { 'w.md': PL_MD.replace('w:5', 'w:1.2.3') });
  const r = cli(['export', '--wbs', 'w.md', '--attach-ref', 'a/b']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  // python 판은 float 변환에서 Traceback(ValueError)이었다. import 사전 검사가 있는 node 판은 validate 의 JSON 오류를 낸다.
  assert.match(r.stderr, /w:1\.2\.3 는 숫자가 아님/);
  const miss = cli(['validate', '--wbs', 'nope.md']);
  assert.equal(miss.status, 1);
  assert.match(miss.stderr, /FileNotFoundError: \[Errno 2\] No such file or directory: 'nope\.md'\n$/);
});

test('CLI: 사용 오류는 종료 코드 2 (stdout 비어 있음)', () => {
  for (const c of USAGE_CASES) {
    const r = cli(c.args);
    assert.equal(r.status, 2, c.id);
    assert.equal(r.stdout, '', c.id);
  }
});

test('main(): 인자 해석 후 종료 코드를 돌려준다(process.exit 안 부름)', () => {
  const saved = process.exitCode;
  const w = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = (s) => { out += s; return true; };
  try {
    writeDocs(cliDir, { 'pl.md': PL_MD });
    const prev = process.cwd();
    process.chdir(cliDir);
    try {
      assert.equal(main(['validate', '--wbs', 'pl.md']), 0);
    } finally {
      process.chdir(prev);
    }
  } finally {
    process.stdout.write = w;
    process.exitCode = saved;
  }
  assert.ok(out.startsWith('{\n "ok": true'));
});

test('이식 후 호출 문서에 python 호출이 남지 않았다', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const contract = fs.readFileSync(path.join(SKILL, 'references', 'wbs-nlevel-md-contract.md'), 'utf8');
  assert.ok(!/wbs-nlevel-parse\.py/.test(skill));
  assert.ok(!/wbs-nlevel-parse\.py/.test(contract));
  assert.ok(!/pytest 18건/.test(contract));
  assert.ok(skill.includes('node .claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.mjs validate'));
  assert.ok(!fs.existsSync(path.join(SKILL, 'scripts', 'wbs-nlevel-parse.py')));
  assert.ok(!fs.existsSync(path.join(SKILL, 'scripts', 'test_wbs_nlevel_parse.py')));
});

// ---- 3) 합성 입력 실행(node) — 기대값 비교와 골든 비교가 같은 결과를 쓴다 -------------

const synth = buildSynthetic();
const synthBase = makeTempDir('nlevel-synth-');
after(() => fs.rmSync(synthBase, { recursive: true, force: true }));
const allCases = [
  ...synth.cases.map((c) => ({ ...c, usage: false })),
  ...USAGE_CASES.map((c) => ({ ...c, usage: true })),
];
const nodeResults = new Map();
const nodeRaw = new Map();
before(() => {
  writeDocs(synthBase, synth.files);
  for (const c of allCases) {
    const raw = runNodeCase(c.args, { cwd: synthBase });
    nodeRaw.set(c.id, raw);
    nodeResults.set(c.id, normResult(raw, { usageCase: c.usage }));
  }
});

test('합성 입력: 케이스 id 가 겹치지 않고 export 성공·실패가 모두 충분히 있다', () => {
  assert.equal(new Set(allCases.map((c) => c.id)).size, allCases.length);
  const exp = allCases.filter((c) => c.args[0] === 'export');
  const okCount = exp.filter((c) => nodeResults.get(c.id).status === 0).length;
  assert.ok(okCount >= 80, `export 성공 케이스 ${okCount}건 — 입력이 너무 적게 통과한다`);
  assert.ok(exp.length - okCount >= 80);
});

test('합성 입력: export 는 두 번 돌려도 byte 동일', () => {
  for (const c of allCases) {
    if (c.args[0] !== 'export' || nodeResults.get(c.id).status !== 0) continue;
    const again = normResult(runNodeCase(c.args, { cwd: synthBase }));
    assert.equal(again.stdout, nodeResults.get(c.id).stdout, c.id);
  }
});

// ---- 4) 기대값(python 으로 미리 계산) 비교 — python 이 없어도 돈다 ----------------

test('기대값 파일(python legacy 로 생성)과 node 판 결과가 모든 합성 케이스에서 같다', () => {
  assert.ok(fs.existsSync(EXPECTED), 'tests/golden/expected/parse.json 이 없음 — make-expected.mjs 로 만든다');
  const expected = readJson(EXPECTED);
  assert.equal(Object.keys(expected).length, allCases.length, `기대값 ${Object.keys(expected).length}건 ≠ 케이스 ${allCases.length}건 — make-expected.mjs 를 다시 돌린다`);
  const bad = [];
  let rejected = 0;
  for (const c of allCases) {
    const e = expected[c.id];
    const n = nodeResults.get(c.id);
    if (!e) { bad.push(`${c.id}: 기대값 없음`); continue; }
    if (c.usage) {
      if (e.status !== n.status) bad.push(`${c.id}: status ${e.status} ≠ ${n.status}`);
      continue;
    }
    const issues = importCompatIssues(c.args, synthBase);
    if (issues.length) { // 새 검사가 거부하는 케이스 — python 기대값과 비교하지 않는다
      rejected += 1;
      try { assertRejected(assert, c.id, issues, nodeRaw.get(c.id)); } catch (err) { bad.push(err.message); }
      continue;
    }
    if (e.status !== n.status || e.stdout !== n.stdout || e.stderr !== n.stderr) bad.push(`${c.id}: status ${e.status}/${n.status}`);
  }
  assert.deepEqual(bad, []);
  assert.equal(rejected, REJECTED_SYNTH, `새 검사 분기 케이스 ${rejected}건 ≠ ${REJECTED_SYNTH} — 예상 밖 케이스가 비교에서 빠지지 않았는지 확인한다`);
});

// ---- 5) 골든 비교: python legacy 와 node 판 ------------------------------------

test('골든: legacy python 단위 시험(19건)이 동결 사본에서 그대로 통과한다', { skip: noPy }, () => {
  const r = env.python([env.script('test_wbs_nlevel_parse.py')], { cwd: env.dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Ran 19 tests/);
  assert.match(r.stderr, /OK/);
});

test('골든: 합성 입력 전 케이스(문서 × 명령, 골격·옵션·파일 문제)가 python 판과 같다', { skip: noPy }, () => {
  const diffs = [];
  const lastLine = (s) => s.trimEnd().split('\n').pop();
  let tracebacks = 0;
  let rejected = 0;
  for (const c of allCases) {
    const issues = c.usage ? [] : importCompatIssues(c.args, synthBase);
    if (issues.length) { // 새 검사가 거부하는 케이스 — python 비교 대신 거부 여부와 이슈 문장만 본다
      rejected += 1;
      try { assertRejected(assert, c.id, issues, nodeRaw.get(c.id)); } catch (err) { diffs.push(err.message); }
      continue;
    }
    const raw = runPythonCase(env, c.args, { cwd: synthBase });
    const py = normResult(raw, { usageCase: c.usage });
    const nd = nodeResults.get(c.id);
    if (c.usage) {
      if (py.status !== nd.status) diffs.push(`${c.id}: status ${py.status} ≠ ${nd.status}`);
      continue;
    }
    if (py.status !== nd.status) diffs.push(`${c.id}: status python ${py.status} ≠ node ${nd.status}`);
    else if (py.stdout !== nd.stdout) diffs.push(`${c.id}: stdout 다름 (python ${py.stdout.length}자 / node ${nd.stdout.length}자)`);
    else if (py.stderr !== nd.stderr) diffs.push(`${c.id}: stderr 다름\n  python: ${JSON.stringify(py.stderr.slice(0, 200))}\n  node:   ${JSON.stringify(nd.stderr.slice(0, 200))}`);
    // python 이 traceback 으로 죽는 입력: 마지막 줄(예외 이름·메시지)도 본다. UnicodeDecodeError·AttributeError·TypeError 는 문구가 python 내부 표현이라 이름만 본다.
    if (raw.stderr.startsWith('Traceback')) {
      tracebacks += 1;
      const a = lastLine(raw.stderr);
      const b = lastLine(nodeRaw.get(c.id).stderr);
      if (/^(UnicodeDecodeError|AttributeError|TypeError)/.test(a)) {
        if (a.split(':')[0] !== b.split(':')[0]) diffs.push(`${c.id}: 예외 이름 ${a} ≠ ${b}`);
      } else if (a !== b) diffs.push(`${c.id}: 예외 줄 python ${a} ≠ node ${b}`);
    }
  }
  assert.deepEqual(diffs, []);
  assert.equal(rejected, REJECTED_SYNTH, `새 검사 분기 케이스 ${rejected}건 ≠ ${REJECTED_SYNTH}`);
  assert.ok(tracebacks >= 30, `traceback 케이스 ${tracebacks}건`);
});

test('골든: 리포의 실제 문서 — 스킬 references 와 docs/**/wbs*.md 전수(validate 3종 + export 2종, export 두 번 동일)', { skip: noPy }, () => {
  const real = [path.join(SKILL, 'references', 'skeleton-sample.md')];
  for (const p of walkSorted(path.join(REPO, 'docs'), { extensions: ['.md'] })) {
    if (path.basename(p).toLowerCase().startsWith('wbs')) real.push(p);
  }
  // D-Flow 정본 리포에는 docs/**/wbs*.md 가 없다 — 그때는 스킬 references 사본 한 건만 비교한다.
  assert.ok(real.length >= 1, `실제 문서 ${real.length}건`);
  const diffs = [];
  let runs = 0;
  for (const f of real) {
    const cmds = [
      ['validate', '--wbs', f, '--role', 'pl'], ['validate', '--wbs', f, '--role', 'skeleton'], ['validate', '--wbs', f],
      ['export', '--wbs', f], ['export', '--wbs', f, '--attach-ref', 'mes-skel/SYS-OP'], ['export', '--wbs', f, '--skeleton', f],
    ];
    for (const args of cmds) {
      const py = normResult(runPythonCase(env, args, { cwd: REPO }));
      const nd = normResult(runNodeCase(args, { cwd: REPO }));
      runs += 1;
      if (py.status !== nd.status || py.stdout !== nd.stdout || py.stderr !== nd.stderr) diffs.push(`${path.relative(REPO, f)} ${args[0]} ${args.slice(2).join(' ')}`);
      if (args[0] === 'export' && nd.status === 0) assert.equal(normResult(runNodeCase(args, { cwd: REPO })).stdout, nd.stdout, `재실행 ${f}`);
    }
  }
  assert.deepEqual(diffs, [], `${runs}건 비교`);
});

for (const [label, gen, seeds] of [
  ['줄 섞기', randomLineDocs, [11, 12]],
  ['검증 통과 트리', treeDocs, [21, 22]],
]) {
  test(`골든: 시드 고정 무작위 문서 — ${label}(2시드 × 25문서 × 3명령)`, { skip: noPy }, () => {
    const dir = makeTempDir('nlevel-fuzz-');
    try {
      const diffs = [];
      let exportOk = 0;
      let rejected = 0;
      for (const seed of seeds) {
        const { files, cases } = gen(seed, 25);
        writeDocs(dir, files);
        for (const c of cases) {
          const issues = importCompatIssues(c.args, dir);
          if (issues.length) { // 새 검사가 거부하는 케이스 — python 비교 대신 거부 여부와 이슈 문장만 본다
            rejected += 1;
            try { assertRejected(assert, `seed ${seed} ${c.id}`, issues, runNodeCase(c.args, { cwd: dir })); } catch (err) { diffs.push(err.message); }
            continue;
          }
          const py = normResult(runPythonCase(env, c.args, { cwd: dir }));
          const nd = normResult(runNodeCase(c.args, { cwd: dir }));
          if (c.args[0] === 'export' && py.status === 0) exportOk += 1;
          if (py.status !== nd.status || py.stdout !== nd.stdout || py.stderr !== nd.stderr) diffs.push(`seed ${seed} ${c.id}`);
        }
      }
      assert.deepEqual(diffs, []);
      assert.equal(rejected, REJECTED_FUZZ[label], `${label}: 새 검사 분기 케이스 ${rejected}건 ≠ ${REJECTED_FUZZ[label]}`);
      if (label === '검증 통과 트리') assert.ok(exportOk >= 60, `export 성공 ${exportOk}건 — 생성기가 너무 많이 막힘`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
