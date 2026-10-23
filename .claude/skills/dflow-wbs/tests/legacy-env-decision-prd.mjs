// legacy-env-decision-prd.mjs — decision-log·prd-validate 의 python 원본(legacy)을 임시 폴더에 "원래 이름"으로 복사해 돌리는 도우미.
//
// 동결한 원본은 tests/golden/legacy/<이름>.legacy.py 로 보관한다(`decision-log.legacy.py`, `prd-validate.legacy.py`).
// 골든 비교는 임시 폴더에 `decision-log.py`·`prd-validate.py` 로 복사해 그 폴더에서 python 을 돌린다(원본 파일은 건드리지 않는다).
// dflow-export/tests/legacy-env.mjs 를 본뜬 것이지만 이 스킬 폴더에는 다른 이식 모듈(wbs-parse 등)의 legacy 도 함께 올 수 있으므로
// 이름이 다른 별도 파일로 두었고, 복사 대상은 위 두 스크립트로 한정한다.
//
// 사용법
//   const env = legacyEnv();                 // 임시 폴더 생성 + 복사 (python 이 없어도 호출 가능)
//   after(() => env.cleanup());
//   if (env.available) env.python(['decision-log.py', ...args], { cwd, normalizeEol })   // → {status, stdout, stderr}
//   env.script('decision-log.py')            // 복사본 절대 경로
//
// python 은 -B·PYTHONUTF8=1·PYTHONIOENCODING=utf-8 로 실행해 리포에 __pycache__ 를 남기지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython, makeTempDir, runCommand } from '../../_shared/node/proc.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LEGACY_DIR = path.join(HERE, 'golden', 'legacy');
export const SCRIPTS_DIR = path.join(HERE, '..', 'scripts');
export const NAMES = ['decision-log', 'prd-validate'];

export function legacyEnv() {
  const dir = makeTempDir('dflow-wbs-legacy-');
  for (const n of NAMES) fs.copyFileSync(path.join(LEGACY_DIR, `${n}.legacy.py`), path.join(dir, `${n}.py`));
  const pythonCmd = findPython();
  return {
    dir,
    available: !!pythonCmd,
    pythonCmd,
    python(args, opts = {}) {
      if (!pythonCmd) throw new Error('legacyEnv: python 3 을 찾지 못함 (env.available 을 먼저 확인)');
      return runCommand(pythonCmd, ['-B', ...args], {
        input: opts.input,
        cwd: opts.cwd ?? dir,
        normalizeEol: opts.normalizeEol ?? true,
        env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(opts.env ?? {}) },
      });
    },
    script: (name) => path.join(dir, name),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
