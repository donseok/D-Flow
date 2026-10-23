#!/usr/bin/env node
// make-expected-envelope.mjs — python 인라인 원본(envelope-cases.mjs 의 PY_V1·PY_V2)으로 기대값 파일을 다시 만든다.
//   node .claude/skills/dflow-export/tests/make-expected-envelope.mjs
// 만드는 파일: tests/golden/expected/envelope.json
//   { "<케이스 id> | <v1|v2>": { variant, uuid, mod, out, error, loneSurrogate, input(base64|null), status, sha256, bytes, text? } }
// 입력(input)도 함께 담아 두므로 wbs-parse·wbs-nlevel-parse 출력이 나중에 바뀌어도 기대값 시험은 흔들리지 않는다.
// python 3 가 있어야 한다. 실제 문서(docs/**/wbs.md)의 export 는 live 라서 담지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findPython, makeTempDir } from '../../_shared/node/proc.mjs';
import { writeJson } from '../../_shared/node/io.mjs';
import { VARIANTS, syntheticCases, nlevelInputs, runLegacy, readOut } from './envelope-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'golden', 'expected', 'envelope.json');
const py = findPython();
if (!py) {
  console.error('python 3 를 찾지 못함 — 기대값은 python 이 있는 PC 에서 만든다');
  process.exitCode = 1;
} else {
  const base = makeTempDir('dflow-make-envelope-');
  try {
    const work = path.join(base, 'nlevel');
    fs.mkdirSync(work);
    const cases = [...syntheticCases(), ...(await nlevelInputs(work))];
    const expected = {};
    let n = 0;
    for (const c of cases) {
      for (const v of VARIANTS) {
        const dir = path.join(base, `c${n++}`);
        fs.mkdirSync(dir);
        const r = runLegacy(py, v, c, dir);
        const bytes = r.status === 0 ? readOut(r.outFile) : null;
        if (r.status === 0 && bytes === null) throw new Error(`${c.id} | ${v}: python 이 출력 파일을 만들지 않음`);
        const e = {
          variant: v, uuid: c.uuid, mod: c.mod, out: c.out, error: !!c.error, loneSurrogate: !!c.loneSurrogate,
          input: c.input === null ? null : Buffer.from(c.input).toString('base64'),
          status: r.status,
        };
        if (bytes) {
          e.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
          e.bytes = bytes.length;
          if (bytes.length <= 2000) e.text = bytes.toString('utf8');
        }
        if (!!c.error !== (r.status !== 0)) throw new Error(`${c.id} | ${v}: 오류 기대(${!!c.error})와 python 종료 코드(${r.status})가 다름`);
        expected[`${c.id} | ${v}`] = e;
      }
    }
    writeJson(OUT, expected, { mkdirp: true });
    console.log(`기대값 생성: ${Object.keys(expected).length}건 → ${OUT}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
