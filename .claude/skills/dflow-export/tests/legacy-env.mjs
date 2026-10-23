// legacy-env.mjs — python 원본(legacy) 사본을 임시 폴더에 "원래 이름"으로 복사해 python 으로 돌리는 도우미.
//
// 왜 필요한가: 동결한 python 원본은 tests/golden/legacy/<이름>.legacy.py 로 보관한다. 그런데 원본끼리
// `import _wbs_status`, `from _wbs_md import …` 처럼 모듈 이름으로 서로를 부르고, `__file__` 옆의
// references/state-machine.json 도 찾는다. 그래서 골든 비교는 임시 폴더에 원래 이름(`_wbs_status.py`,
// `wbs-parse.py`, `test_wbs_status.py` …)으로 복사하고 `references/` 를 함께 두어 그 폴더에서 돌린다.
//
// 사용법
//   import { legacyEnv } from './legacy-env.mjs';
//   const env = legacyEnv();                      // 임시 폴더 생성 + 복사 (python 이 없어도 호출 가능)
//   after(() => env.cleanup());                   // node:test 의 after 에서 지운다
//   if (env.available) {                          // python 3 이 있을 때만
//     const r = env.python(['wbs-validate.py', 'validate', '--wbs', 'x.md'], { cwd, input, env });
//     // r = { status, stdout, stderr }  (줄끝은 그대로, 필요하면 { normalizeEol: true })
//   }
//   env.script('wbs-parse.py')                    // 임시 폴더 안 스크립트 절대 경로 (compareGolden 의 python.cmd 첫 요소로)
//   env.pyVersion                                 // [major, minor] (python 이 없으면 null). 버전별로 달라지는 문구(예: json 오류)를 가릴 때 쓴다
//   env.dir                                       // 복사본이 든 임시 폴더 (스크립트가 `__file__` 로 보는 위치)
//
// 규칙
//  - `X.legacy.py` → `X.py` (`test_X.legacy.py` → `test_X.py`). 확장자가 `.legacy.py` 인 파일만 이름을 바꾼다.
//  - 이식이 진행 중이라 legacy 폴더에 아직 없고 scripts/ 에 남아 있는 `.py` 는 같은 이름으로 함께 복사한다(전환용 안전망).
//  - scripts/references/ 는 통째로 복사한다(`_wbs_status` 의 플러그인 기본 상태머신 탐색에 필요).
//  - python 은 `-B`(바이트코드 안 씀)·PYTHONUTF8=1·PYTHONIOENCODING=utf-8 로 실행해 리포에 __pycache__ 를 남기지 않는다.
//  - 임시 폴더는 `makeTempDir` 로 만든 것이고 `cleanup()` 이 지운다(그 외 폴더는 건드리지 않는다).
//  - 기본 cwd 는 복사본 폴더다. 입력 파일이 따로 있으면 opts.cwd 로 다른 임시 폴더를 준다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython, makeTempDir, runCommand } from '../../_shared/node/proc.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LEGACY_DIR = path.join(HERE, 'golden', 'legacy');
export const SCRIPTS_DIR = path.join(HERE, '..', 'scripts');

function listPy(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.py')).sort();
  } catch {
    return [];
  }
}

/**
 * @returns {{dir:string, available:boolean, pythonCmd:string|null, pyVersion:number[]|null,
 *   python:(args:string[], opts?:{cwd?:string,input?:string,env?:object,normalizeEol?:boolean})=>{status:number,stdout:string,stderr:string},
 *   script:(name:string)=>string, cleanup:()=>void}}
 */
export function legacyEnv() {
  const dir = makeTempDir('dflow-legacy-');
  const copied = new Set();
  for (const f of listPy(LEGACY_DIR)) {
    const name = f.endsWith('.legacy.py') ? `${f.slice(0, -'.legacy.py'.length)}.py` : f;
    fs.copyFileSync(path.join(LEGACY_DIR, f), path.join(dir, name));
    copied.add(name);
  }
  for (const f of listPy(SCRIPTS_DIR)) {
    if (!copied.has(f)) fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(dir, f));
  }
  const refs = path.join(SCRIPTS_DIR, 'references');
  if (fs.existsSync(refs)) fs.cpSync(refs, path.join(dir, 'references'), { recursive: true });

  const pythonCmd = findPython();
  let pyVersion = null;
  if (pythonCmd) {
    const v = runCommand(pythonCmd, ['--version']);
    const m = /Python (\d+)\.(\d+)/.exec(`${v.stdout}${v.stderr}`);
    if (m) pyVersion = [Number(m[1]), Number(m[2])];
  }
  return {
    dir,
    pyVersion,
    available: !!pythonCmd,
    pythonCmd,
    python(args, opts = {}) {
      if (!pythonCmd) throw new Error('legacyEnv: python 3 을 찾지 못함 (env.available 을 먼저 확인)');
      return runCommand(pythonCmd, ['-B', ...args], {
        input: opts.input,
        cwd: opts.cwd ?? dir,
        normalizeEol: opts.normalizeEol ?? true, // 윈도우 python 은 텍스트 모드 출력이 CRLF 라 기본으로 LF 로 맞춘다
        env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(opts.env ?? {}) },
      });
    },
    script: (name) => path.join(dir, name),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
