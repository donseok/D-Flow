// wbs-validate.mjs 시험.
//  1) 원본 test_wbs_validate.py 의 모든 케이스를 같은 의미로 옮긴 단위 시험(30건).
//  2) 골든 비교: 같은 입력으로 python legacy 와 node 판을 돌려 stdout·stderr·종료 코드를 비교한다
//     (python 이 없거나 DMES_NO_PYTHON=1 이면 skip). 입력은 validate-cases.mjs 의 경계 입력과 리포의 실제 문서.
//  3) python 이 없어도 도는 보조 시험: 미리 python 으로 계산한 tests/golden/expected/validate.json 과 비교
//     (기대값은 `node dflow-export/tests/make-expected.mjs` 로 다시 만든다).
// 임시 폴더는 모두 makeTempDir 로 만들고 끝나면 지운다.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goldenTest } from '../../_shared/node/golden.mjs';
import { makeTempDir, runNode } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import { walkSorted } from '../../_shared/node/paths.mjs';
import {
  _split_tasks, _parse_meta, _depends_list, _has_acceptance, _check_domain_mapping, validate_wbs, pyPathStr,
} from '../scripts/wbs-validate.mjs';
import { legacyEnv } from './legacy-env.mjs';
import {
  CLEAN_WBS, PROBLEMATIC_WBS, FOURLEVEL_WBS, FENCED_WBS, FENCED_PHANTOM_TASK_WBS, FENCED_INDENTED_WBS,
  UNCLOSED_FENCE_WBS, MISPAIRED_FENCE_WBS, FILES, CLI_CASES,
} from './validate-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'wbs-validate.mjs');
const REPO = path.resolve(HERE, '..', '..', '..', '..');

const base = makeTempDir('wbs-validate-test-');
const env = legacyEnv();
after(() => {
  fs.rmSync(base, { recursive: true, force: true });
  env.cleanup();
});

const run = (args, opts = {}) => runNode(SCRIPT, args, { normalizeEol: true, ...opts });

// ---- 1) 원본 python 단위 시험 이식 -------------------------------------------

test('TestSplitTasks: test_split_clean_wbs', () => {
  const ids = _split_tasks(CLEAN_WBS).map((b) => b.id);
  assert.deepEqual(ids, ['TSK-01-01', 'TSK-01-02']);
});

test('TestSplitTasks: test_split_empty', () => {
  assert.deepEqual(_split_tasks('# Empty WBS\n\n## WP-01\n'), []);
});

test('TestParseMeta: test_basic_meta', () => {
  const block = '### TSK-01-01: x\n- domain: backend\n- depends: TSK-00\n';
  const meta = _parse_meta(block);
  assert.equal(meta.domain, 'backend');
  assert.equal(meta.depends, 'TSK-00');
});

test('TestParseMeta: test_depends_list_split', () => {
  const deps = _depends_list({ depends: 'TSK-01, TSK-02 TSK-03' });
  assert.deepEqual(new Set(deps), new Set(['TSK-01', 'TSK-02', 'TSK-03']));
});

test('TestParseMeta: test_depends_none', () => {
  for (const raw of ['-', 'none', 'n/a', '']) {
    assert.deepEqual(_depends_list({ depends: raw }), []);
  }
});

test('TestAcceptance: test_acceptance_in_meta', () => {
  const block = '### TSK-01-01\n- acceptance: 응답 200ms\n';
  assert.equal(_has_acceptance(block, _parse_meta(block)), true);
});

test('TestAcceptance: test_acceptance_in_subsection', () => {
  const block = '### TSK-01-01\n\n#### Acceptance Criteria\n- response < 200ms\n';
  assert.equal(_has_acceptance(block, _parse_meta(block)), true);
});

test('TestAcceptance: test_no_acceptance', () => {
  const block = '### TSK-01-01\n- domain: backend\n\n본문만 있음.\n';
  assert.equal(_has_acceptance(block, _parse_meta(block)), false);
});

test('TestDomainMapping: test_default_domain_passes', () => {
  assert.equal(_check_domain_mapping('default', null)[0], true);
  assert.equal(_check_domain_mapping('-', null)[0], true);
});

test('TestDomainMapping: test_no_dev_config_passes', () => {
  assert.equal(_check_domain_mapping('frontend', null)[0], true);
});

test('TestDomainMapping: test_unknown_domain_fails', () => {
  const dc = { domains: { backend: {}, frontend: {} } };
  assert.equal(_check_domain_mapping('unknown', dc)[0], false);
});

test('TestDomainMapping: test_known_domain_passes', () => {
  const dc = { domains: { backend: {}, frontend: {} } };
  assert.equal(_check_domain_mapping('frontend', dc)[0], true);
});

test('TestValidateWBS: test_clean_wbs_passes', () => {
  const result = validate_wbs(CLEAN_WBS);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.summary.task_count, 2);
});

test('TestValidateWBS: test_problematic_wbs_detects_all_issues', () => {
  const dc = { domains: { backend: {}, frontend: {} } };
  const result = validate_wbs(PROBLEMATIC_WBS, dc);
  assert.equal(result.ok, false);
  const types = new Set(result.issues.map((i) => i.type));
  assert.ok(types.has('missing_acceptance'));
  assert.ok(types.has('depends_unknown'));
  assert.ok(types.has('test_unmapped'));
});

test('TestFourLevelWBS: test_four_level_tasks_are_detected', () => {
  assert.deepEqual(_split_tasks(FOURLEVEL_WBS).map((b) => b.id), ['TSK-00-01-01', 'TSK-00-01-02', 'TSK-01-01-01']);
});

test('TestFourLevelWBS: test_block_stops_at_lower_or_equal_heading', () => {
  const blocks = Object.fromEntries(_split_tasks(FOURLEVEL_WBS).map((b) => [b.id, b.block]));
  const first = blocks['TSK-00-01-01'];
  assert.ok(first.includes('##### PRD 요구사항')); // 하위 절은 포함
  assert.ok(!first.includes('TSK-00-01-02')); // 다음 Task 는 제외
  const last = blocks['TSK-00-01-02'];
  assert.ok(!last.includes('## WP-01')); // 상위 헤딩에서 닫힘
  assert.ok(!last.includes('ACT-01-01'));
});

test('TestFourLevelWBS: test_depends_resolve_across_acts', () => {
  const result = validate_wbs(FOURLEVEL_WBS);
  assert.equal(result.summary.task_count, 3);
  assert.deepEqual(result.issues.filter((i) => i.type === 'depends_unknown'), []);
});

test('TestFourLevelWBS: test_three_level_block_no_longer_swallows_wp_heading', () => {
  const blocks = Object.fromEntries(_split_tasks(CLEAN_WBS).map((b) => [b.id, b.block]));
  assert.ok(!blocks['TSK-01-02'].includes('## WP-'));
});

test('TestFencedCodeInBlock: test_heading_like_line_inside_fence_does_not_close_block', () => {
  const blocks = Object.fromEntries(_split_tasks(FENCED_WBS).map((b) => [b.id, b.block]));
  const first = blocks['TSK-01-01'];
  assert.ok(first.includes('echo "deploy"')); // 펜스 내부도 포함
  assert.ok(first.includes('acceptance: 헬스체크')); // 펜스 뒤 내용도 포함
  assert.ok(!first.includes('TSK-01-02')); // 다음 Task 는 제외
});

test('TestFencedCodeInBlock: test_fenced_wbs_reports_no_missing_acceptance', () => {
  const types = new Set(validate_wbs(FENCED_WBS).issues.map((i) => i.type));
  assert.ok(!types.has('missing_acceptance'));
});

test('TestFencedCodeInBlock: test_task_heading_text_inside_fence_is_detected_as_visible_task', () => {
  // 의도된 트레이드오프: Task 탐지에는 펜스 필터를 적용하지 않는다(과과다 탐지가 과소 탐지보다 안전).
  const ids = _split_tasks(FENCED_PHANTOM_TASK_WBS).map((b) => b.id);
  assert.deepEqual(ids, ['TSK-01-01', 'TSK-99-99-99', 'TSK-01-02']);
});

test('TestFencedCodeInBlock: test_indented_fence_does_not_close_block', () => {
  const blocks = Object.fromEntries(_split_tasks(FENCED_INDENTED_WBS).map((b) => [b.id, b.block]));
  const first = blocks['TSK-01-01'];
  assert.ok(first.includes('echo "deploy"'));
  assert.ok(first.includes('acceptance: 헬스체크'));
  assert.ok(!first.includes('TSK-01-02'));
});

test('TestFencedCodeInBlock: test_unclosed_fence_does_not_swallow_later_task', () => {
  assert.deepEqual(_split_tasks(UNCLOSED_FENCE_WBS).map((b) => b.id), ['TSK-01-01', 'TSK-01-02']);
});

test('TestFencedCodeInBlock: test_unclosed_fence_task_count_matches_real_headings', () => {
  assert.equal(validate_wbs(UNCLOSED_FENCE_WBS).summary.task_count, 2);
});

test('TestFencedCodeInBlock: test_mispaired_fence_does_not_swallow_tasks_between_markers', () => {
  const blocks = Object.fromEntries(_split_tasks(MISPAIRED_FENCE_WBS).map((b) => [b.id, b.block]));
  assert.deepEqual(Object.keys(blocks), ['TSK-01-01', 'TSK-01-02', 'TSK-01-03']);
  // Task 헤딩은 펜스 상태와 무관하게 항상 경계 후보다 — TSK-01-01 이 TSK-01-02 의 내용을 흡수하면 안 된다.
  assert.ok(!blocks['TSK-01-01'].includes('TSK-01-02'));
});

test('TestFencedCodeInBlock: test_mispaired_fence_does_not_mask_missing_acceptance', () => {
  const noAcceptance = MISPAIRED_FENCE_WBS.replace(
    '- acceptance: 응답 200ms 이하\n\n```bash\n# 닫는 펜스를 빠뜨림',
    '\n```bash\n# 닫는 펜스를 빠뜨림');
  assert.notEqual(noAcceptance, MISPAIRED_FENCE_WBS);
  const missing = validate_wbs(noAcceptance).issues.filter((i) => i.type === 'missing_acceptance');
  assert.deepEqual(missing.map((i) => i.task), ['TSK-01-01']);
});

test('TestCLI: test_cli_validate_clean', () => {
  const dir = fs.mkdtempSync(path.join(base, 'cli-'));
  const p = path.join(dir, 'wbs.md');
  fs.writeFileSync(p, CLEAN_WBS, 'utf8');
  const r = run(['validate', '--wbs', p]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test('TestCLI: test_cli_validate_problematic', () => {
  const dir = fs.mkdtempSync(path.join(base, 'cli-'));
  const p = path.join(dir, 'wbs.md');
  fs.writeFileSync(p, PROBLEMATIC_WBS, 'utf8');
  const dc = JSON.stringify({ domains: { backend: {}, frontend: {} } });
  const r = run(['validate', '--wbs', p, '--dev-config-json', dc]);
  assert.equal(r.status, 1);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.summary.total > 0);
});

test('TestCLI: test_cli_missing_wbs', () => {
  const r = run(['validate', '--wbs', path.join(base, 'nonexistent', 'wbs.md')]);
  assert.equal(r.status, 2);
});

test('TestCLI: test_cli_invalid_dev_config_json', () => {
  const dir = fs.mkdtempSync(path.join(base, 'cli-'));
  const p = path.join(dir, 'wbs.md');
  fs.writeFileSync(p, CLEAN_WBS, 'utf8');
  const r = run(['validate', '--wbs', p, '--dev-config-json', '{not valid']);
  assert.equal(r.status, 2);
});

// ---- 추가: node 판 계약 ------------------------------------------------------

test('출력 키 순서: ok, summary, issues, target 이고 summary 는 유형 뒤에 total·task_count', () => {
  const dir = fs.mkdtempSync(path.join(base, 'cli-'));
  fs.writeFileSync(path.join(dir, 'p.md'), PROBLEMATIC_WBS, 'utf8');
  const r = run(['validate', '--wbs', 'p.md'], { cwd: dir });
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j), ['ok', 'summary', 'issues', 'target']);
  const keys = Object.keys(j.summary);
  assert.deepEqual(keys.slice(-2), ['total', 'task_count']);
  assert.equal(j.target, 'p.md');
  assert.ok(r.stdout.endsWith('}\n'));
});

test('BOM 이 붙은 파일은 BOM 을 지우고 읽는다(python 판과 의도한 차이: 첫 줄이 Task 헤딩이어도 탐지)', () => {
  const dir = fs.mkdtempSync(path.join(base, 'cli-'));
  fs.writeFileSync(path.join(dir, 'b.md'), '﻿### TSK-01-01: 첫 줄\n- acceptance: 1초\n', 'utf8');
  const r = run(['validate', '--wbs', 'b.md'], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).summary.task_count, 1);
});

test('CRLF 파일도 LF 와 같은 결과(줄 번호 포함)', () => {
  const dir = fs.mkdtempSync(path.join(base, 'cli-'));
  fs.writeFileSync(path.join(dir, 'lf.md'), PROBLEMATIC_WBS, 'utf8');
  fs.writeFileSync(path.join(dir, 'crlf.md'), PROBLEMATIC_WBS.replace(/\n/g, '\r\n'), 'utf8');
  const a = JSON.parse(run(['validate', '--wbs', 'lf.md'], { cwd: dir }).stdout);
  const b = JSON.parse(run(['validate', '--wbs', 'crlf.md'], { cwd: dir }).stdout);
  delete a.target;
  delete b.target;
  assert.deepEqual(a, b);
});

test('pyPathStr: pathlib 처럼 정리한다', { skip: process.platform === 'win32' }, () => {
  assert.equal(pyPathStr(''), '.');
  assert.equal(pyPathStr('./a//b/'), 'a/b');
  assert.equal(pyPathStr('/a/./b'), '/a/b');
  assert.equal(pyPathStr('//a'), '//a');
  assert.equal(pyPathStr('///a'), '/a');
  assert.equal(pyPathStr('../a'), '../a');
  assert.equal(pyPathStr('한글/wbs.md'), '한글/wbs.md');
});

// ---- 2) 골든 비교 (python legacy 대 node) -------------------------------------

const work = path.join(base, 'cases');
for (const [name, text] of Object.entries(FILES)) {
  const p = path.join(work, ...name.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

// import 사전 검사(2026-10)로 python 원본에 없던 이슈 유형이 생겼다. headings.md 는 제목이 빈 Task 헤딩을 일부러 담은
// 입력이라 node 판만 missing_title 을 더 낸다 — 그 유형을 빼면 python 결과와 같아야 한다(의도한 차이를 이 두 케이스에 한정).
const IMPORT_ONLY_TYPES = new Set(['missing_title', 'invalid_priority', 'invalid_schedule', 'invalid_status']);
const withoutImportIssues = (stdout) => {
  const j = JSON.parse(stdout);
  j.issues = j.issues.filter((i) => !IMPORT_ONLY_TYPES.has(i.type));
  const summary = {};
  for (const i of j.issues) summary[i.type] = (summary[i.type] ?? 0) + 1;
  summary.total = j.issues.length;
  summary.task_count = j.summary.task_count;
  j.summary = summary;
  j.ok = j.issues.length === 0;
  return j;
};
const importDiffCase = (c) => c.id.startsWith('file headings.md');

const py313 = !!env.pyVersion && (env.pyVersion[0] > 3 || env.pyVersion[1] >= 13);
for (const c of CLI_CASES) {
  if (importDiffCase(c)) {
    test(`golden CLI: ${c.id} (import 전용 이슈 유형을 뺀 결과가 python 과 같다)`, { skip: env.available ? false : 'python3 를 찾지 못해 골든 비교를 건너뜀' }, () => {
      const p = env.python([env.script('wbs-validate.py'), ...c.args], { cwd: work });
      const n = run(c.args, { cwd: work });
      assert.ok(JSON.parse(n.stdout).issues.some((i) => i.type === 'missing_title'), '빈 제목 Task 를 잡아야 함');
      assert.deepEqual(withoutImportIssues(n.stdout), JSON.parse(p.stdout));
      assert.equal(n.status, p.status);
      assert.equal(n.stderr, p.stderr);
    });
    continue;
  }
  const compare = (c.compare ?? ['stdout', 'status', 'stderr']).filter((f) => !(c.pyMsg313 && py313 && f === 'stderr'));
  goldenTest(`golden CLI: ${c.id}`, {
    python: { cmd: [env.script('wbs-validate.py'), ...c.args] },
    node: { script: SCRIPT, args: c.args },
    cwd: work,
    compare,
  });
}

// 실제 리포 문서(WBS 와 펜스가 많은 설계 문서) — 절대 경로로 같은 파일을 양쪽에 준다
function realDocs() {
  const out = [];
  const wbs = path.join(REPO, 'docs', 'mdm', 'wbs.md');
  if (fs.existsSync(wbs)) out.push(wbs);
  const contract = path.join(REPO, '.claude', 'skills', 'dflow-wbs-nlevel', 'references', 'wbs-nlevel-md-contract.md');
  if (fs.existsSync(contract)) out.push(contract);
  for (const sub of ['docs/superpowers', 'docs/mdm', 'docs/guide']) {
    const root = path.join(REPO, ...sub.split('/'));
    if (!fs.existsSync(root)) continue;
    const files = walkSorted(root, { extensions: ['.md'] })
      .map((f) => (path.isAbsolute(f) ? f : path.join(root, f)))
      .filter((f) => fs.statSync(f).size > 3000);
    out.push(...files.slice(0, 8));
  }
  return [...new Set(out)];
}

for (const doc of realDocs()) {
  const rel = path.relative(REPO, doc).split(path.sep).join('/');
  const dc = JSON.stringify({ domains: { backend: {}, frontend: {}, docs: {} } });
  goldenTest(`golden 실제 문서: ${rel}`, {
    python: { cmd: [env.script('wbs-validate.py'), 'validate', '--wbs', doc] },
    node: { script: SCRIPT, args: ['validate', '--wbs', doc] },
  });
  if (rel === 'docs/mdm/wbs.md') {
    goldenTest(`golden 실제 문서 + dev-config: ${rel}`, {
      python: { cmd: [env.script('wbs-validate.py'), 'validate', '--wbs', doc, '--dev-config-json', dc] },
      node: { script: SCRIPT, args: ['validate', '--wbs', doc, '--dev-config-json', dc] },
    });
  }
}

// ---- 3) python 없이 도는 보조 시험: 기대값 파일 비교 --------------------------

const expectedFile = path.join(HERE, 'golden', 'expected', 'validate.json');
const expected = fs.existsSync(expectedFile) ? readJson(expectedFile) : {};

for (const c of CLI_CASES) {
  test(`expected CLI: ${c.id}`, { skip: c.posixOnly && process.platform === 'win32' }, () => {
    const exp = expected[c.id];
    assert.ok(exp, `expected/validate.json 에 케이스가 없음: ${c.id} (make-expected.mjs 로 다시 생성)`);
    const r = run(c.args, { cwd: work });
    if (importDiffCase(c)) {
      assert.deepEqual(withoutImportIssues(r.stdout), JSON.parse(exp.stdout));
      assert.equal(r.status, exp.status);
      return;
    }
    for (const f of c.compare ?? ['stdout', 'status', 'stderr']) {
      assert.equal(r[f], exp[f], `${f} 불일치`);
    }
  });
}
