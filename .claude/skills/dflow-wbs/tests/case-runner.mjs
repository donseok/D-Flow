// case-runner.mjs — decision-log·prd-validate 시험이 함께 쓰는 "사례 실행기".
//
// 사례(case) = { id, files?: {상대경로: 내용}, steps: [{args, cwd?, statusOnly?, impl?}], target? }
//  - 사례마다 새 임시 저장소(root, realpath)를 만들고 files 를 쓴 뒤 steps 를 순서대로 실행한다.
//  - args 안의 `{ROOT}` 는 임시 저장소 절대 경로로 바뀐다. cwd 는 root 기준 상대 경로(기본 root).
//  - 실행기(runner)는 (args, cwd) → {status, stdout, stderr}. python 판·node 판 실행기를 각각 넘긴다.
//  - 결과 = { steps: [{status, stdout?, stderr?}], files: {상대경로: 내용} }.
//    stdout·stderr·파일 내용은 임시 저장소 경로를 `<ROOT>` 로, UTC 시각·날짜를 `<TS>`·`<DATE>` 로 정규화한다
//    (두 도구 모두 CLI 로 시각을 주입할 수 없어 출력에서 시각만 지운다). statusOnly 단계는 종료 코드만 남긴다
//    (argparse 와 문구가 다른 사용 오류·도움말·예외 문구용).
//  - impl('py'|'node')을 가진 단계가 있으면 "교차 실행"을 할 수 있다: 단계마다 그 쪽 실행기로 돌려 python 이 쓴 파일을 node 가
//    읽고 node 가 쓴 파일을 python 이 읽는 것을 확인한다.

import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { walkSorted, toPosix } from '../../_shared/node/paths.mjs';

export function makeRoot(prefix = 'dflow-wbs-case-') {
  return fs.realpathSync(makeTempDir(prefix));
}

export function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

const TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;
const DATE_RE = /auto-resolved \d{4}-\d{2}-\d{2}/g;

// 윈도우: 경로 필드("path"·"target"·"error": "file not found: …")의 JSON 이스케이프된 역슬래시(`\\\\`)를 슬래시로 바꾼다.
// 다른 필드(예: 사용자가 쓴 `back\\slash` 같은 값)는 건드리지 않는다.
const PATH_FIELD_RE = /("(?:path|target)": "|"error": "file not found: )((?:[^"\\]|\\.)*)"/g;
export function winPaths(text) {
  return text.replace(PATH_FIELD_RE, (_, head, body) => `${head}${body.replace(/\\\\/g, '/')}"`);
}

export function normText(text, root, { win = process.platform === 'win32' } = {}) {
  let t = text.split(root).join('<ROOT>');
  const escaped = JSON.stringify(root).slice(1, -1); // JSON 출력 안의 root(윈도우는 역슬래시가 두 개)
  if (escaped !== root) t = t.split(escaped).join('<ROOT>');
  if (win) t = winPaths(t);
  return t.replace(TS_RE, '<TS>').replace(DATE_RE, 'auto-resolved <DATE>');
}

function writeFiles(root, files = {}) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body); // 문자열은 UTF-8, Buffer 는 그대로
  }
}

export function snapshot(root, toText = (b) => b.toString('utf8')) {
  const out = {};
  for (const p of walkSorted(root, { skipDirs: ['.git'] })) {
    out[toPosix(path.relative(root, p))] = normText(toText(fs.readFileSync(p)), root);
  }
  return out;
}

/**
 * @param {object} c 사례
 * @param {(args:string[], cwd:string, step:object)=>{status:number,stdout:string,stderr:string}} runner
 * @param {{root?:string, fromNode?:(s:string)=>string}} [opts] fromNode: node 판 출력 문구를 python 판 문구로 되돌리는 함수(의도한 문구 차이)
 */
export function runCase(c, runner, opts = {}) {
  const root = opts.root ?? makeRoot();
  try {
    writeFiles(root, c.files);
    const steps = [];
    for (const s of c.steps) {
      const args = s.args.map((a) => a.split('{ROOT}').join(root));
      const cwd = s.cwd ? path.join(root, ...s.cwd.split('/')) : root;
      const r = runner(args, cwd, s);
      if (s.statusOnly) {
        steps.push({ status: r.status });
      } else {
        const fix = opts.fix ?? ((t) => t);
        steps.push({ status: r.status, stdout: normText(fix(r.stdout, s, r), root), stderr: normText(fix(r.stderr, s, r), root) });
      }
    }
    return { steps, files: snapshot(root) };
  } finally {
    if (!opts.root) removeRoot(root);
  }
}

/** 두 결과의 차이를 사람이 읽는 문자열 목록으로 돌려준다(없으면 빈 배열). */
export function diffResults(a, b, labels = ['a', 'b']) {
  const diffs = [];
  const n = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++) {
    const x = a.steps[i];
    const y = b.steps[i];
    if (!x || !y) {
      diffs.push(`단계 ${i}: 한쪽에만 있음`);
      continue;
    }
    for (const f of ['status', 'stdout', 'stderr']) {
      if (x[f] !== y[f]) {
        const sx = String(x[f]);
        const sy = String(y[f]);
        let k = 0;
        while (k < sx.length && k < sy.length && sx[k] === sy[k]) k++;
        const ctx = (t) => JSON.stringify(t.slice(Math.max(0, k - 30), k + 70));
        diffs.push(`단계 ${i} ${f}: 첫 차이 ${k}\n  ${labels[0]}: ${ctx(sx)}\n  ${labels[1]}: ${ctx(sy)}`);
      }
    }
  }
  for (const name of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
    if (!(name in a.files)) diffs.push(`파일 ${name}: ${labels[1]} 에만 있음`);
    else if (!(name in b.files)) diffs.push(`파일 ${name}: ${labels[0]} 에만 있음`);
    else if (a.files[name] !== b.files[name]) {
      diffs.push(`파일 ${name}: 내용이 다름\n  ${labels[0]}: ${JSON.stringify(a.files[name])}\n  ${labels[1]}: ${JSON.stringify(b.files[name])}`);
    }
  }
  return diffs;
}
