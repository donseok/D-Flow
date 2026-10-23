// legacy-env.mjs — python 원본(legacy) 사본을 임시 폴더에 "원래 이름"으로 복사해 python 으로 돌리는 도우미
// (dflow-export/tests/legacy-env.mjs 를 이 스킬용으로 줄인 것 — 이 스킬의 legacy 는 단독 파일이라 references 복사가 없다).
//
// 동결한 python 원본은 tests/golden/legacy/<이름>.legacy.py 에 있다. 골든 비교는 임시 폴더에 원래 이름
// (`wbs-nlevel-parse.py`, `test_wbs_nlevel_parse.py`)으로 복사해 그 폴더에서 돌린다.
//
// 사용법
//   const env = legacyEnv();                 // 임시 폴더 생성 + 복사 (python 이 없어도 호출 가능)
//   after(() => env.cleanup());              // node:test 의 after 에서 지운다
//   if (env.available) env.python([env.script('wbs-nlevel-parse.py'), 'validate', '--wbs', 'x.md'], { cwd });
//   env.pyVersion                            // [major, minor] (python 이 없으면 null)
// 규칙: `X.legacy.py` → `X.py`. python 은 `-B`·PYTHONUTF8=1·PYTHONIOENCODING=utf-8 로 실행해 __pycache__ 를 남기지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython, makeTempDir, runCommand } from '../../_shared/node/proc.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LEGACY_DIR = path.join(HERE, 'golden', 'legacy');

function listPy(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.py')).sort();
  } catch {
    return [];
  }
}

export function legacyEnv() {
  const dir = makeTempDir('nlevel-legacy-');
  for (const f of listPy(LEGACY_DIR)) {
    const name = f.endsWith('.legacy.py') ? `${f.slice(0, -'.legacy.py'.length)}.py` : f;
    fs.copyFileSync(path.join(LEGACY_DIR, f), path.join(dir, name));
  }
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
