// wbs-validate.mjs 의 import 사전 검사 시험 — D'Flow POST /wbs/import 의 toRpcNode 거부 조건을 미리 잡는지 본다.
// 이 검사는 python 원본(wbs-validate.py)에 없던 것이라 golden 비교와 별개로 둔다.
// 기준: wbs-web src/lib/agent/wbsImport.ts (priority 4종, schedule 형식, id·title 필수, stage 허용값).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, runNode } from '../../_shared/node/proc.mjs';
import { validate_wbs, _schedule_problem, IMPORT_PRIORITIES } from '../scripts/wbs-validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'wbs-validate.mjs');

const IMPORT_TYPES = ['missing_title', 'invalid_priority', 'invalid_schedule', 'invalid_status'];

/** 정상 Task 한 건. extra 줄을 메타에 더한다. */
const wbs = (extraMeta = '', heading = '### TSK-01-01: 로그인 API') => `\
# WBS

## WP-01: 인증

${heading}
- domain: backend
- depends: -
- status: [ ]
- acceptance: 로그인 응답 200ms 이하
${extraMeta}
`;

const importIssues = (content) => validate_wbs(content).issues.filter((i) => IMPORT_TYPES.includes(i.type));
const types = (content) => importIssues(content).map((i) => i.type);

test('정상 Task 는 import 사전 검사에 걸리지 않는다', () => {
  assert.deepEqual(importIssues(wbs()), []);
  assert.equal(validate_wbs(wbs()).ok, true);
});

test('priority: 4종은 통과, 그 밖은 invalid_priority, 빈 값과 - 는 미지정', () => {
  for (const p of IMPORT_PRIORITIES) assert.deepEqual(types(wbs(`- priority: ${p}`)), [], p);
  for (const bad of ['P1', 'urgent', 'High', '1', '50']) {
    const iss = importIssues(wbs(`- priority: ${bad}`));
    assert.deepEqual(iss.map((i) => i.type), ['invalid_priority'], bad);
    assert.equal(iss[0].task, 'TSK-01-01');
    assert.match(iss[0].detail, /critical\|high\|medium\|low/);
  }
  assert.deepEqual(types(wbs('- priority: -')), []);
  assert.deepEqual(types(wbs('- priority:')), []);
});

test('priority: 뒤에 주석이 붙은 값도 거부한다(export 가 줄 전체를 값으로 읽는다)', () => {
  assert.deepEqual(types(wbs('- priority: high  # 급함')), ['invalid_priority']);
});

test('schedule: 허용 형식 둘은 통과', () => {
  for (const s of ['2026-09-01 ~ 2026-09-30', '2026-09-01~2026-09-30', '~ 2026-09-30', '~2026-09-30', '-', '']) {
    assert.deepEqual(types(wbs(`- schedule: ${s}`)), [], JSON.stringify(s));
  }
});

test('schedule: 형식 오류와 없는 날짜는 invalid_schedule', () => {
  for (const s of ['2026-09-01', '2026-09-01 ~', '9/1 ~ 9/30', '2026-09-01 ~ 2026-09-30 (2주)', '2026-09-01 - 2026-09-30',
    '2026-13-01 ~ 2026-13-02', '2026-02-30 ~ 2026-03-01', '~ 2026-04-31', '2026-9-1 ~ 2026-9-30']) {
    const iss = importIssues(wbs(`- schedule: ${s}`));
    assert.deepEqual(iss.map((i) => i.type), ['invalid_schedule'], s);
    assert.match(iss[0].detail, /schedule/);
  }
  assert.deepEqual(types(wbs('- schedule: 2028-02-29 ~ 2028-03-01')), [], '윤일');
  assert.equal(_schedule_problem('2026-09-01 ~ 2026-09-30'), null);
  assert.equal(_schedule_problem(null), null);
});

test('status: export 가 아는 표기만 통과, 모르는 표기는 invalid_status', () => {
  for (const s of ['[ ]', '[as]', '[fp]', '[ip]', '[im]', '[xx]', '[dd]', '[ts]', '[dd!]', '[im!]']) {
    assert.deepEqual(types(wbs().replace('- status: [ ]', `- status: ${s}`)), [], s);
  }
  for (const s of ['[done]', '[x]', 'xx', '[xx] # 완료', '[ds]']) {
    assert.deepEqual(types(wbs().replace('- status: [ ]', `- status: ${s}`)), ['invalid_status'], s);
  }
  assert.deepEqual(types(wbs().replace('- status: [ ]\n', '')), [], 'status 줄이 없으면 [ ] 로 본다');
});

test('title: Task·WP·ACT 헤딩에 제목이 없으면 missing_title', () => {
  const t = importIssues(wbs('', '### TSK-01-01:'));
  assert.deepEqual(t.map((i) => [i.type, i.task]), [['missing_title', 'TSK-01-01']]);
  const wp = importIssues('# W\n\n## WP-01:\n\n### TSK-01-01: 제목\n- acceptance: 200ms\n');
  assert.deepEqual(wp.map((i) => [i.type, i.task]), [['missing_title', 'WP-01']]);
  const act = importIssues('# W\n\n## WP-01: 가\n\n### ACT-01-01:\n\n#### TSK-01-01: 제목\n- acceptance: 200ms\n');
  assert.deepEqual(act.map((i) => [i.type, i.task]), [['missing_title', 'ACT-01-01']]);
});

test('WP 의 schedule 형식도 본다', () => {
  const ok = '# W\n\n## WP-01: 가\n- schedule: 2026-09-01 ~ 2026-09-30\n\n### TSK-01-01: 제목\n- acceptance: 200ms\n';
  assert.deepEqual(importIssues(ok), []);
  const bad = ok.replace('2026-09-01 ~ 2026-09-30', '9월 중');
  assert.deepEqual(importIssues(bad).map((i) => [i.type, i.task]), [['invalid_schedule', 'WP-01']]);
});

test('펜스 코드 블록 안의 WP·ACT 예시 헤딩은 건너뛴다', () => {
  const doc = wbs() + '\n```markdown\n## WP-99:\n### ACT-99-01:\n```\n';
  assert.deepEqual(importIssues(doc), []);
});

test('같은 블록의 첫 `- 키:` 줄만 읽는다(export 의 get_field 와 같다)', () => {
  assert.deepEqual(types(wbs('- priority: high\n- priority: P1')), []);
  assert.deepEqual(types(wbs('- priority: P1\n- priority: high')), ['invalid_priority']);
});

test('여러 문제는 모두 나열하고 ok 는 false', () => {
  const r = validate_wbs(wbs('- priority: P1\n- schedule: 9월'));
  assert.equal(r.ok, false);
  assert.deepEqual(types(wbs('- priority: P1\n- schedule: 9월')).sort(), ['invalid_priority', 'invalid_schedule']);
  assert.equal(r.summary.invalid_priority, 1);
  assert.equal(r.summary.invalid_schedule, 1);
});

test('CLI: 문제가 있으면 종료 코드 1 과 JSON 이슈, 없으면 0', () => {
  const dir = makeTempDir('validate-import-');
  try {
    fs.writeFileSync(path.join(dir, 'bad.md'), wbs('- priority: P1'));
    fs.writeFileSync(path.join(dir, 'good.md'), wbs('- priority: high\n- schedule: 2026-09-01 ~ 2026-09-30'));
    const bad = runNode(SCRIPT, ['validate', '--wbs', 'bad.md'], { cwd: dir });
    assert.equal(bad.status, 1);
    assert.ok(JSON.parse(bad.stdout).issues.some((i) => i.type === 'invalid_priority'));
    const good = runNode(SCRIPT, ['validate', '--wbs', 'good.md'], { cwd: dir });
    assert.equal(good.status, 0, good.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
