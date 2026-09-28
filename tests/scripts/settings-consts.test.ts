// env:local 이 병합하는 모듈 플래그(스펙 §4.1) — 8개 전부 'true', 기존 키·주석은 보존, 같은 키(false 포함)는 덮는다.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_FLAG_NAMES_SCRIPT, localModuleFlagEnv } from '../../scripts/lib/settings-consts.mjs'
import { mergeEnv } from '../../scripts/lib/targets.mjs'

describe('localModuleFlagEnv', () => {
  it('8개 키가 전부 true', () => {
    const env = localModuleFlagEnv()
    expect(Object.keys(env)).toEqual([...MODULE_FLAG_NAMES_SCRIPT])
    expect(new Set(Object.values(env))).toEqual(new Set(['true']))
  })
  it('mergeEnv 와 합치면 기존 false 를 덮고 다른 줄은 둔다', () => {
    const out = mergeEnv('# 로컬\nWIKI_SERVICE_ENABLED=false\nGEMINI_API_KEY=g\n', localModuleFlagEnv())
    expect(out).toContain('WIKI_SERVICE_ENABLED=true')
    expect(out).toContain('# 로컬\n')
    expect(out).toContain('GEMINI_API_KEY=g')
    for (const n of MODULE_FLAG_NAMES_SCRIPT) expect(out).toMatch(new RegExp(`^${n}=true$`, 'm'))
  })
})

describe('env-swap local — 실제 병합(T5-1)', () => {
  it('env-swap.mjs local 이 .env.local 에 모듈 플래그 8개를 true 로 쓰고 다른 줄은 둔다', () => {
    // 가짜 supabase(로컬 status 출력)를 PATH 앞에 두고 임시 폴더에서 돌린다 — 이 체크아웃의 .env.local 은 건드리지 않는다
    const dir = mkdtempSync(join(tmpdir(), 'env-swap-'))
    try {
      const bin = join(dir, 'supabase')
      writeFileSync(bin, "#!/bin/sh\nprintf 'API_URL=\"http://127.0.0.1:54321\"\\nANON_KEY=\"anon-test\"\\nSERVICE_ROLE_KEY=\"svc-test\"\\n'\n")
      chmodSync(bin, 0o755)
      writeFileSync(join(dir, '.env.local'), '# 로컬\nWIKI_SERVICE_ENABLED=false\nGEMINI_API_KEY=g\n')
      const r = spawnSync(process.execPath, [resolve('scripts/env-swap.mjs'), 'local'], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('✓ 모듈 플래그 8개 = true')
      const out = readFileSync(join(dir, '.env.local'), 'utf8')
      for (const n of MODULE_FLAG_NAMES_SCRIPT) expect(out).toMatch(new RegExp(`^${n}=true$`, 'm'))
      expect(out).not.toContain('WIKI_SERVICE_ENABLED=false')
      expect(out).toContain('# 로컬\n')
      expect(out).toContain('GEMINI_API_KEY=g')
      expect(out).toMatch(/^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321$/m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
