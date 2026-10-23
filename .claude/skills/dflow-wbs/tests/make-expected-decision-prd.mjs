#!/usr/bin/env node
// make-expected-decision-prd.mjs — python legacy 로 decision-log·prd-validate 기대값 파일을 다시 만든다(손으로 고치지 않는다).
//   node .claude/skills/dflow-wbs/tests/make-expected-decision-prd.mjs
// 만드는 파일(tests/golden/expected/): decision-log.json, prd-validate.json
// python 3 가 있어야 한다. 시험(`decision-log.test.mjs`·`prd-validate.test.mjs`)의 "기대값" 케이스가 이 파일과 node 판 결과를 비교하므로
// python 이 없는 PC(윈도우)에서도 node 판 회귀를 잡을 수 있다. 사례(decision-cases.mjs·prd-cases.mjs)를 바꿨으면 이 스크립트를 다시 돌린다.
// 기대값에는 각 사례의 단계별 종료 코드·stdout·stderr(정규화: 저장소 경로 `<ROOT>`, 시각 `<TS>`, 날짜 `<DATE>`)와 최종 파일 전체가 들어간다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../../_shared/node/io.mjs';
import { legacyEnv } from './legacy-env-decision-prd.mjs';
import { runCase } from './case-runner.mjs';
import { CASES as DEC_CASES } from './decision-cases.mjs';
import { CASES as PRD_CASES } from './prd-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'golden', 'expected');
const env = legacyEnv();

try {
  if (!env.available) throw new Error('python 3 를 찾지 못함 — 기대값은 python 이 있는 PC 에서 만든다');

  const build = (cases, script) => {
    const out = {};
    for (const c of cases) {
      if (c.id in out) throw new Error(`사례 id 중복: ${c.id}`);
      out[c.id] = runCase(c, (args, cwd) => env.python([env.script(script), ...args], { cwd }));
    }
    return out;
  };

  const dec = build(DEC_CASES, 'decision-log.py');
  writeJson(path.join(OUT, 'decision-log.json'), dec, { mkdirp: true });
  const prd = build(PRD_CASES, 'prd-validate.py');
  writeJson(path.join(OUT, 'prd-validate.json'), prd, { mkdirp: true });
  console.log(`기대값 생성: decision-log ${Object.keys(dec).length}건, prd-validate ${Object.keys(prd).length}건 → ${OUT}`);
} finally {
  env.cleanup();
}
