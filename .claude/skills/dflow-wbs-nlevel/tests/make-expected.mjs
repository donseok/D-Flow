#!/usr/bin/env node
// make-expected.mjs — python legacy(wbs-nlevel-parse) 로 기대값 파일 tests/golden/expected/parse.json 을 다시 만든다
// (손으로 고치지 않는다).
//   node .claude/skills/dflow-wbs-nlevel/tests/make-expected.mjs
// python 3 가 있어야 한다. 합성 입력(nlevel-cases.mjs 의 buildSynthetic + USAGE_CASES)만 쓴다 — 리포의 실제 문서는 바뀌므로
// 넣지 않는다(python 이 있는 PC 의 골든 시험이 직접 비교한다). 케이스·문서를 바꿨으면 이 스크립트를 다시 돌린다.
// 임시 폴더는 makeTempDir 로 만든 것만 쓰고 끝나면 지운다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { writeJson } from '../../_shared/node/io.mjs';
import { legacyEnv } from './legacy-env.mjs';
import { buildSynthetic, USAGE_CASES } from './nlevel-cases.mjs';
import { writeDocs, runPythonCase, normResult } from './golden-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'golden', 'expected', 'parse.json');
const env = legacyEnv();
const base = makeTempDir('nlevel-make-expected-');

try {
  if (!env.available) throw new Error('python 3 를 찾지 못함 — 기대값은 python 이 있는 PC 에서 만든다');
  const { files, cases } = buildSynthetic();
  writeDocs(base, files);
  const all = [...cases.map((c) => ({ ...c, usage: false })), ...USAGE_CASES.map((c) => ({ ...c, usage: true }))];
  const ids = new Set();
  const expected = {};
  for (const c of all) {
    if (ids.has(c.id)) throw new Error(`케이스 id 중복: ${c.id}`);
    ids.add(c.id);
    expected[c.id] = normResult(runPythonCase(env, c.args, { cwd: base }), { usageCase: c.usage });
  }
  writeJson(OUT, expected, { mkdirp: true, indent: 0 });
  console.log(`기대값 생성: ${all.length}건 → ${OUT}`);
} finally {
  env.cleanup();
  fs.rmSync(base, { recursive: true, force: true });
}
