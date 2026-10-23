// status-driver.mjs — status-cases.mjs 의 PY_DRIVER 와 같은 일을 node 판 _wbs_status.mjs 로 하는 드라이버.
// 사용: node status-driver.mjs   (stdin 으로 {calls, resolves} JSON, stdout 으로 결과 JSON)
// 환경 변수·cwd 를 바꾸므로 시험은 하위 프로세스로 실행한다.

import * as S from '../scripts/_wbs_status.mjs';
import { readStdinTextSync } from '../../_shared/node/io.mjs';

function ser(v) {
  if (v instanceof Set) return [...v].sort();
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ser(x)]));
  return v;
}

const req = JSON.parse(readStdinTextSync());
const res = { calls: [], resolves: [] };
for (const c of req.calls) res.calls.push(ser(S[c.fn](...c.args)));
for (const r of req.resolves) {
  for (const k of ['WBS_STATE_MACHINE', 'CLAUDE_PLUGIN_ROOT']) delete process.env[k];
  Object.assign(process.env, r.env);
  if (r.cwd) process.chdir(r.cwd);
  let cand;
  let out;
  if (r.docs_dir === null) {
    cand = S.state_machine_candidates();
    out = S.resolve_state_machine();
  } else {
    cand = S.state_machine_candidates(r.docs_dir);
    out = S.resolve_state_machine(r.docs_dir);
  }
  res.resolves.push({ candidates: cand, sm: ser(out[0]), path: out[1], err: out[2] });
}
process.stdout.write(`${JSON.stringify(res)}\n`);
