#!/usr/bin/env node
// make-expected.mjs — python legacy 로 기대값 파일을 다시 만든다(손으로 고치지 않는다).
//   node .claude/skills/dflow-export/tests/make-expected.mjs
// 만드는 파일(tests/golden/expected/): validate.json, status.json, md.json
// python 3 가 있어야 한다. 시험(`*.test.mjs`)의 "expected …" 케이스가 이 파일과 node 판 결과를 비교하므로,
// python 이 없는 PC(윈도우)에서도 node 판 회귀를 잡을 수 있다. 입력 케이스를 바꿨으면 이 스크립트를 다시 돌린다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { writeJson } from '../../_shared/node/io.mjs';
import { legacyEnv, SCRIPTS_DIR } from './legacy-env.mjs';
import { FILES, CLI_CASES } from './validate-cases.mjs';
import { PY_DRIVER, buildRequest, normalizeOut } from './status-cases.mjs';
import { DOCS, PY_MD_DRIVER } from './md-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'golden', 'expected');
const env = legacyEnv();
const base = makeTempDir('dflow-make-expected-');

try {
  if (!env.available) throw new Error('python 3 를 찾지 못함 — 기대값은 python 이 있는 PC 에서 만든다');

  // validate
  const work = path.join(base, 'cases');
  for (const [name, text] of Object.entries(FILES)) {
    const p = path.join(work, ...name.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  const validate = {};
  for (const c of CLI_CASES) {
    const r = env.python([env.script('wbs-validate.py'), ...c.args], { cwd: work, normalizeEol: true });
    const fields = c.compare ?? ['stdout', 'status', 'stderr'];
    validate[c.id] = {
      status: r.status,
      stdout: fields.includes('stdout') ? r.stdout : '',
      stderr: fields.includes('stderr') ? r.stderr : '',
    };
  }
  writeJson(path.join(OUT, 'validate.json'), validate, { mkdirp: true });

  // status
  const tmp = path.join(base, 'status');
  fs.mkdirSync(tmp);
  const req = buildRequest(tmp);
  const r = env.python(['-c', PY_DRIVER, env.dir], { input: JSON.stringify(req), cwd: tmp });
  if (r.status !== 0) throw new Error(`status 드라이버 실패: ${r.stderr}`);
  writeJson(path.join(OUT, 'status.json'), normalizeOut(JSON.parse(r.stdout), { tmp, plugins: [env.dir, SCRIPTS_DIR] }));

  // md
  const m = env.python(['-c', PY_MD_DRIVER, env.dir], { input: JSON.stringify(DOCS), cwd: base });
  if (m.status !== 0) throw new Error(`md 드라이버 실패: ${m.stderr}`);
  writeJson(path.join(OUT, 'md.json'), JSON.parse(m.stdout));

  console.log(`기대값 생성: validate ${Object.keys(validate).length}건, status ${req.calls.length}+${req.resolves.length}건, md ${Object.keys(DOCS).length}건 → ${OUT}`);
} finally {
  env.cleanup();
  fs.rmSync(base, { recursive: true, force: true });
}
