// 하위 프로세스·도구 탐색 헬퍼. 모두 동기 실행(spawnSync)이다.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BUFFER = 256 * 1024 * 1024;

function run(cmd, args, { input, cwd, env, normalizeEol = false, shell = false, timeout } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    input,
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    shell,
    timeout,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  let stdout = r.stdout ?? '';
  let stderr = r.stderr ?? '';
  if (normalizeEol) {
    stdout = stdout.replace(/\r\n?/g, '\n');
    stderr = stderr.replace(/\r\n?/g, '\n');
  }
  const out = { status: r.status ?? -1, stdout, stderr };
  if (r.signal) out.signal = r.signal;
  if (r.error) out.error = r.error.message;
  return out;
}

/**
 * node 스크립트를 현재 node(process.execPath)로 실행한다.
 * env 는 process.env 위에 덮어쓴다. 결과 status 는 신호 종료·실행 실패 시 -1(signal·error 필드 추가).
 * stdout·stderr 의 CRLF 는 그대로 두며 normalizeEol:true 면 LF 로 바꾼다.
 */
export function runNode(scriptPath, args = [], opts = {}) {
  return run(process.execPath, [scriptPath, ...args], opts);
}

/**
 * 임의 명령 실행. 윈도우의 `.cmd`·`.bat`(예: node_modules/.bin/tsc.cmd)는 shell:true 가 필요하다
 * (node 18.20+/20.12+ 는 shell 없이 .cmd 를 spawn 하면 EINVAL).
 */
export function runCommand(cmd, args = [], opts = {}) {
  return run(cmd, args, opts);
}

let pyCache;

/**
 * 실행 가능한 python3 명령 이름을 찾는다. PATH 의 `python3`, `python` 후보를 `--version` 으로 실제 실행해
 * "Python 3.x" 가 나오는 첫 후보를 돌려준다(Microsoft Store 스텁·python2·실패는 건너뜀). 없으면 null.
 * 환경 변수 DMES_NO_PYTHON=1 이면 항상 null(python 부재 경로 시험용). 결과는 캐시된다.
 */
export function findPython({ refresh = false } = {}) {
  if (process.env.DMES_NO_PYTHON === '1') return null;
  if (!refresh && pyCache !== undefined) return pyCache;
  pyCache = null;
  for (const cand of ['python3', 'python']) {
    const r = spawnSync(cand, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.error || r.status !== 0) continue;
    if (/^Python 3\.\d+/m.test(`${r.stdout ?? ''}${r.stderr ?? ''}`)) {
      pyCache = cand;
      break;
    }
  }
  return pyCache;
}

/**
 * `<projectRoot>/node_modules/.bin/<name>` 을 찾는다. 윈도우면 `<name>.cmd` 를 우선한다. 없으면 null.
 * 윈도우에서 .cmd 는 `runCommand(bin, args, {shell:true})` 로 부르거나, 패키지의 bin 스크립트를
 * `node <패키지 bin>` 으로 직접 실행한다.
 */
export function resolveBin(projectRoot, name, { platform = process.platform } = {}) {
  const dir = path.join(projectRoot, 'node_modules', '.bin');
  const cands = platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const c of cands) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** os.tmpdir() 아래에 임시 폴더를 만들어 경로를 돌려준다(정리는 호출자가 fs.rmSync 로). */
export function makeTempDir(prefix = 'dmes-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
