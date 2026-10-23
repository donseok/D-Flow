// 골든 비교: python 판과 node 판을 같은 입력으로 돌려 출력을 비교한다.
// python 이 없는 PC(윈도우 등)에서는 skip 으로 돌려주므로 시험이 실패하지 않는다.

import { createRequire } from 'node:module';
import { findPython, runCommand, runNode } from './proc.mjs';

const require = createRequire(import.meta.url);

const norm = (s, { eol = true, trimEnd = false } = {}) => {
  let t = s;
  if (eol) t = t.replace(/\r\n?/g, '\n');
  if (trimEnd) t = t.trimEnd();
  return t;
};

/**
 * @param {object|(()=>object)} spec
 *   python: { cmd: [python 스크립트, ...인자]  (인터프리터는 자동. 맨 앞이 python/python3 면 제거),
 *             input?, cwd?, env? }
 *   node:   { script, args?, input?, cwd?, env? }
 *   input·cwd 는 spec 최상위에 두면 양쪽 기본값이 된다.
 *   normalize: { eol: true, trimEnd: false }   compare: ['stdout','status','stderr'] (기본)
 * @param {{python?: string|null}} [opts] python 을 직접 지정(null 이면 없는 것으로 취급 → skip)
 * @returns {{ok:boolean|null, skipped?:true, reason?:string, diffs:{field:string,python:any,node:any}[], python?:object, node?:object}}
 */
export function compareGolden(spec, opts = {}) {
  const s = typeof spec === 'function' ? spec() : spec;
  const py = opts.python === undefined ? findPython() : opts.python;
  if (!py) {
    return { skipped: true, ok: null, reason: 'python3 를 찾지 못해 골든 비교를 건너뜀', diffs: [] };
  }
  const p = s.python ?? {};
  const n = s.node ?? {};
  let cmd = [...(p.cmd ?? [])];
  if (cmd.length && /^python3?(\.exe)?$/i.test(cmd[0])) cmd = cmd.slice(1);
  if (!cmd.length) throw new Error('compareGolden: python.cmd 가 비어 있음');

  const pyRes = runCommand(py, cmd, {
    input: p.input ?? s.input,
    cwd: p.cwd ?? s.cwd,
    // .pyc 를 리포에 남기지 않고, 로캘과 무관하게 UTF-8 로 고정
    env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(p.env ?? {}) },
  });
  const nodeRes = runNode(n.script, n.args ?? [], {
    input: n.input ?? s.input,
    cwd: n.cwd ?? s.cwd,
    env: n.env,
  });

  const fields = s.compare ?? ['stdout', 'status', 'stderr'];
  const diffs = [];
  for (const f of fields) {
    const a = f === 'status' ? pyRes.status : norm(pyRes[f], s.normalize);
    const b = f === 'status' ? nodeRes.status : norm(nodeRes[f], s.normalize);
    if (a !== b) diffs.push({ field: f, python: a, node: b });
  }
  return { ok: diffs.length === 0, diffs, python: pyRes, node: nodeRes };
}

/** 비교 결과를 사람이 읽는 문자열로 만든다(첫 차이 위치 포함). */
export function formatDiffs(result) {
  if (result.skipped) return `skip: ${result.reason}`;
  return result.diffs.map((d) => {
    const a = String(d.python);
    const b = String(d.node);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const ctx = (t) => JSON.stringify(t.slice(Math.max(0, i - 20), i + 40));
    return `[${d.field}] 첫 차이 위치 ${i}\n  python: ${ctx(a)}\n  node:   ${ctx(b)}`;
  }).join('\n');
}

/**
 * node:test 용 골든 시험 등록. python 이 없으면 skip. 사용: `goldenTest('wbs export', {...})`.
 * (node:test 는 호출 시점에 로드하므로 이 모듈을 일반 스크립트에서 import 해도 무해하다.)
 */
export function goldenTest(name, spec, opts = {}) {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  return test(name, (t) => {
    const r = compareGolden(spec, opts);
    if (r.skipped) {
      t.skip(r.reason);
      return;
    }
    assert.ok(r.ok, formatDiffs(r));
  });
}
