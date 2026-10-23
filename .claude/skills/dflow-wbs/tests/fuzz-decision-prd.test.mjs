// 무작위(고정 시드) 입력 비교: 정규식·공백·경계 문자 같은 "사람이 놓치기 쉬운 차이"를 python 판과 node 판의 함수를 직접 불러 비교한다.
//  - prd-validate: 무작위 문서 여러 건을 python 한 번(드라이버)으로 검사하고 node 의 validate_file 결과와 JSON 바이트까지 비교.
//  - decision-log: 무작위 decisions.md 를 python 의 list_decisions·validate_decisions·append_decision(시각 고정)에 넣고 node 와 비교
//    (append 는 파일 전체 바이트를 비교).
// 시드가 고정이라 항상 같은 입력이다. python 이 없으면 skip. 어긋나면 첫 불일치 입력을 JSON 으로 보여 준다.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { validate_file } from '../scripts/prd-validate.mjs';
import { append_decision, list_decisions, validate_decisions } from '../scripts/decision-log.mjs';
import { legacyEnv } from './legacy-env-decision-prd.mjs';

// 환경 변수 FUZZ_SEED(시드)·FUZZ_SCALE(건수 배수)로 더 크게 돌려 볼 수 있다(기본은 고정 시드·1배).
const SEED = Number(process.env.FUZZ_SEED ?? 0);
const SCALE = Number(process.env.FUZZ_SCALE ?? 1);
const env = legacyEnv();
const roots = [];
after(() => {
  env.cleanup();
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];

// ---- prd-validate ----------------------------------------------------------

const PRD_TOKENS = [
  'TBD', 'tbd', 'TODO', 'Todo', '???', '????', '??', '<FOO_BAR>', '<ABC>', '<a_b>', '<A B C>', 'fast', 'Fast', 'FAST', 'easy', 'smooth', 'robust',
  '빠른', '빠르게', '쉬운', '사용자 친화', '직관적', '원활', 'high performance', 'low latency', 'user-friendly', 'İ', 'ı', 'ſ', 'K', 'İi',
  '100ms', '5 users', '99%', '99%x', '3 sec', '2 minutes', 'mınutes', 'mİnutes', '5 kg', '100 req/s', 'p99', '5 p99', '٣', '５', 'ms', 'MB', '10MB', '5 ms',
  '#', '##', '###', '######', '#######', '## ', '### ', '#\n\n', 'Acceptance Criteria', 'acceptance criteria', 'ACCEPTANCE　CRITERIA', 'Acceptance   Criteria',
  'crİteria', 'crıteria', 'AcceptanceCriteria', 'Non-functional requirements', 'non functional requirements', 'NFR', 'NFRs', '비기능 요구', '비기능 요구사항',
  '성능/품질/보안', '성능 품질 보안', '수락 기준', '완료조건', '제약 사항', '제약사항', 'Constraints', 'constraint', 'constrİaints', 'CONSTRAİNTS', 'glossary', '용어집', '용어 정의',
  '한', 'a', 'Z', '_', '1', '-', '.', '(', ')', '/', '*', '😀', '가', '한TBD', 'TBD한', 'TBD_',
  ' ', ' ', '  ', '\t', '　', ' ', '\x1c', '\x85', ' ', ' ', '\x0b', '\x0c', '﻿', '​', '\r', '\r\n', '\n', '\n', '\n', '\n\n',
];

function prdDoc(r) {
  const n = 1 + Math.floor(r() * 40);
  let s = '';
  for (let i = 0; i < n; i++) s += pick(r, PRD_TOKENS) + (r() < 0.5 ? ' ' : '');
  if (r() < 0.2) s = `﻿${s}`;
  if (r() < 0.1) s = s.replace(/\n/g, '\r\n');
  return s;
}

const REQS = [
  ['acceptance criteria', 'non-functional requirements', 'constraints'],
  ['acceptance criteria', 'non-functional requirements', 'constraints', 'glossary'],
  ['glossary'],
  ['NFR', 'Acceptance Criteria'],
  ['C++', 'a b', '비기능', 'İ', 'Release Plan'],
  [],
];

const PRD_DRIVER = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('pv', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
req = json.load(sys.stdin)
out = [m.validate_file(Path(c['path']), c['required']) for c in req]
sys.stdout.write(json.dumps(out, ensure_ascii=False))
`;

test('무작위 문서 1500건(×FUZZ_SCALE): prd-validate 의 validate_file 결과가 python 판과 같다', (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 비교를 건너뜀');
  const r = rng(20261007 + SEED);
  const root = fs.realpathSync(makeTempDir('prd-fuzz-'));
  roots.push(root);
  const cases = [];
  for (let i = 0; i < 1500 * SCALE; i++) {
    const p = path.join(root, `d${i}.md`);
    fs.writeFileSync(p, prdDoc(r), 'utf8');
    cases.push({ path: p, required: pick(r, REQS) });
  }
  const res = env.python(['-c', PRD_DRIVER, env.script('prd-validate.py')], { input: JSON.stringify(cases), cwd: root, normalizeEol: false });
  assert.equal(res.status, 0, res.stderr);
  const want = JSON.parse(res.stdout);
  for (let i = 0; i < cases.length; i++) {
    const got = JSON.parse(pyJsonDumps(validate_file(cases[i].path, cases[i].required), { ensureAscii: false }));
    if (JSON.stringify(got) !== JSON.stringify(want[i])) {
      assert.fail(`불일치 #${i} required=${JSON.stringify(cases[i].required)}\n입력: ${JSON.stringify(fs.readFileSync(cases[i].path, 'utf8'))}\npython: ${JSON.stringify(want[i])}\nnode:   ${JSON.stringify(got)}`);
    }
  }
});

// ---- decision-log ----------------------------------------------------------

const KEYS = ['Phase', 'Decision needed', 'Decision made', 'Rationale', 'Reversible', 'Source', 'ID', 'Timestamp', 'Some Key', 'a  b', '1', '10', '2', 'ÄÖ İ', '', ' ', 'phase', 'K*x'];
const PHASES = ['design', 'build', 'test', 'refactor', 'wbs', 'wbs-resolve', 'feat-intake', 'prd-resolve', 'dev-team-merge', 'deploy', '', ' design ', '설계'];
const VALS = ['yes', 'no', 'Yes', "'no'", 'x', '한글 😀', '', '  ', '　v　', '\x1cv\x1f', '\x85v', 'v w', 'a\x0bb', 'a  b', '- **K**: v', 'ﬁ'];
const IDS = ['1', '2', '3', '001', '002', '003', '0007', '10', '０１', '٣', '\u{1d7d1}', '12', '999', '1000', '5'];
const TSS = ['2026-01-01T00:00:00Z', 't', 'a b', '(x)', '', '한글', '2026 (KST)'];
const JUNK = ['# Decisions Log — X', '> quote', '본문', '```', '## D-TSK-1-2 (t)', '##D-001 (t)', '## D-1 (t) x', '## D-X (t)', '   ## D-1 (t)', '- loose item', '---', '﻿'];

function decisionsMd(r) {
  const out = [];
  if (r() < 0.6) out.push('# Decisions Log — X', '', '> Append-only', '');
  const n = Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    if (r() < 0.2) out.push(pick(r, JUNK));
    out.push(`## D-${pick(r, IDS)} (${pick(r, TSS)})${pick(r, ['', '', '', ' ', '  ', '　', ' ', ' x'])}`);
    const f = Math.floor(r() * 7);
    for (let j = 0; j < f; j++) {
      const k = pick(r, KEYS);
      const sep = pick(r, [': ', ':', ':  ', ':\n', ': 　']);
      const v = j === 0 && r() < 0.5 ? pick(r, PHASES) : pick(r, VALS);
      out.push(`- **${k}**${sep}${v}`);
    }
    if (r() < 0.3) out.push(pick(r, JUNK));
    if (r() < 0.6) out.push('');
  }
  let s = out.join('\n');
  if (r() < 0.7) s += '\n';
  if (r() < 0.15) s = s.replace(/\n/g, '\r\n');
  else if (r() < 0.05) s = s.replace(/\n/g, '\r');
  if (r() < 0.1) s = `﻿${s}`;
  return s;
}

const DEC_DRIVER = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('dl', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
req = json.load(sys.stdin)
out = []
for c in req:
    d = Path(c['dir'])
    row = {'list': m.list_decisions(d), 'validate': m.validate_decisions(d)}
    r = m.append_decision(d, c['phase'], c['needed'], 'made', 'why', c['rev'], c['src'], c['label'], '2026-10-07T00:00:00Z')
    row['append'] = r
    row['file'] = (d / 'decisions.md').read_text(encoding='utf-8')
    out.append(row)
sys.stdout.write(json.dumps(out, ensure_ascii=False))
`;

test('무작위 decisions.md 800건(×FUZZ_SCALE): list·validate·append 결과(파일 바이트 포함)가 python 판과 같다', (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 비교를 건너뜀');
  const r = rng(77001 + SEED);
  const root = fs.realpathSync(makeTempDir('dlog-fuzz-'));
  roots.push(root);
  const cases = [];
  const nodeDirs = [];
  const bodies = [];
  for (let i = 0; i < 800 * SCALE; i++) {
    const body = r() < 0.1 ? null : decisionsMd(r); // 가끔은 파일이 없는 저장소
    const a = path.join(root, 'py', `c${i}`);
    const b = path.join(root, 'node', `c${i}`);
    for (const d of [a, b]) {
      fs.mkdirSync(d, { recursive: true });
      if (body !== null) fs.writeFileSync(path.join(d, 'decisions.md'), body, 'utf8');
    }
    nodeDirs.push(b);
    bodies.push(body);
    cases.push({ dir: a, phase: pick(r, ['design', 'build', 'wbs']), needed: pick(r, ['N', '한글', '- x']), rev: pick(r, [null, 'yes', 'no']), src: pick(r, [null, 's', '']), label: pick(r, [null, 'L', '']) });
  }
  const res = env.python(['-c', DEC_DRIVER, env.script('decision-log.py')], { input: JSON.stringify(cases), cwd: root, normalizeEol: false });
  assert.equal(res.status, 0, res.stderr);
  const want = JSON.parse(res.stdout);
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const dir = nodeDirs[i];
    // 정수형 키가 든 사례는 JSON.parse 가 양쪽 다 같게 재배치하므로 객체로 되돌려 비교한다(키 순서 자체는 골든 사례가 바이트로 본다)
    const list = JSON.parse(pyJsonDumps(list_decisions(dir), { ensureAscii: false }));
    const validate = validate_decisions(dir);
    const append = append_decision(dir, c.phase, c.needed, 'made', 'why', c.rev, c.src, c.label, '2026-10-07T00:00:00Z');
    const file = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
    const norm = (x) => JSON.stringify(x).split(c.dir).join('<D>').split(dir).join('<D>');
    const got = norm({ list, validate, append, file });
    const exp = norm({ list: want[i].list, validate: want[i].validate, append: want[i].append, file: want[i].file });
    if (got !== exp) {
      assert.fail(`불일치 #${i}\n입력: ${JSON.stringify(bodies[i])}\npython: ${exp}\nnode:   ${got}`);
    }
  }
});
