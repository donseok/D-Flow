// golden-run.mjs — 골든 비교·기대값 생성이 함께 쓰는 실행 도우미.
//  - writeDocs(base, files): 문서를 임시 폴더에 기록(문자열은 UTF-8, Buffer 는 그대로)
//  - runNodeCase / runPythonCase: 같은 인자·같은 cwd 로 node 판·python legacy 실행 → {status, stdout, stderr}
//  - normResult: stderr 의 python traceback 은 `<TRACEBACK> 예외이름` 으로 맞춘다(스택은 python 버전·경로마다 다르고,
//    node 판은 스택 대신 한 줄 오류를 쓴다). 문서에 적힌 사용 오류(종료 코드 2)는 문구가 달라 status 만 본다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, runNode } from '../../_shared/node/proc.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT = path.join(HERE, '..', 'scripts', 'wbs-nlevel-parse.mjs');

export function writeDocs(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(base, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

export function runNodeCase(args, { cwd, script = SCRIPT } = {}) {
  return runNode(script, args, { cwd, normalizeEol: true });
}

export function runPythonCase(env, args, { cwd }) {
  return env.python([env.script('wbs-nlevel-parse.py'), ...args], { cwd });
}

/** traceback → `<TRACEBACK> 예외이름` (마지막 줄의 `이름:` 부분) */
export function tracebackName(stderr) {
  if (!stderr.startsWith('Traceback (most recent call last):')) return null;
  const last = stderr.trimEnd().split('\n').pop();
  const m = /^([A-Za-z_.]+)(?::|$)/.exec(last);
  return m ? m[1] : last;
}

export function normResult(r, { base, usageCase = false } = {}) {
  let stderr = r.stderr;
  const tb = tracebackName(stderr);
  if (tb) stderr = `<TRACEBACK> ${tb}\n`;
  if (usageCase) stderr = '<USAGE>';
  if (base) {
    for (const b of base) stderr = stderr.split(b).join('<BASE>');
  }
  return { status: r.status, stdout: r.stdout, stderr };
}
