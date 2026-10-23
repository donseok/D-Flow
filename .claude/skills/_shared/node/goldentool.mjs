// 파일을 만들거나 바꾸는 도구용 골든 비교: python 판과 node 판을 "서로 다른 임시 저장소"에서 같은 인자로 돌려
// 출력(stdout·stderr·종료 코드)과 저장소에 남은 파일 전체(바이트)를 비교한다. golden.mjs 의 compareGolden 이
// 두 판을 실행하고, 이 모듈이 임시 저장소 준비·경로 정규화·파일 트리 비교를 맡는다.
//  - 임시 저장소는 realpath 로 만들어 `--root` 로 넘기므로 양쪽 출력의 절대 경로가 같은 모양이다(비교 전에 `<ROOT>` 로 치환).
//  - python 이 없으면 skip(`{skipped:true}`)이므로 윈도우에서도 시험이 실패하지 않는다.
//  - 한계: 파일 트리는 `.git` 폴더를 빼고 비교한다. 수정 시각·권한은 보지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { compareGolden } from './golden.mjs';
import { makeTempDir } from './proc.mjs';
import { walkSorted, toPosix } from './paths.mjs';

const require = createRequire(import.meta.url);

function snapshotTree(root) {
  const files = new Map();
  for (const p of walkSorted(root, { skipDirs: ['.git'] })) {
    files.set(toPosix(path.relative(root, p)), fs.readFileSync(p).toString('base64'));
  }
  return files;
}

function normalize(text, root, replacements) {
  let t = text.split(root).join('<ROOT>');
  for (const [from, to] of replacements) t = t.split(from).join(to);
  return t;
}

function diffTrees(a, b) {
  const diffs = [];
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    if (!a.has(name)) diffs.push(`파일 ${name}: node 판에만 있음`);
    else if (!b.has(name)) diffs.push(`파일 ${name}: python 판에만 있음`);
    else if (a.get(name) !== b.get(name)) {
      diffs.push(
        `파일 ${name}: 내용이 다름\n  python: ${JSON.stringify(Buffer.from(a.get(name), 'base64').toString('utf8'))}\n  node:   ${JSON.stringify(Buffer.from(b.get(name), 'base64').toString('utf8'))}`,
      );
    }
  }
  return diffs;
}

/**
 * @param {object} spec
 *   legacy: python 판 스크립트 경로, script: node 판 스크립트 경로
 *   setup(root): 임시 저장소를 채우는 함수(양쪽에 각각 호출)
 *   args: 도구 인자 배열 또는 (root)=>배열. `--root <임시 저장소>` 는 이 모듈이 뒤에 붙인다(rootFlag:null 이면 생략).
 *   replacePython: python 출력에만 적용할 [찾을 문자열, 바꿀 문자열] 목록(도구 이름 차이 등)
 *   statusOnly: true 면 종료 코드만 비교(argparse 사용 오류처럼 문구가 다른 경우), 파일 트리는 항상 비교
 * @param {{python?: string|null}} [opts]
 * @returns {{ok:boolean|null, skipped?:true, reason?:string, diffs:string[]}}
 */
export function compareToolGolden(spec, opts = {}) {
  const roots = [makeTempDir('dmes-golden-py-'), makeTempDir('dmes-golden-node-')].map((d) => fs.realpathSync(d));
  try {
    const [pyRoot, nodeRoot] = roots;
    for (const r of roots) spec.setup?.(r);
    const argsFor = (r) => {
      const a = typeof spec.args === 'function' ? spec.args(r) : spec.args;
      return spec.rootFlag === null ? [...a] : [...a, spec.rootFlag ?? '--root', r];
    };
    const res = compareGolden(
      {
        python: { cmd: [spec.legacy, ...argsFor(pyRoot)] },
        node: { script: spec.script, args: argsFor(nodeRoot) },
        compare: [],
      },
      opts,
    );
    if (res.skipped) return res;

    const replacements = spec.replacePython ?? [];
    const diffs = [];
    if (res.python.status !== res.node.status) {
      diffs.push(`종료 코드: python ${res.python.status} / node ${res.node.status}`);
    }
    if (!spec.statusOnly) {
      const pairs = [
        ['stdout', normalize(res.python.stdout, pyRoot, replacements), normalize(res.node.stdout, nodeRoot, [])],
        ['stderr', normalize(res.python.stderr, pyRoot, replacements), normalize(res.node.stderr, nodeRoot, [])],
      ];
      for (const [field, a, b] of pairs) {
        if (a === b) continue;
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        const ctx = (t) => JSON.stringify(t.slice(Math.max(0, i - 30), i + 60));
        diffs.push(`${field}: 첫 차이 위치 ${i}\n  python: ${ctx(a)}\n  node:   ${ctx(b)}`);
      }
    }
    diffs.push(...diffTrees(snapshotTree(pyRoot), snapshotTree(nodeRoot)));
    return { ok: diffs.length === 0, diffs, python: res.python, node: res.node };
  } finally {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  }
}

/** node:test 용 등록. python 이 없으면 skip, 차이가 있으면 실패. */
export function goldenToolTest(name, spec, opts = {}) {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  return test(name, (t) => {
    const r = compareToolGolden(spec, opts);
    if (r.skipped) {
      t.skip(r.reason);
      return;
    }
    assert.ok(r.ok, r.diffs.join('\n'));
  });
}
