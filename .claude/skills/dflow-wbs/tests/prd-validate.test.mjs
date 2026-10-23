// prd-validate.mjs 시험. python 원본(tests/golden/legacy/prd-validate.legacy.py)에는 단위 시험이 없어(실제 호출로만 덮임) 새로 쓴다.
//  1) 단위 시험: 검출 함수를 직접 불러 줄 번호·context 자르기·정량 힌트·섹션 별칭을 확인한다.
//  2) 골든 비교: prd-cases.mjs 의 경계 사례(빈 파일·CRLF·BOM·한글·섹션 누락·펜스 코드 블록 …)를 python legacy 와 node 판이
//     같은 입력으로 돌려 stdout·stderr·종료 코드를 비교한다(python 이 없으면 skip).
//  3) 실제 문서 전수: 리포의 docs/**/PRD.md·TRD.md 를 모두 찾아(기본·확장 필수 절 두 번씩) 비교하고,
//     리포의 다른 마크다운(docs·.claude/skills)도 일정 간격으로 뽑아 비교한다(읽기 전용이라 입력만 쓴다).
//  4) 기대값 비교: tests/golden/expected/prd-validate.json(python 으로 미리 계산) 과 node 판 결과 비교 — python 이 없는 PC 에서도 돈다.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNode } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import { walkSorted, toPosix } from '../../_shared/node/paths.mjs';
import {
  ASSUMPTIONS_TEMPLATE, DEFAULT_REQUIRED_SECTIONS, QUANT_HINT_RE, SECTION_ALIASES, VAGUE_TERMS, assumptions_template,
  find_missing_sections, find_placeholders, find_vague_metrics, validate_file,
} from '../scripts/prd-validate.mjs';
import { legacyEnv } from './legacy-env-decision-prd.mjs';
import { CASES, fromNode } from './prd-cases.mjs';
import { diffResults, makeRoot, runCase } from './case-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'prd-validate.mjs');
const EXPECTED = path.join(HERE, 'golden', 'expected', 'prd-validate.json');
const REPO = path.join(HERE, '..', '..', '..', '..');

const env = legacyEnv();
const roots = [];
after(() => {
  env.cleanup();
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const nodeRunner = (args, cwd) => runNode(SCRIPT, args, { cwd, normalizeEol: true });
const pyRunner = (args, cwd) => env.python([env.script('prd-validate.py'), ...args], { cwd });
const nodeOpts = { fix: (t) => fromNode(t) };

// ---- 1) 단위 시험 ------------------------------------------------------------

test('find_placeholders: 패턴 순서·위치 순서·줄 번호·context', () => {
  const r = find_placeholders('ok\n  TBD 와 ??? 와 <FOO_BAR> 와 todo  \n');
  assert.deepEqual(r, [
    { type: 'placeholder', label: 'TBD', line: 2, match: 'TBD', context: 'TBD 와 ??? 와 <FOO_BAR> 와 todo' },
    { type: 'placeholder', label: 'TODO', line: 2, match: 'todo', context: 'TBD 와 ??? 와 <FOO_BAR> 와 todo' },
    { type: 'placeholder', label: '???', line: 2, match: '???', context: 'TBD 와 ??? 와 <FOO_BAR> 와 todo' },
    { type: 'placeholder', label: '<PLACEHOLDER>', line: 2, match: '<FOO_BAR>', context: 'TBD 와 ??? 와 <FOO_BAR> 와 todo' },
  ]);
  assert.deepEqual(find_placeholders(''), []);
});

test('find_placeholders: 유니코드 단어 경계(한글·밑줄·숫자가 붙으면 아님)', () => {
  const n = (s) => find_placeholders(s).length;
  assert.equal(n('한TBD'), 0);
  assert.equal(n('TBD한'), 0);
  assert.equal(n('TBD_'), 0);
  assert.equal(n('1TBD'), 0);
  assert.equal(n('TBDs'), 0);
  assert.equal(n('(TBD)'), 1);
  assert.equal(n('tbd.'), 1);
  assert.equal(n('ＴＢＤ'), 0);
  assert.equal(n('TBD TBD'), 2);
});

test('find_placeholders: ??? 는 3개 이상 연속을 한 번에, <…> 는 3자 이상', () => {
  assert.deepEqual(find_placeholders('????? ??').map((x) => x.match), ['?????']);
  assert.deepEqual(find_placeholders('<ABC> <AB> <a_b> <A B C> <A_> <A__>').map((x) => x.match), ['<ABC>', '<A B C>', '<A__>']);
});

test('find_placeholders: context 는 strip 후 120 코드포인트, 줄 번호는 splitlines 기준', () => {
  const r = find_placeholders(`${'😀'.repeat(130)} TBD`);
  assert.equal(r.length, 1);
  assert.equal(Array.from(r[0].context).length, 120);
  assert.equal(r[0].context, '😀'.repeat(120));
  const s = find_placeholders('a\x0bTBD\x0cb\nTBD');
  assert.deepEqual(s.map((x) => x.line), [2, 4]);
  assert.equal(find_placeholders('\t　TBD　\t')[0].context, 'TBD');
});

test('find_vague_metrics: 줄마다 목록 앞쪽 용어 하나, 대소문자 무시, match 는 원문 조각', () => {
  assert.deepEqual(find_vague_metrics('A Fast app\nok\n빠른 응답'), [
    { type: 'vague_metric', term: 'fast', line: 1, match: 'Fast', context: 'A Fast app' },
    { type: 'vague_metric', term: '빠른', line: 3, match: '빠른', context: '빠른 응답' },
  ]);
  assert.equal(find_vague_metrics('easy 와 fast').length, 1);
  assert.equal(find_vague_metrics('easy 와 fast')[0].term, 'fast'); // 목록에서 fast 가 easy 보다 앞
});

test('find_vague_metrics: 정량 힌트가 있는 줄은 건너뜀', () => {
  assert.equal(find_vague_metrics('fast 100ms').length, 0);
  assert.equal(find_vague_metrics('fast 5 users').length, 0);
  assert.equal(find_vague_metrics('fast 100').length, 1);
  assert.equal(find_vague_metrics('fast 99%x').length, 0); // % 뒤에 단어 문자가 붙어야 \b 가 맞는다
  assert.equal(find_vague_metrics('fast 99% 가량').length, 1);
  assert.equal(find_vague_metrics('fast ٣ ms').length, 0); // 유니코드 숫자
});

test('find_vague_metrics: lower() 길이가 달라지는 İ 는 python 처럼 위치가 어긋난 조각을 낸다', () => {
  // 'İ'.lower() 는 2 코드포인트라 lower 안의 위치가 원문보다 1 크다 → 원문에서 한 칸 뒤부터 용어 길이만큼 잘라 낸다('fast' 가 아닌 'ast')
  const r = find_vague_metrics('İ fast');
  assert.equal(r.length, 1);
  assert.equal(r[0].match, 'ast');
});

test('find_vague_metrics: 비 BMP 문자 뒤에서도 코드포인트 위치로 자른다', () => {
  const r = find_vague_metrics('😀😀 fast 😀');
  assert.equal(r[0].match, 'fast');
  assert.equal(r[0].context, '😀😀 fast 😀');
});

test('QUANT_HINT_RE: 단위 목록과 경계', () => {
  for (const ok of ['100ms', '5 s', '5 sec', '5 seconds', '2 hours', '5 p99', '10MB', '100 req/s', '100 req', '3 kgs', '1 user', '10 MAU', '99%x', '٣ ms', '5 MS']) {
    assert.ok(QUANT_HINT_RE.test(ok), ok);
  }
  for (const no of ['100', 'p99', 'ms', 'x100ms', '100msx', '5 reqs', '99%', '99% 가량', '5 u']) {
    assert.ok(!QUANT_HINT_RE.test(no), no);
  }
});

test('find_missing_sections: 별칭·대소문자·한글·사용자 지정 리터럴', () => {
  const doc = '# t\n## ACCEPTANCE   criteria\n### 비 기능 요구 항목\n#### 제약 조건\n';
  assert.deepEqual(find_missing_sections(doc, DEFAULT_REQUIRED_SECTIONS), []);
  assert.deepEqual(find_missing_sections('# t\n', ['glossary', 'x y']), [
    { type: 'missing_section', section: 'glossary' },
    { type: 'missing_section', section: 'x y' },
  ]);
  assert.deepEqual(find_missing_sections('## C++x\n', ['C++']), []); // 끝이 구두점이면 뒤에 단어 문자가 붙어야 \\b 가 맞는다
  assert.deepEqual(find_missing_sections('## C++ plan\n', ['C++']), [{ type: 'missing_section', section: 'C++' }]);
  assert.deepEqual(find_missing_sections('## a.b\n## axb\n', ['a.b']), []);
  assert.deepEqual(find_missing_sections('## axb\n', ['a.b']), [{ type: 'missing_section', section: 'a.b' }]);
  assert.deepEqual(find_missing_sections('', []), []);
});

test('find_missing_sections: 머리글 모양(레벨 1~6·# 뒤 공백 필수·줄 시작)', () => {
  const miss = (d, k = 'constraints') => find_missing_sections(d, [k]).length;
  assert.equal(miss('###### Constraints'), 0);
  assert.equal(miss('####### Constraints'), 1);
  assert.equal(miss('#Constraints'), 1);
  assert.equal(miss(' ## Constraints'), 1);
  assert.equal(miss('Constraints'), 1);
  assert.equal(miss('#\n\nConstraints'), 0); // \s+ 가 줄바꿈을 먹는다
  assert.equal(miss('## 제약사항입니다'), 1); // 뒤에 글자가 붙으면 \b 가 안 맞는다
  assert.equal(miss('## 비기능 요구사항', 'non-functional requirements'), 1);
  assert.equal(miss('## 비기능 요구', 'non-functional requirements'), 0);
  assert.equal(miss('## NFRs', 'non-functional requirements'), 1);
  assert.equal(miss('﻿## Constraints'), 1); // 앞 BOM 때문에 줄 시작이 아니다
  assert.equal(miss('x\r## Constraints'), 1);
});

test('SECTION_ALIASES: 정의된 이름', () => {
  assert.deepEqual(Object.keys(SECTION_ALIASES), ['acceptance criteria', 'non-functional requirements', 'constraints', 'glossary']);
  assert.equal(VAGUE_TERMS.length, 23);
  assert.deepEqual(DEFAULT_REQUIRED_SECTIONS, ['acceptance criteria', 'non-functional requirements', 'constraints']);
});

test('validate_file: 없는 파일·폴더는 오류 JSON, 있으면 요약', () => {
  const root = makeRoot('prd-unit-');
  roots.push(root);
  const f = path.join(root, 'p.md');
  fs.writeFileSync(f, '# t\nTBD fast\n');
  assert.deepEqual(validate_file(path.join(root, 'none.md'), []), { ok: false, error: `file not found: ${path.join(root, 'none.md')}`, issues: [] });
  assert.equal(validate_file(root, []).ok, false);
  const r = validate_file(f, ['glossary']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.summary, { placeholder_count: 1, vague_count: 1, missing_section_count: 1, total: 3 });
  assert.deepEqual(r.issues.map((i) => i.type), ['placeholder', 'vague_metric', 'missing_section']);
  assert.equal(validate_file(f, []).summary.total, 2);
  fs.writeFileSync(f, '# t\n');
  assert.equal(validate_file(f, []).ok, true);
});

test('assumptions_template: 날짜 자리·내용', () => {
  const t = assumptions_template();
  assert.match(t, /^## Assumptions \(auto-resolved \d{4}-\d{2}-\d{2}\)\n\n> 이 섹션은/);
  assert.ok(t.endsWith('- (placeholder) 보강된 가정을 한 줄씩 기록\n'));
  assert.ok(!t.includes('{date}'));
  assert.ok(ASSUMPTIONS_TEMPLATE.includes('{date}'));
  assert.ok(t.includes('node .claude/skills/dflow-wbs/scripts/decision-log.mjs list --target docs'));
  assert.ok(!t.includes('.py'));
});

// ---- 2) 골든 비교 ------------------------------------------------------------

for (const c of CASES) {
  test(`골든: ${c.id}`, (t) => {
    if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
    const py = runCase(c, pyRunner);
    const nd = runCase(c, nodeRunner, nodeOpts);
    const diffs = diffResults(py, nd, ['python', 'node']);
    assert.deepEqual(diffs, [], diffs.join('\n'));
  });
}

// ---- 3) 실제 문서 전수 ---------------------------------------------------------

const SKIP = ['node_modules', '.git', 'graphify-out', 'tests'];
function collect(root, pred) {
  return walkSorted(path.join(REPO, root), { skipDirs: SKIP, extensions: ['.md'] }).filter(pred);
}
const rel = (p) => toPosix(path.relative(REPO, p));

function compareFile(t, file, extra = []) {
  if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
  const args = ['validate', '--target', file, ...extra];
  const a = pyRunner(args, REPO);
  const b = nodeRunner(args, REPO);
  assert.equal(b.status, a.status, `${rel(file)} 종료 코드`);
  assert.equal(b.stdout, a.stdout, `${rel(file)} stdout`);
  assert.equal(b.stderr, a.stderr, `${rel(file)} stderr`);
}

const prdTrd = [...collect('docs', (p) => /^(PRD|TRD)\.md$/i.test(path.basename(p))), ...collect('.claude', (p) => /^(PRD|TRD)\.md$/i.test(path.basename(p)))];

test('실제 리포에 PRD.md·TRD.md 가 있다', { skip: prdTrd.length === 0 && '이 리포에 실제 문서가 없다(D-Flow 정본 리포 — 실제 문서 비교는 스킬을 설치한 리포에서 돈다)' }, () => {
  assert.ok(prdTrd.length >= 2, `찾은 PRD·TRD: ${prdTrd.length}`);
});

for (const f of prdTrd) {
  test(`실제 문서 전수: ${rel(f)}`, (t) => {
    compareFile(t, f);
    compareFile(t, f, ['--required-sections', 'acceptance criteria,non-functional requirements,constraints,glossary']);
    compareFile(t, f, ['--required-sections', 'acceptance criteria,NFR,constraints']);
  });
}

// 다른 마크다운 문서에서 일정 간격으로 뽑는다(전체를 돌리면 오래 걸린다). 같은 리포 상태면 항상 같은 표본이다.
const corpus = [...collect('docs', () => true), ...collect('.claude/skills', () => true)];
const STRIDE = Math.max(1, Math.ceil(corpus.length / 100));
const sample = corpus.filter((_, i) => i % STRIDE === 0);

test(`실제 마크다운 표본(${sample.length}개/${corpus.length}개, 간격 ${STRIDE})`, (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
  const bad = [];
  for (const f of sample) {
    const args = ['validate', '--target', f];
    const a = pyRunner(args, REPO);
    const b = nodeRunner(args, REPO);
    if (a.status !== b.status || a.stdout !== b.stdout || a.stderr !== b.stderr) bad.push(rel(f));
  }
  assert.deepEqual(bad, [], `python 판과 다른 문서: ${bad.join(', ')}`);
});

// ---- 4) 기대값 비교(python 없이도 돈다) ----------------------------------------

// 기대값 파일은 고객 문서 사본의 결과를 담아 공개 리포(D-Flow)에는 두지 않는다 — 없으면 이 절을 건너뛴다.
const expected = fs.existsSync(EXPECTED) ? readJson(EXPECTED) : null;
const NO_EXPECTED = expected === null && `${EXPECTED} 가 없다(공개 리포에는 두지 않는다)`;

test('기대값 파일이 사례 목록과 일치(사례를 바꿨으면 make-expected-decision-prd.mjs 를 다시 돌린다)', { skip: NO_EXPECTED }, () => {
  assert.deepEqual(Object.keys(expected), CASES.map((c) => c.id));
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length, '사례 id 중복');
});

for (const c of CASES) {
  test(`기대값: ${c.id}`, { skip: NO_EXPECTED }, () => {
    const nd = runCase(c, nodeRunner, nodeOpts);
    const diffs = diffResults(expected[c.id], nd, ['python 기대값', 'node']);
    assert.deepEqual(diffs, [], diffs.join('\n'));
  });
}
