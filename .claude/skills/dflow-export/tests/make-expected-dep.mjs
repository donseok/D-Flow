#!/usr/bin/env node
// make-expected-dep.mjs — dep-analysis 의 python legacy 로 기대값·입력 스냅숏을 다시 만든다(손으로 고치지 않는다).
//   node .claude/skills/dflow-export/tests/make-expected-dep.mjs
// 만드는 파일
//   tests/golden/inputs/dep-mdm-tasks-all.json  실제 WBS(docs/mdm/wbs.md)를 python wbs-parse.py --tasks-all 로 변환한 출력(스냅숏)
//   tests/golden/expected/dep.json              dep-cases.mjs 의 모든 CLI 케이스에 대한 python 판 stdout·stderr·종료 코드
// python 3 가 있어야 한다. python 이 없는 PC(윈도우)에서는 이 파일들을 node 판 단독 회귀(`expected …` 케이스)의 기준으로 쓴다.
// python 은 PYTHONHASHSEED=0 으로 돌린다. 합류점이 둘 이상인 다이아몬드는 python 순서가 실행마다 달라지므로(케이스의 `diamonds` 표시)
// diamond_patterns 안에서 같은 (apex, branches) 묶음의 순서만 node 판의 순서(merge 코드포인트 순)로 바꿔 저장한다. 그 밖의 바이트는 그대로다.
// 저장소 경로는 `<ROOT>` 로 치환해 둔다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { writeJson } from '../../_shared/node/io.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { compareCodePoint } from '../../_shared/node/pytext.mjs';
import { legacyEnv } from './legacy-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const SNAP = path.join(HERE, 'golden', 'inputs', 'dep-mdm-tasks-all.json');
const OUT = path.join(HERE, 'golden', 'expected', 'dep.json');

export const PY_ENV = { PYTHONHASHSEED: '0', WBS_STATE_MACHINE: '', CLAUDE_PLUGIN_ROOT: '' };

const env = legacyEnv();
const base = fs.realpathSync(makeTempDir('dflow-make-expected-dep-'));

try {
  if (!env.available) throw new Error('python 3 를 찾지 못함 — 기대값은 python 이 있는 PC 에서 만든다');

  // 1) 실제 WBS 스냅숏
  const wbs = path.join(REPO, 'docs', 'mdm', 'wbs.md');
  const r = env.python([env.script('wbs-parse.py'), wbs, '--tasks-all'], { env: PY_ENV, cwd: base });
  if (r.status !== 0) throw new Error(`wbs-parse.py 실패: ${r.stderr}`);
  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, r.stdout, 'utf8');

  // 2) 케이스(스냅숏이 있어야 real/* 케이스가 만들어지므로 스냅숏을 쓴 뒤에 불러온다)
  const { FILES, CLI_CASES, caseInput, toNodeDiamondOrder } = await import('./dep-cases.mjs');
  const work = path.join(base, 'cases');
  for (const [name, text] of Object.entries(FILES)) {
    const p = path.join(work, ...name.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  const expected = {};
  for (const c of CLI_CASES) {
    const res = env.python([env.script('dep-analysis.py'), ...c.args], {
      cwd: work, input: caseInput(c), env: { ...PY_ENV, ...c.env },
    });
    let stdout = res.stdout.split(work).join('<ROOT>');
    // 합류점이 둘 이상인 다이아몬드는 python 순서가 실행마다 달라, node 판이 쓰는 순서(코드포인트 순)로 바꿔 저장한다
    if (c.diamonds) stdout = toNodeDiamondOrder(stdout, { pyJsonDumps, compareCodePoint });
    expected[c.id] = {
      status: res.status,
      stdout,
      stderr: res.stderr.split(work).join('<ROOT>'),
    };
  }
  writeJson(OUT, expected, { mkdirp: true });
  console.log(`기대값 생성: dep ${Object.keys(expected).length}건, 스냅숏 ${JSON.parse(r.stdout).length}개 Task → ${OUT}`);
} finally {
  env.cleanup();
  fs.rmSync(base, { recursive: true, force: true });
}
