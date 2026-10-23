// import-judge.mjs — "새 import 사전 검사(priority 허용값·w: 양수·module 존재/형식)가 거부하는 케이스"를 고르는 판정 도우미.
// python 원본에는 없던 검사라, 이런 케이스는 python 과 출력을 비교하지 않는다(의도한 차이).
// 대신 node 판이 거부하는지, 그리고 그 이슈 문장이 출력에 나오는지만 확인한다. 케이스 이름 목록은 두지 않는다.

import path from 'node:path';
import { parse_wbs, import_compat_errors, readPyText } from '../scripts/wbs-nlevel-parse.mjs';

function optionValue(args, name) {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

/**
 * 이 명령(args, cwd 기준)이 읽는 주 문서가 새 검사에 걸리는지.
 * 걸리면 이슈 문장 목록, 안 걸리면(또는 문서를 못 읽거나 python 이 죽는 입력이면) 빈 목록.
 */
export function importCompatIssues(args, cwd) {
  const cmd = args[0];
  if (cmd !== 'validate' && cmd !== 'export') return [];
  const wbs = optionValue(args, '--wbs');
  if (!wbs) return [];
  try {
    const doc = parse_wbs(readPyText(path.resolve(cwd, wbs)));
    if (cmd === 'export' && doc.front.get('attach') && !optionValue(args, '--attach-ref')) {
      // attach_ref 를 못 만들면 검증 게이트에 닿기 전에 python 과 같은 문구로 끝난다 — 새 검사의 대상이 아니다
      const skeleton = optionValue(args, '--skeleton');
      if (!skeleton || !parse_wbs(readPyText(path.resolve(cwd, skeleton))).front.get('module')) return [];
    }
    const role = cmd === 'validate' ? (optionValue(args, '--role') ?? 'pl') : (doc.front.get('attach') ? 'pl' : 'skeleton');
    return import_compat_errors(doc, role);
  } catch {
    return [];
  }
}

/** 거부 케이스의 node 출력 확인: 종료 코드 1, 이슈 문장 중 하나 이상이 stdout/stderr 에 나온다. */
export function assertRejected(assert, label, issues, nodeResult) {
  assert.equal(nodeResult.status, 1, `${label}: 종료 코드`);
  const text = `${nodeResult.stdout}\n${nodeResult.stderr}`;
  const esc = (s) => JSON.stringify(s).slice(1, -1); // JSON 출력 안의 문장
  assert.ok(issues.some((m) => text.includes(m) || text.includes(esc(m))), `${label}: 이슈 문장이 출력에 없음\n${issues[0]}`);
}
