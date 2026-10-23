#!/usr/bin/env node
// make-expected-parse.mjs — python legacy(wbs-parse) 로 기대값 파일 tests/golden/expected/parse.json 을 다시 만든다
// (손으로 고치지 않는다).
//   node .claude/skills/dflow-export/tests/make-expected-parse.mjs
// python 3 가 있어야 한다. 합성 입력(wbs-parse-cases.mjs 의 buildSynthetic)만 쓴다 — 리포의 실제 WBS 문서와
// live state.json 은 바뀌므로 넣지 않는다(실제 문서는 python 이 있는 PC 의 골든 시험이 직접 비교한다).
// 케이스를 바꿨으면 이 스크립트를 다시 돌린다. 임시 폴더는 makeTempDir 로 만든 것만 쓰고 끝나면 지운다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, runCommand } from '../../_shared/node/proc.mjs';
import { writeJson } from '../../_shared/node/io.mjs';
import { legacyEnv } from './legacy-env.mjs';
import { buildSynthetic } from './wbs-parse-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'golden', 'expected', 'parse.json');
const env = legacyEnv();
const base = makeTempDir('dflow-make-expected-parse-');

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

try {
  if (!env.available) throw new Error('python 3 를 찾지 못함 — 기대값은 python 이 있는 PC 에서 만든다');
  const { files, cases } = buildSynthetic(base);
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(base, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  const bases = [...new Set([base, real(base)])];
  const pyRoot = path.dirname(env.dir);
  const norm = (s, isStdout) => {
    let r = s.split(`${pyRoot}/references/default-dev-config.md`).join('<ROOT>/references/default-dev-config.md');
    for (const b of bases) r = r.split(b).join('<BASE>');
    if (isStdout) r = r.split('wbs-parse.py').join('wbs-parse.mjs'); // USAGE 의 프로그램 이름만 다르다
    // python traceback(비정상 입력)은 node 의 한 줄 오류와 같은 표식으로 맞춘다
    if (!isStdout && r.startsWith('Traceback (most recent call last):')) r = '<TRACEBACK>';
    return r;
  };

  const ids = new Set();
  const expected = {};
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`케이스 id 중복: ${c.id}`);
    ids.add(c.id);
    const r = runCommand(env.pythonCmd, ['-B', env.script('wbs-parse.py'), ...c.args], {
      normalizeEol: true,
      cwd: base,
      env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', CLAUDE_PLUGIN_ROOT: '', ...(c.env ?? {}) },
    });
    expected[c.id] = { status: r.status, stdout: norm(r.stdout, true), stderr: norm(r.stderr, false) };
  }
  writeJson(OUT, expected, { mkdirp: true });
  console.log(`기대값 생성: ${cases.length}건 → ${OUT}`);
} finally {
  env.cleanup();
  fs.rmSync(base, { recursive: true, force: true });
}
