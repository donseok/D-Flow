# SP0 포크 부트스트랩 Implementation Plan

> **익명화(2026-09-24):** 원본 고객사·구 브랜드·고객 업무 문자열은 일반 명칭으로 치환했다. 실측 재현 명령과 식별자도 함께 치환돼 있어 원본 리포에서 그대로 실행되지 않을 수 있다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wbs-web 사본(D-Flow)을 운영 원본 고객사 와 완전히 절연하고, 로컬 Supabase 위에서 빈 DB 로 로그인→프로젝트 생성→WBS 엑셀 임포트→주간보고 PPT/엑셀 내보내기가 완주하며 원본 고객사·원본 고객사·구 브랜드명 브랜드가 화면·산출물에 나오지 않는 출발선을 만든다.

**Architecture:** (1) 스크립트의 DB 좌표를 `scripts/lib/targets.mjs` 하나로 모으고 wbs-web 두 ref 를 금지 목록으로 박는다. (2) 운영 스키마를 읽기 전용으로 **한 번만** 덤프해 `0000_baseline.sql`·`0001_storage_realtime.sql`·카탈로그 JSON 을 만들고, 이후 검증(`baseline-diff`)은 그 JSON 과 로컬 DB 만 비교한다. (3) 로컬 개발은 Supabase CLI(`supabase start`/`db reset`)가 정본이고 롤백 파일은 `supabase/rollbacks/` 로 분리한다. (4) 브랜드는 `src/lib/branding.ts` 단일 출처.

**Tech Stack:** Next.js 15 · Supabase CLI 2.75 (Docker, Postgres 17) · Node ≥ 22.4 · vitest · JSZip · GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-23-sp0-fork-bootstrap-design.md` (상위: `docs/superpowers/specs/2026-09-23-generic-platform-design.md` 6.2 SP0)

## Global Constraints

- 금지 ref: `rglfgrwwwwdqejohdnty`(운영 원본 고객사)·`abtyahghvvkcriawffty`(wbs-web 스테이징). 운영 접속은 Task 5 의 `baseline-dump.mjs` **1회 읽기 전용**뿐이다. 그 외 어떤 명령도 이 두 ref 로 접속하지 않는다.
- 이 리포의 CLAUDE.md 는 Task 2 전까지 wbs-web 것이다 — 그 안의 Supabase ref·스테이징 절차·`npm run env:prod` 를 따르지 않는다.
- `git add -A` 금지, 파일명 명시. 마이그레이션(`supabase/migrations/*`)과 코드는 다른 커밋(G1).
- 마이그레이션 커밋 트레일러: `Staging-verified: local db reset <YYYY-MM-DD HH:MM>`. UI 위험 파일 커밋 트레일러: `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>`.
- 커밋 메시지는 한국어, "왜" 중심. 끝에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **push 는 사용자 확인 후에만.** `origin` 은 `github.com/donseok/D-Flow`. 원격 브랜치가 아직 없다(`git branch -r` 빈 결과).
- 제품명 기본값 `D-Flow`. AI 어시스턴트 표시명은 브랜드 중립 `AI 어시스턴트` / `AI Assistant`.
- 에러 처리 3원칙: 조회 실패를 "없음"으로 위장하지 않는다 · 선행 조회 실패 시 중단 · 보안 가드는 fail-closed.
- 각 Task 끝에서 `npx vitest run` 이 Task 1 기준선보다 나빠지지 않아야 한다(삭제된 테스트 제외).
- Docker Desktop 실행 필요: Task 5·6·7·17.

## 스펙 대비 조정(실측 근거, 사용자 검토 대상)

| 스펙 | 플랜 | 근거 |
|---|---|---|
| 4절 `db-apply --driver mgmt\|psql` | 추가하지 않음. 로컬 리허설은 `npm run db:reset`(전량 재생), `db-apply` 는 원격(mgmt) 전용으로 두고 `--target local` 은 "`npm run db:reset` 을 쓰라"는 안내로 거부 | CLI 가 로컬 적용·재생을 이미 한다. psql 드라이버는 SP9 자체호스트 때 필요해지면 그때 |
| 3.2 `0001` 수기 작성 | 운영 카탈로그(`pg_policies`·`storage.buckets`)에서 **생성**해 커밋 | 마이그레이션 텍스트 조립은 drop/재생성 이력 때문에 틀리기 쉽다. 생성본도 커밋 전 사람이 읽는다 |
| 3.3 diff 가 운영에 다시 접속 | 덤프 시 카탈로그를 `docs/baseline/prod-catalog.json` 으로 저장, diff 는 JSON↔로컬 | 운영 접속 1회로 줄인다 |
| 2절 `staging-sync.mjs` 자연 차단 | **삭제** | 운영 데이터를 복제하는 스크립트다 — 결정 1(원본 고객사 데이터 이관 없음)과 정면 충돌 |
| 5절 env `INVITE_EMAIL_DOMAINS` | 기존 이름 `INVITE_ALLOWED_DOMAINS` 유지 | 소비처(`src/app/actions/projectInvites.ts:194`)·테스트가 이미 이 이름 |
| 6절 `DEFAULT_TEAMS`·`LEGACY_COLUMN_MAP` → fixtures, `TeamsProvider` 기본값 `[]` | **이동하지 않음**(SP4 로) | 실측: `DEFAULT_TEAM_CODES`(=`DEFAULT_TEAMS` 파생)가 런타임 5파일(`excel/export.ts`·`ai/analytics.ts`·`domain/kanban.ts`·`domain/subact.ts`·`domain/minutes.ts`)에서 쓰이고, `LEGACY_COLUMN_MAP` 은 `parse.ts:31,34` 의 런타임 폴백이다 — 상위 스펙의 "런타임 importer 없는 것만 이동" 규칙에 걸린다. `TeamsProvider` 는 레이아웃이 항상 값을 주입해 기본값은 테스트에서만 쓰인다 |
| 5절 `TEAM_COLOR` 순번 팔레트 | `TEAM_COLOR` **삭제** | 실측 소비처 0 |

## Review Focus

- 운영 덤프에 금지 ref 문자열이 함수 본문(URL 등)으로 섞여 있을 때 → 덤프 스크립트가 파일을 쓰지 않고 해당 줄을 출력하며 중단해야 한다(Task 4 `postprocessDump` 테스트 "금지 ref 포함 시 throw").
- 덤프의 `GRANT … TO <로컬에 없는 롤>`(예: 운영 읽기 전용 롤) → 로컬 `db reset` 이 실패하지 않도록 표준 롤 외 GRANT/REVOKE 를 제거하고 제거 수를 보고해야 한다(Task 4 테스트).
- `.env.local` 이 금지 ref 를 가리킬 때 → `npm run dev` 가 어떤 우회 플래그로도 뜨지 않아야 한다(Task 1 `detectEnvTarget` 'forbidden' + check-env-target 테스트).
- `INVITE_ALLOWED_DOMAINS` 미설정·공백·`*` → 미설정/공백은 초대 거부(설정 안내 문구), `*` 만 전체 허용(Task 11 테스트).
- 빈 DB(팀 0개)에서 앱 기동 → teams 캐시가 빈 목록으로 정상 기동하고 오류 로그를 남기지 않아야 한다(Task 9 테스트 "빈 전역 teams 는 정상").

---

### Task 1: 작업 기반과 DB 좌표 격리

**Files:**
- Create: `scripts/lib/targets.mjs`, `tests/scripts/targets.test.ts`
- Modify: `scripts/check-env-target.mjs`, `scripts/env-swap.mjs`, `scripts/db-apply.mjs`, `scripts/embed-repair.mjs`, `scripts/index-backfill.mjs`, `scripts/lib/staging-core.mjs`, `tests/lib/staging-core.test.ts`
- Delete: `scripts/lib/staging.config.mjs`, `scripts/staging-sync.mjs`, `scripts/seatmap-load.mjs`, `.github/workflows/warm.yml`

**Interfaces:**
- Produces (`scripts/lib/targets.mjs`):
  - `FORBIDDEN_REFS: readonly string[]`
  - `LOCAL_DSN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'`
  - `assertNotForbidden(value: string, opts?: { allowForbidden?: 'readonly-baseline' }): void` — throw
  - `resolveTarget(name: 'local'|'staging'|'prod', env?: Record<string,string|undefined>): { name, kind: 'local'|'remote', dsn: string|null, ref: string|null }`
  - `detectEnvTarget(envText: string, env?): 'local'|'staging'|'prod'|'forbidden'|'unknown'`
  - `mergeEnv(existing: string, updates: Record<string,string>): string`
  - `localEnvFromStatus(statusEnvText: string): Record<string,string>` — `supabase status -o env` 출력 → `.env.local` 키

- [ ] **Step 1: 의존성 설치와 테스트 기준선 기록**

```bash
cd /Users/jerry/D-Flow
npm ci                                   # prepare 가 core.hooksPath=.githooks 를 건다
git config core.hooksPath                # 기대: .githooks
npx vitest run 2>&1 | tail -15 | tee /private/tmp/claude-501/-Users-jerry-D-Flow/sp0-vitest-baseline.txt
```

실패가 있으면 파일명을 기준선 파일에 남긴다(이후 Task 는 "이보다 나빠지지 않음"이 기준). 이 단계에서는 고치지 않는다.

- [ ] **Step 2: `targets` 실패 테스트 작성** — `tests/scripts/targets.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  FORBIDDEN_REFS, LOCAL_DSN, assertNotForbidden, resolveTarget, detectEnvTarget, mergeEnv, localEnvFromStatus,
} from '../../scripts/lib/targets.mjs'

const PROD_ORIGIN = 'rglfgrwwwwdqejohdnty'
const STG_WBSWEB = 'abtyahghvvkcriawffty'

describe('FORBIDDEN_REFS', () => {
  it('wbs-web 운영·스테이징 ref 둘을 담는다', () => {
    expect(FORBIDDEN_REFS).toEqual([PROD_ORIGIN, STG_WBSWEB])
  })
})

describe('assertNotForbidden', () => {
  it('금지 ref 를 포함하면 throw', () => {
    expect(() => assertNotForbidden(`https://${PROD_ORIGIN}.supabase.co`)).toThrow(/금지/)
    expect(() => assertNotForbidden(`postgresql://u.${STG_WBSWEB}:p@h/db`)).toThrow(/금지/)
  })
  it('readonly-baseline 예외만 통과', () => {
    expect(() => assertNotForbidden(PROD_ORIGIN, { allowForbidden: 'readonly-baseline' })).not.toThrow()
  })
  it('다른 값은 통과', () => { expect(() => assertNotForbidden('http://127.0.0.1:54321')).not.toThrow() })
})

describe('resolveTarget', () => {
  it('local 은 로컬 DSN', () => {
    expect(resolveTarget('local', {})).toEqual({ name: 'local', kind: 'local', dsn: LOCAL_DSN, ref: null })
  })
  it('LOCAL_DB_URL 로 덮어써도 금지 ref 면 throw', () => {
    expect(() => resolveTarget('local', { LOCAL_DB_URL: `postgresql://x.${PROD_ORIGIN}:p@h/db` })).toThrow(/금지/)
  })
  it('원격은 env 미설정이면 throw(fail-closed)', () => {
    expect(() => resolveTarget('prod', {})).toThrow(/PROD_REF 미설정/)
    expect(() => resolveTarget('staging', { STAGING_REF: '  ' })).toThrow(/STAGING_REF 미설정/)
  })
  it('원격 env 에 금지 ref 를 넣어도 throw', () => {
    expect(() => resolveTarget('prod', { PROD_REF: PROD_ORIGIN })).toThrow(/금지/)
  })
  it('원격 정상', () => {
    expect(resolveTarget('staging', { STAGING_REF: 'newstagingref0000000' }))
      .toEqual({ name: 'staging', kind: 'remote', dsn: null, ref: 'newstagingref0000000' })
  })
  it('모르는 대상은 throw', () => { expect(() => resolveTarget('dev' as never, {})).toThrow(/local\|staging\|prod/) })
})

describe('detectEnvTarget', () => {
  const env = (url: string) => `X=1\nNEXT_PUBLIC_SUPABASE_URL=${url}\n`
  it('로컬 URL', () => {
    expect(detectEnvTarget(env('http://127.0.0.1:54321'), {})).toBe('local')
    expect(detectEnvTarget(env('http://localhost:54321/'), {})).toBe('local')
  })
  it('금지 ref 는 forbidden', () => {
    expect(detectEnvTarget(env(`https://${PROD_ORIGIN}.supabase.co`), {})).toBe('forbidden')
  })
  it('env 로 등록한 원격', () => {
    expect(detectEnvTarget(env('https://newprodref000000000000.supabase.co'), { PROD_REF: 'newprodref000000000000' })).toBe('prod')
  })
  it('[회귀] 빈 값은 다음 줄을 URL 로 오인하지 않는다', () => {
    expect(detectEnvTarget(`NEXT_PUBLIC_SUPABASE_URL=\n\nX=https://${PROD_ORIGIN}.supabase.co`, {})).toBe('unknown')
  })
  it('파일 없음(빈 문자열)은 unknown', () => { expect(detectEnvTarget('', {})).toBe('unknown') })
})

describe('mergeEnv', () => {
  it('기존 키는 교체, 없는 키는 추가, 나머지 줄은 보존', () => {
    const out = mergeEnv('A=1\n# c\nGEMINI_API_KEY=g\n', { A: '2', B: '3' })
    expect(out).toBe('A=2\n# c\nGEMINI_API_KEY=g\nB=3\n')
  })
})

describe('localEnvFromStatus', () => {
  it('supabase status -o env 출력을 앱 env 로 옮긴다', () => {
    const status = 'API_URL="http://127.0.0.1:54321"\nANON_KEY="anon"\nSERVICE_ROLE_KEY="svc"\nDB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\n'
    expect(localEnvFromStatus(status)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })
  it('필수 키가 없으면 throw', () => { expect(() => localEnvFromStatus('API_URL="x"\n')).toThrow(/ANON_KEY/) })
})
```

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/scripts/targets.test.ts` → FAIL(모듈 없음)

- [ ] **Step 4: 구현** — `scripts/lib/targets.mjs`

```js
// scripts/lib/targets.mjs
// DB 대상 좌표의 단일 출처. D-Flow 는 wbs-web 의 사본이라 원본 DB 좌표가 곳곳에 남아 있었다 —
// 여기 금지 목록으로만 남기고, 어떤 경로로 들어온 값이든 금지 ref 를 담으면 멈춘다.
// 순수 모듈(부작용 없음) — vitest 로 검증한다.

export const FORBIDDEN_REFS = Object.freeze([
  'rglfgrwwwwdqejohdnty', // wbs-web 운영(원본 고객사 데이터)
  'abtyahghvvkcriawffty', // wbs-web 스테이징
])

export const LOCAL_DSN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** 금지 ref 를 담은 값이면 throw. 예외는 기준선 덤프의 읽기 전용 접속 하나뿐이다(SP0 스펙 2절). */
export function assertNotForbidden(value, { allowForbidden } = {}) {
  if (allowForbidden === 'readonly-baseline') return
  const hit = FORBIDDEN_REFS.find((r) => String(value ?? '').includes(r))
  if (hit) throw new Error(`금지된 wbs-web 좌표(${hit}) — D-Flow 는 원본 DB 에 접속하지 않는다`)
}

export function resolveTarget(name, env = process.env) {
  if (name === 'local') {
    const dsn = env.LOCAL_DB_URL?.trim() || LOCAL_DSN
    assertNotForbidden(dsn)
    return { name, kind: 'local', dsn, ref: null }
  }
  if (name === 'staging' || name === 'prod') {
    const key = name === 'staging' ? 'STAGING_REF' : 'PROD_REF'
    const ref = env[key]?.trim()
    if (!ref) throw new Error(`${key} 미설정 — 원격 ${name} 은 아직 없다(로컬 우선 개발, SP0 스펙 1.2)`)
    assertNotForbidden(ref)
    return { name, kind: 'remote', dsn: null, ref }
  }
  throw new Error(`대상은 local|staging|prod 중 하나 (현재: ${name})`)
}

export function detectEnvTarget(envText, env = process.env) {
  // [ \t]* — \s* 는 개행을 넘어 다음 줄 값을 URL 로 오인한다(wbs-web 회귀 테스트 보존).
  const url = envText.match(/^[ \t]*NEXT_PUBLIC_SUPABASE_URL[ \t]*=[ \t]*(\S*)/m)?.[1] ?? ''
  if (!url) return 'unknown'
  if (FORBIDDEN_REFS.some((r) => url.includes(r))) return 'forbidden'
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) return 'local'
  const prod = env.PROD_REF?.trim()
  const stg = env.STAGING_REF?.trim()
  if (prod && url.includes(prod)) return 'prod'
  if (stg && url.includes(stg)) return 'staging'
  return 'unknown'
}

/** KEY=VALUE 줄 단위 병합 — 주석·다른 키(GEMINI 등)는 그대로 둔다. */
export function mergeEnv(existing, updates) {
  const seen = new Set()
  const lines = existing.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const out = lines.map((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1]
    if (key && key in updates) { seen.add(key); return `${key}=${updates[key]}` }
    return line
  })
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) out.push(`${k}=${v}`)
  return out.join('\n') + '\n'
}

export function localEnvFromStatus(statusText) {
  const kv = {}
  for (const line of statusText.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m) kv[m[1]] = m[2]
  }
  for (const k of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
    if (!kv[k]) throw new Error(`supabase status 출력에 ${k} 가 없다 — supabase start 가 끝났는지 확인`)
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: kv.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: kv.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: kv.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  }
}
```

- [ ] **Step 5: 통과 확인** — `npx vitest run tests/scripts/targets.test.ts` → PASS

- [ ] **Step 6: 소비처 전환**

`scripts/check-env-target.mjs` 전체 교체:

```js
// scripts/check-env-target.mjs — predev 가드. 잘못된 DB 를 향한 dev 서버를 띄우지 못하게 한다.
import { readFileSync } from 'node:fs'
import { detectEnvTarget } from './lib/targets.mjs'

let text = ''
try { text = readFileSync('.env.local', 'utf8') } catch { /* 없으면 unknown */ }
const target = detectEnvTarget(text)
if (target === 'forbidden') {
  console.error('\n████ 차단: .env.local 이 wbs-web(원본) DB 를 가리킵니다 — 우회 불가 ████')
  console.error('  로컬로: npm run db:start && npm run env:local\n')
  process.exit(1)
}
if (target === 'prod' && process.env.FORCE_PROD_DEV !== '1') {
  console.error('\n████ 차단: .env.local 이 D-Flow 운영 DB 를 가리킵니다 ████')
  console.error('  의도적 운영 접속만: FORCE_PROD_DEV=1 npm run dev\n')
  process.exit(1)
}
if (target === 'unknown') {
  console.error('\n✗ .env.local 대상 판독 불가 — npm run db:start && npm run env:local 로 만드세요\n')
  process.exit(1)
}
console.log(`dev 대상: ${target}`)
```

`scripts/env-swap.mjs` 전체 교체:

```js
// scripts/env-swap.mjs — .env.local 대상을 바꾼다. local 은 supabase status 에서 생성, 원격은 .env.local.<대상> 복사.
// ⚠ 파일 교체는 이 PC 의 모든 병렬 세션에 즉시 영향을 준다.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { detectEnvTarget, localEnvFromStatus, mergeEnv } from './lib/targets.mjs'

const target = process.argv[2]
if (!['local', 'staging', 'prod'].includes(target)) { console.error('사용법: npm run env:local | env:staging | env:prod'); process.exit(1) }

if (target === 'local') {
  const status = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const existing = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
  writeFileSync('.env.local', mergeEnv(existing, localEnvFromStatus(status)))
} else {
  const src = `.env.local.${target}`
  if (!existsSync(src)) { console.error(`✗ ${src} 없음 — 원격 ${target} 은 아직 없다`); process.exit(1) }
  copyFileSync(src, '.env.local')
}
const got = detectEnvTarget(readFileSync('.env.local', 'utf8'))
if (got !== target) { console.error(`✗ 전환 검증 실패 — .env.local 이 ${got} 을 가리킴`); process.exit(1) }
console.log(`✓ .env.local → ${target}`)
```

`scripts/db-apply.mjs`: 상단 import 와 `REFS` 해석을 교체한다.

```js
import { resolveTarget } from './lib/targets.mjs'
// …(인자 파싱은 그대로)…
if (target === 'local') {
  console.error('로컬은 npm run db:reset 으로 전량 재생한다(SP0 스펙 — 리허설 정본). db:apply 는 원격 전용.')
  process.exit(1)
}
let ref
try { ref = resolveTarget(target).ref } catch (e) { console.error(`✗ ${e.message}`); process.exit(1) }
```

- 기존 `import { PROD_REF, STAGING_REF } from './lib/staging.config.mjs'`, `const REFS = …`, `if (!REFS[target]) …`, `const ref = REFS[target]` 줄을 지운다.
- `usage` 문자열은 `--target staging|prod` 그대로.
- `else { // staging 은 sync 와의 동시 실행만 배제 … }` 블록(`staging_ops.sync_lock` 조회)을 지운다. `staging-sync` 가 없어졌기 때문이다.

`scripts/embed-repair.mjs:27,62`, `scripts/index-backfill.mjs:14,176`: 같은 방식으로 바꾼다. `import { resolveTarget } from './lib/targets.mjs'` 를 추가하고, `REF`/`ref` 는 `resolveTarget(TARGET).ref` 로 얻는다(throw 는 그대로 전파). `staging.config` import 는 삭제한다.

`scripts/lib/staging-core.mjs`: `detectEnvTarget` 와 `assertStagingWritable` 를 삭제한다(각각 targets 로 이전됨 / 소비처였던 staging-sync 삭제). 삭제 전에 확인한다: `grep -rn "assertStagingWritable\|authTokenFixSql" scripts src` — 소비처가 없으면 `authTokenFixSql` 도 삭제한다. `parseDsnRef`·`maskDsn` 은 Task 5 에서 쓰므로 유지한다. `tests/lib/staging-core.test.ts` 에서 삭제한 함수의 describe 블록을 지운다(`detectEnvTarget` 회귀 케이스는 Step 2 테스트로 옮겨졌다).

삭제:

```bash
git rm scripts/lib/staging.config.mjs scripts/staging-sync.mjs scripts/seatmap-load.mjs .github/workflows/warm.yml
```

`package.json` scripts 정리: `"staging:sync"` 줄을 삭제한다. `"env:local": "node scripts/env-swap.mjs local"` 를 추가한다.

- [ ] **Step 7: 금지 ref 잔존 검사와 테스트**

```bash
grep -rn 'rglfgrwwwwdqejohdnty\|abtyahghvvkcriawffty' scripts src .github supabase tests package.json
```

기대 결과는 `scripts/lib/targets.mjs`, `tests/scripts/targets.test.ts`, `tests/lib/staging-core.test.ts`(cfg 픽스처), `supabase/migrations/0036_backport_prod_policies.sql`(Task 3 에서 삭제)뿐이다. 그 외가 나오면 그 파일도 `targets.mjs` 경유로 바꾼다.

```bash
npx vitest run tests/scripts tests/lib/staging-core.test.ts
node scripts/check-env-target.mjs; echo "exit=$?"     # .env.local 없음 → unknown → exit=1
```

- [ ] **Step 8: 커밋**

```bash
git add scripts/lib/targets.mjs tests/scripts/targets.test.ts scripts/check-env-target.mjs scripts/env-swap.mjs \
  scripts/db-apply.mjs scripts/embed-repair.mjs scripts/index-backfill.mjs scripts/lib/staging-core.mjs \
  tests/lib/staging-core.test.ts package.json
git commit -m "fix(scripts): wbs-web DB 좌표를 금지 목록으로 격리한다

사본의 staging.config 가 운영 원본 고객사 ref 를 그대로 들고 있어 db:apply --target prod 가
원본 운영에 쓰고 staging:sync 가 원본 데이터를 복제할 수 있었다. 좌표를 targets.mjs
하나로 모으고 원격은 env 미설정 시 멈추며, 두 원본 ref 는 어떤 경로로 들어와도 거부한다.
운영 데이터 복제기(staging-sync)·원본 고객사 좌석 로더·원본 운영을 치는 warm 크론은 삭제.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git rm` 한 파일은 이미 stage 돼 있다.)

---

### Task 2: CLAUDE.md 와 포크 정책 문서

**Files:**
- Modify: `CLAUDE.md` (전면 재작성)
- Create: `docs/fork-policy.md`

- [ ] **Step 1: `CLAUDE.md` 재작성** — 아래 구조로 쓴다(원문에서 유지되는 절은 그대로 옮기고, 삭제 대상은 옮기지 않는다).

```markdown
# D-Flow — 작업 규칙

범용 프로젝트 관리 플랫폼(가칭). wbs-web(구 브랜드명, 원본 고객사 운영)의 포크 — 컷오프 `wbs-web@77cf6785`.
Next.js 15 (App Router) + Tailwind v4 + Supabase. 설계 정본: docs/superpowers/specs/2026-09-23-generic-platform-design.md,
SP 별 스펙은 같은 폴더. 포크 규칙은 docs/fork-policy.md.

## 원본 DB 금지 (최우선)

wbs-web 의 Supabase `rglfgrwwwwdqejohdnty`(운영, 원본 고객사 데이터)·`abtyahghvvkcriawffty`(스테이징)에 접속하지 않는다.
`scripts/lib/targets.mjs` 의 금지 목록이 기계적으로 막는다 — 우회 플래그를 만들지 말 것.
예외: `scripts/baseline-dump.mjs`(SP0 기준선, 읽기 전용 1회). docs/superpowers/** 의 옛 문서에 박힌 ref·절차는 원본 리포 기록이다.

## 개발 환경 — 로컬 우선

원격 스테이징·운영 Supabase·Vercel 은 아직 없다(첫 배포 SP 에서 생성).
[npm run db:start / db:reset / env:local / dev 절차, Docker Desktop 전제]

## git 운영
[원문 "커밋" 절 그대로 — git add -A 금지, G1, 한국어 메시지]
[원문 "브랜치" 절 — UI 위험 파일 목록 그대로. 단 Preview 한계 단락은 "원격 Preview 가 없으므로 눈확인은 로컬 npm run dev,
 트레일러 Preview-checked: local <일시> — <화면>" 으로 교체]
- 마이그레이션 리허설: 로컬 `npm run db:reset` 초록 → 트레일러 `Staging-verified: local db reset <일시>`(G4).
- `git push --force origin main` 금지. push 는 사람 확인 후.
[원문 "pre-push 훅" 표 — G4 행을 "0001+ 마이그레이션" 으로]

## CSS — 반응형 안전망 주의
[원문 그대로]

## 데이터
- 새 마이그레이션에는 `supabase/rollbacks/NNNN_<이름>_rollback.sql` 을 함께 만든다(`supabase/migrations/` 에 두면 CLI 가 같이 적용한다).
- `supabase db push` 는 쓰지 않는다. 원격 적용은 `npm run db:apply -- <파일> --target staging|prod`(원격이 생긴 뒤).
- 번호는 파일 단위로 유일(`tests/invariants/migration-files.test.ts`).

## 권한
[원문 첫 두 불릿·가드 3종·에러 3원칙 유지. `memberships.role` deprecated 문장은 유지(기준선에 컬럼이 남아 있다, SP1 에서 폐기).
 "Supabase 계정 (2026-08-05 실측)" 절 전체와 원본 고객사 데이터 보호 문장은 삭제]

## 자주 쓰는 명령
[dev/build/lint/test/db:start/db:reset/env:local — smoke:prod·mark:good 는 "첫 배포 후" 로 표기]
```

대괄호 부분은 원문을 옮기는 지시다. 결과 파일에는 대괄호가 남지 않아야 한다.

- [ ] **Step 2: `docs/fork-policy.md` 작성** — 상위 스펙 6.6 절을 옮기고 다음을 추가한다.
  - **컷오프 정정:** `wbs-web@77cf6785e088e65a35857ae69b4b5b040fa13bf3`(staging). 2026-09-23 실측으로 origin/main 의 조상이고, 이후 마이그레이션 차이는 0건이다.
  - **금지 ref 두 개와 그 이유**
  - **보안 픽스 cherry-pick 절차:** `git remote add upstream`(merge·rebase 금지) → `git cherry-pick -x` → 트레일러 `Upstream-fix: wbs-web@<sha>` → 마이그레이션이 딸려 있으면 재번호.
  - **공유 패키지 없음**

- [ ] **Step 3: 검증과 커밋**

```bash
grep -n '\[' CLAUDE.md | grep -v '^\s*-\s*\[' | head     # 옮기기 지시 대괄호 잔존 0
git add CLAUDE.md docs/fork-policy.md
git commit -m "docs: CLAUDE.md 를 D-Flow 기준으로 다시 쓰고 포크 정책을 남긴다

사본의 CLAUDE.md 는 원본 운영 ref·스테이징 절차를 안내해 따르면 원본 고객사 DB 로 향한다.
로컬 우선 개발·원본 DB 금지·롤백 폴더 규약을 적고, 컷오프 좌표와 보안 픽스만 오가는
포크 정책을 별도 문서로 고정한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 구 마이그레이션 정리와 마이그레이션 불변식

**Files:**
- Delete: `supabase/migrations/*`(167파일), `tests/migrations/*`(41파일)
- Create: `supabase/rollbacks/.gitkeep`, `tests/invariants/migration-files.test.ts`
- Modify: `.githooks/pre-push:100,109`

**Interfaces:**
- Produces: 규약 — 정방향 `supabase/migrations/NNNN_<name>.sql`, 롤백 `supabase/rollbacks/NNNN_<name>_rollback.sql`, 예외 `0000`.

- [ ] **Step 1: 불변식 실패 테스트** — `tests/invariants/migration-files.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MIG = join(process.cwd(), 'supabase/migrations')
const RB = join(process.cwd(), 'supabase/rollbacks')
const list = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.sql')) : [])
const NO_ROLLBACK = new Set(['0000_baseline.sql']) // pg_dump 기준선 — 되돌아갈 이전 상태가 없다

describe('마이그레이션 파일 규약', () => {
  const forward = list(MIG)
  it('supabase/migrations 에 롤백 파일이 없다(CLI 가 함께 적용한다)', () => {
    expect(forward.filter((f) => f.includes('_rollback'))).toEqual([])
  })
  it('이름은 NNNN_snake.sql', () => {
    expect(forward.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f))).toEqual([])
  })
  it('번호는 파일 단위로 유일', () => {
    const nums = forward.map((f) => f.slice(0, 4))
    expect(nums.filter((n, i) => nums.indexOf(n) !== i)).toEqual([])
  })
  it('정방향마다 롤백 쌍(0000 제외)', () => {
    const rbs = new Set(list(RB))
    const missing = forward.filter((f) => !NO_ROLLBACK.has(f) && !rbs.has(f.replace(/\.sql$/, '_rollback.sql')))
    expect(missing).toEqual([])
  })
  it('짝 없는 롤백이 없다', () => {
    const fw = new Set(forward)
    expect(list(RB).filter((r) => !fw.has(r.replace(/_rollback\.sql$/, '.sql')))).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/invariants/migration-files.test.ts` → FAIL(현 폴더에 `_rollback` 70개·`0070` 중복)

- [ ] **Step 3: 삭제와 폴더**

```bash
git rm -q supabase/migrations/*.sql
mkdir -p supabase/rollbacks && touch supabase/rollbacks/.gitkeep
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS(빈 폴더)

- [ ] **Step 5: 마이그레이션 삭제 커밋(코드와 분리 — G1)**

```bash
git commit -m "chore(db): wbs-web 마이그레이션 체인을 걷어낸다

체인은 번호 공백 4개·0070 중복·운영 이메일 하드코딩·0058 시드가 있어 빈 DB 에 재생되지
않는다. D-Flow 는 운영 스키마 덤프(0000_baseline)를 기준선으로 새로 시작한다.

Staging-verified: local db reset n/a — 삭제만, 기준선은 다음 커밋들
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: `tests/migrations` 삭제, 훅 G4 컷오프**

```bash
git rm -q -r tests/migrations
```

`.githooks/pre-push` 100행과 109행의 `substr($0,21,4) + 0 >= 72` 를 두 곳 모두 `substr($0,21,4) + 0 >= 1` 로 바꾼다. 같은 파일에서 G4 설명 주석의 "0072" 도 "0001" 로 바꾼다(`grep -n 0072 .githooks/pre-push` 로 찾는다).

- [ ] **Step 7: 확인과 커밋**

```bash
npx vitest run tests/invariants tests/css
git add tests/invariants/migration-files.test.ts supabase/rollbacks/.gitkeep .githooks/pre-push
git commit -m "test(db): 마이그레이션 파일 규약을 불변식으로 고정하고 G4 를 0001 부터 건다

롤백이 migrations 폴더에 있으면 supabase db reset 이 롤백까지 적용한다. 롤백을
supabase/rollbacks 로 분리하고 번호 유일·쌍 존재를 테스트로 강제한다. 구 체인의 SQL
텍스트 단언 테스트 41개는 대상이 사라져 삭제.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 기준선 가공 라이브러리(순수 함수)

**Files:**
- Create: `scripts/lib/baseline.mjs`, `tests/scripts/baseline.test.ts`

**Interfaces:**
- Produces (`scripts/lib/baseline.mjs`):
  - `STANDARD_ROLES: readonly string[]` — `['postgres','anon','authenticated','service_role','supabase_admin','supabase_auth_admin','supabase_storage_admin','authenticator','dashboard_user','pgbouncer','supabase_realtime_admin','supabase_replication_admin','supabase_read_only_user','PUBLIC']`
  - `CATALOG_SQL: string` — 한 행 한 열 JSON 을 돌려주는 카탈로그 쿼리
  - `postprocessDump(dump: string, extensions: {name:string, schema:string}[]): { sql: string, droppedGrants: string[] }` — 금지 ref 포함 시 throw
  - `buildStorageRealtimeSql(catalog): { forward: string, rollback: string }`
  - `diffCatalog(expected, actual): { counts: Record<string,{expected:number,actual:number}>, problems: string[] }`
  - catalog 형태: `{ policies: {schema,table,name,permissive,roles:string[],cmd,qual:string|null,with_check:string|null}[], functions:{name,args,secdef}[], triggers:{table,name,def}[], rls_tables:string[], buckets:{id,public,file_size_limit:number|null,allowed_mime_types:string[]|null}[], extensions:{name,schema}[] }`

- [ ] **Step 1: 실패 테스트** — `tests/scripts/baseline.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { postprocessDump, buildStorageRealtimeSql, diffCatalog, CATALOG_SQL } from '../../scripts/lib/baseline.mjs'

const DUMP = [
  '\\restrict AbC123',
  'SET statement_timeout = 0;',
  'CREATE SCHEMA public;',
  "COMMENT ON SCHEMA public IS 'standard public schema';",
  'CREATE TABLE public.projects (id uuid NOT NULL);',
  'GRANT ALL ON TABLE public.projects TO authenticated;',
  'GRANT SELECT ON TABLE public.projects TO staging_reader;',
  'REVOKE ALL ON TABLE public.projects FROM some_custom_role;',
  'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;',
  '\\unrestrict AbC123',
].join('\n')

describe('postprocessDump', () => {
  const ext = [{ name: 'vector', schema: 'public' }, { name: 'pgcrypto', schema: 'extensions' }]
  it('메타명령·public 스키마 생성/주석을 지운다', () => {
    const { sql } = postprocessDump(DUMP, ext)
    expect(sql).not.toMatch(/\\restrict|\\unrestrict|CREATE SCHEMA public;|COMMENT ON SCHEMA public/)
    expect(sql).toContain('CREATE TABLE public.projects')
  })
  it('표준 롤 GRANT 는 남기고 그 밖의 롤 GRANT/REVOKE 는 제거·보고', () => {
    const { sql, droppedGrants } = postprocessDump(DUMP, ext)
    expect(sql).toContain('TO authenticated;')
    expect(sql).toContain('TO service_role;')
    expect(sql).not.toContain('staging_reader')
    expect(droppedGrants).toHaveLength(2)
  })
  it('확장을 파일 머리에 스키마 그대로 생성한다', () => {
    const { sql } = postprocessDump(DUMP, ext)
    expect(sql.indexOf('create extension if not exists "vector" with schema public;')).toBeLessThan(sql.indexOf('CREATE TABLE'))
    expect(sql).toContain('create extension if not exists "pgcrypto" with schema extensions;')
  })
  it('금지 ref 가 본문에 있으면 줄 번호와 함께 throw', () => {
    expect(() => postprocessDump(`${DUMP}\nselect 'https://rglfgrwwwwdqejohdnty.supabase.co';`, ext)).toThrow(/금지.*\d+행/)
  })
})

const CAT = {
  policies: [
    { schema: 'storage', table: 'objects', name: 'minutes_read', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: "(bucket_id = 'minutes'::text)", with_check: null },
    { schema: 'storage', table: 'objects', name: 'minutes_insert', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'INSERT', qual: null, with_check: "(bucket_id = 'minutes'::text)" },
    { schema: 'realtime', table: 'messages', name: 'receive_own_notification_channel', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: '(realtime.topic() = (\'user-\'::text || (auth.uid())::text))', with_check: null },
    { schema: 'public', table: 'projects', name: 'p_read', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: 'true', with_check: null },
  ],
  functions: [], triggers: [], rls_tables: ['projects'],
  buckets: [{ id: 'minutes', public: false, file_size_limit: 52428800, allowed_mime_types: null }],
  extensions: [],
}

describe('buildStorageRealtimeSql', () => {
  const { forward, rollback } = buildStorageRealtimeSql(CAT)
  it('storage·realtime 정책만 생성하고 public 정책은 기준선 몫으로 뺀다', () => {
    expect(forward).toContain('create policy "minutes_read" on storage.objects as permissive for select to authenticated using ((bucket_id = \'minutes\'::text));')
    expect(forward).toContain('create policy "minutes_insert" on storage.objects as permissive for insert to authenticated with check ((bucket_id = \'minutes\'::text));')
    expect(forward).toContain('on realtime.messages')
    expect(forward).not.toContain('p_read')
  })
  it('버킷을 멱등 insert', () => {
    expect(forward).toContain("insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('minutes', 'minutes', false, 52428800, null) on conflict (id) do nothing;")
  })
  it('롤백은 정책 drop + 버킷 delete', () => {
    expect(rollback).toContain('drop policy if exists "minutes_read" on storage.objects;')
    expect(rollback).toContain("delete from storage.buckets where id in ('minutes');")
  })
})

describe('diffCatalog', () => {
  it('같으면 문제 0', () => { expect(diffCatalog(CAT, structuredClone(CAT)).problems).toEqual([]) })
  it('정책 누락·본문 차이·RLS 차이를 잡는다', () => {
    const local = structuredClone(CAT)
    local.policies = local.policies.filter((p) => p.name !== 'minutes_insert')
    local.policies[0].qual = 'true'
    local.rls_tables = []
    const { problems, counts } = diffCatalog(CAT, local)
    expect(problems.some((p) => p.includes('누락') && p.includes('minutes_insert'))).toBe(true)
    expect(problems.some((p) => p.includes('다름') && p.includes('minutes_read'))).toBe(true)
    expect(problems.some((p) => p.includes('RLS') && p.includes('projects'))).toBe(true)
    expect(counts.policies).toEqual({ expected: 4, actual: 3 })
  })
  it('로컬에만 있는 확장은 문제가 아니다(Supabase 기본 확장)', () => {
    const local = structuredClone(CAT)
    local.extensions = [{ name: 'pg_graphql', schema: 'graphql' }]
    expect(diffCatalog(CAT, local).problems).toEqual([])
  })
})

describe('CATALOG_SQL', () => {
  it('확장 소속 함수를 제외한다(vector 가 public 에 있다)', () => { expect(CATALOG_SQL).toMatch(/deptype\s*=\s*'e'/) })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/scripts/baseline.test.ts` → FAIL

- [ ] **Step 3: 구현** — `scripts/lib/baseline.mjs`

```js
// scripts/lib/baseline.mjs — 운영 스키마 덤프를 D-Flow 기준선으로 가공하는 순수 함수(SP0 스펙 3절).
import { FORBIDDEN_REFS } from './targets.mjs'

export const STANDARD_ROLES = Object.freeze([
  'postgres', 'anon', 'authenticated', 'service_role', 'supabase_admin', 'supabase_auth_admin',
  'supabase_storage_admin', 'authenticator', 'dashboard_user', 'pgbouncer', 'supabase_realtime_admin',
  'supabase_replication_admin', 'supabase_read_only_user', 'PUBLIC',
])

export const CATALOG_SQL = `select json_build_object(
  'policies', (select coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename,'name',policyname,
      'permissive',permissive,'roles',roles,'cmd',cmd,'qual',qual,'with_check',with_check)
      order by schemaname,tablename,policyname),'[]') from pg_policies where schemaname in ('public','storage','realtime')),
  'functions', (select coalesce(json_agg(json_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),
      'secdef',p.prosecdef) order by p.proname, pg_get_function_identity_arguments(p.oid)),'[]')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype = 'e')),
  'triggers', (select coalesce(json_agg(json_build_object('table',c.relname,'name',t.tgname,'def',pg_get_triggerdef(t.oid))
      order by c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'),
  'rls_tables', (select coalesce(json_agg(tablename order by tablename),'[]') from pg_tables where schemaname='public' and rowsecurity),
  'buckets', (select coalesce(json_agg(json_build_object('id',id,'public',public,'file_size_limit',file_size_limit,
      'allowed_mime_types',allowed_mime_types) order by id),'[]') from storage.buckets),
  'extensions', (select coalesce(json_agg(json_build_object('name',e.extname,'schema',n.nspname) order by e.extname),'[]')
      from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname <> 'plpgsql')
)::text`

const GRANT_RE = /^(GRANT|REVOKE)\b.*\b(TO|FROM)\s+(.+?);\s*$/

export function postprocessDump(dump, extensions) {
  const lines = dump.split('\n')
  lines.forEach((line, i) => {
    const hit = FORBIDDEN_REFS.find((r) => line.includes(r))
    if (hit) throw new Error(`덤프 ${i + 1}행에 금지 ref(${hit}) — 기준선에 원본 좌표를 들일 수 없다: ${line.slice(0, 160)}`)
  })
  const droppedGrants = []
  const kept = lines.filter((line) => {
    if (/^\\(un)?restrict\b/.test(line)) return false
    if (/^CREATE SCHEMA public;/.test(line) || /^COMMENT ON SCHEMA public\b/.test(line)) return false
    const m = line.match(GRANT_RE)
    if (m) {
      const roles = m[3].split(',').map((r) => r.trim().replace(/^"|"$/g, ''))
      if (roles.some((r) => !STANDARD_ROLES.includes(r))) { droppedGrants.push(line); return false }
    }
    return true
  })
  const head = extensions.map((e) => `create extension if not exists "${e.name}" with schema ${e.schema};`)
  return { sql: [...head, '', ...kept].join('\n'), droppedGrants }
}

const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`)
const arr = (a) => (a === null ? 'null' : `array[${a.map(lit).join(', ')}]`)

export function buildStorageRealtimeSql(catalog) {
  const pols = catalog.policies.filter((p) => (p.schema === 'storage' && p.table === 'objects') || (p.schema === 'realtime' && p.table === 'messages'))
  const fwd = ['-- 0001_storage_realtime — 운영 카탈로그에서 생성(scripts/baseline-dump.mjs). pg_dump --schema=public 이 담지 않는 두 스키마.', '']
  for (const b of catalog.buckets) {
    fwd.push(`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${lit(b.id)}, ${lit(b.id)}, ${b.public}, ${lit(b.file_size_limit)}, ${arr(b.allowed_mime_types)}) on conflict (id) do nothing;`)
  }
  fwd.push('', 'alter table realtime.messages enable row level security;', '')
  for (const p of pols) {
    let s = `create policy "${p.name}" on ${p.schema}.${p.table} as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${p.roles.join(', ')}`
    if (p.qual !== null) s += ` using (${p.qual})`
    if (p.with_check !== null) s += ` with check (${p.with_check})`
    fwd.push(s + ';')
  }
  const rb = ['-- 0001_storage_realtime 롤백', '']
  for (const p of pols) rb.push(`drop policy if exists "${p.name}" on ${p.schema}.${p.table};`)
  if (catalog.buckets.length) rb.push(`delete from storage.buckets where id in (${catalog.buckets.map((b) => lit(b.id)).join(', ')});`)
  return { forward: fwd.join('\n') + '\n', rollback: rb.join('\n') + '\n' }
}

const keyOf = {
  policies: (p) => `${p.schema}.${p.table}.${p.name}`,
  functions: (f) => `${f.name}(${f.args})`,
  triggers: (t) => `${t.table}.${t.name}`,
  buckets: (b) => b.id,
}

export function diffCatalog(expected, actual) {
  const problems = []
  const counts = {}
  for (const kind of ['policies', 'functions', 'triggers', 'buckets']) {
    const e = new Map(expected[kind].map((x) => [keyOf[kind](x), x]))
    const a = new Map(actual[kind].map((x) => [keyOf[kind](x), x]))
    counts[kind] = { expected: e.size, actual: a.size }
    for (const [k, v] of e) {
      if (!a.has(k)) problems.push(`${kind} 누락: ${k}`)
      else if (JSON.stringify(v) !== JSON.stringify(a.get(k))) problems.push(`${kind} 다름: ${k}`)
    }
    for (const k of a.keys()) if (!e.has(k)) problems.push(`${kind} 초과: ${k}`)
  }
  const ea = new Set(actual.rls_tables)
  counts.rls_tables = { expected: expected.rls_tables.length, actual: actual.rls_tables.length }
  for (const t of expected.rls_tables) if (!ea.has(t)) problems.push(`RLS 꺼짐: ${t}`)
  for (const t of actual.rls_tables) if (!expected.rls_tables.includes(t)) problems.push(`RLS 초과: ${t}`)
  const ext = new Set(actual.extensions.map((x) => x.name))
  for (const x of expected.extensions) if (!ext.has(x.name)) problems.push(`확장 누락: ${x.name}`)
  return { counts, problems }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/scripts/baseline.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/lib/baseline.mjs tests/scripts/baseline.test.ts
git commit -m "feat(scripts): 운영 스키마 덤프를 기준선으로 가공하는 순수 함수

덤프에는 로컬에 없는 읽기 전용 롤 GRANT·pg_dump 17 메타명령·public 스키마 생성문이
섞여 db reset 이 실패한다. 이를 규칙으로 걷어내고, 원본 좌표가 본문에 있으면 기준선을
쓰지 않고 멈춘다. storage/realtime 정책은 카탈로그에서 생성하고 비교도 같은 형태로 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 운영 스키마 1회 덤프 → `0000`·`0001`·카탈로그

**전제:** Docker Desktop 실행 중(`docker info` 성공). 사용자에게 "운영 원본 고객사 에 읽기 전용으로 1회 접속한다"고 알리고 진행 확인을 받는다.

**Files:**
- Create: `scripts/baseline-dump.mjs`, `supabase/migrations/0000_baseline.sql`, `supabase/migrations/0001_storage_realtime.sql`, `supabase/rollbacks/0001_storage_realtime_rollback.sql`, `docs/baseline/prod-catalog.json`

**Interfaces:**
- Consumes: `postprocessDump`, `buildStorageRealtimeSql`, `CATALOG_SQL`(Task 4), `assertNotForbidden`(Task 1), `parseDsnRef`·`maskDsn`(`scripts/lib/staging-core.mjs`)

- [ ] **Step 1: 스크립트 작성** — `scripts/baseline-dump.mjs`

```js
// scripts/baseline-dump.mjs — SP0 기준선. 운영 원본 고객사 스키마를 읽기 전용으로 1회 덤프한다(데이터 제외).
// 이 리포에서 원본 DB 에 접속하는 유일한 스크립트다. 재실행은 기준선을 바꾸는 행위이므로 커밋 이력으로 남긴다.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { assertNotForbidden, FORBIDDEN_REFS } from './lib/targets.mjs'
import { parseDsnRef, maskDsn } from './lib/staging-core.mjs'
import { CATALOG_SQL, buildStorageRealtimeSql, postprocessDump } from './lib/baseline.mjs'

const die = (m) => { console.error(`✗ ${m}`); process.exit(1) }
const sh = (cmd, args, input) => execFileSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'] })

const dsn = sh('security', ['find-generic-password', '-s', 'DFlow Prod Reader', '-w']).trim()
if (parseDsnRef(dsn) !== FORBIDDEN_REFS[0]) die('키체인 "DFlow Prod Reader" 가 운영 ref 를 가리키지 않는다')
const user = dsn.match(/^postgresql:\/\/([^:@/]+)/)?.[1] ?? ''
if (user === 'postgres' || user.startsWith('postgres.')) die(`읽기 전용 롤이 아니다(${user}) — 중단`)
assertNotForbidden(dsn, { allowForbidden: 'readonly-baseline' })
console.log(`읽기 원본: ${maskDsn(dsn)} (읽기 전용 세션)`)

// 세션 자체를 읽기 전용으로 — 자격증명(읽기 롤)과 이중 방어.
const docker = (bin, args) => sh('docker', ['run', '--rm', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', 'postgres:17', bin, dsn, ...args])
const ver = docker('pg_dump', ['--version']).match(/(\d+)\./)?.[1]
if (Number(ver) < 17) die(`pg_dump ${ver} < 17`)

const catalog = JSON.parse(docker('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', CATALOG_SQL]).trim())
const wanted = new Set(['vector', 'pg_trgm', 'pgcrypto', 'uuid-ossp', 'unaccent', 'citext'])
const extensions = catalog.extensions.filter((e) => wanted.has(e.name))
console.log(`카탈로그: 정책 ${catalog.policies.length} · 함수 ${catalog.functions.length} · 트리거 ${catalog.triggers.length} · 버킷 ${catalog.buckets.length} · 확장 ${extensions.map((e) => `${e.name}@${e.schema}`).join(',')}`)

const raw = docker('pg_dump', ['--schema-only', '--schema=public', '--no-owner', '--no-comments'])
const { sql, droppedGrants } = postprocessDump(raw, extensions)
if (droppedGrants.length) console.log(`표준 롤 밖 GRANT/REVOKE ${droppedGrants.length}건 제거:\n  ${droppedGrants.join('\n  ')}`)

const stamp = new Date().toISOString()
writeFileSync('supabase/migrations/0000_baseline.sql',
  `-- 0000_baseline — wbs-web 운영 public 스키마(pg_dump ${ver} --schema-only), 컷오프 wbs-web@77cf6785, 덤프 ${stamp}.\n` +
  `-- 생성: scripts/baseline-dump.mjs. 손으로 고치지 않는다 — 고칠 것은 scripts/lib/baseline.mjs 규칙으로.\n\n${sql}`)
const { forward, rollback } = buildStorageRealtimeSql(catalog)
writeFileSync('supabase/migrations/0001_storage_realtime.sql', forward)
writeFileSync('supabase/rollbacks/0001_storage_realtime_rollback.sql', rollback)
mkdirSync('docs/baseline', { recursive: true })
writeFileSync('docs/baseline/prod-catalog.json', JSON.stringify({ capturedAt: stamp, cutoff: 'wbs-web@77cf6785', ...catalog }, null, 2) + '\n')
console.log('✓ 0000_baseline.sql · 0001_storage_realtime.sql(+rollback) · docs/baseline/prod-catalog.json')
```

`--no-comments` 는 `COMMENT ON` 을 뺀다. 주석에 운영 좌표·실명이 들어 있을 수 있고, 기준선 비교 대상도 아니다.

- [ ] **Step 2: 실행**

```bash
docker info >/dev/null && node scripts/baseline-dump.mjs
```

기대 결과: 카탈로그 요약과 제거된 GRANT 목록이 출력되고 파일 4개가 생성된다.
금지 ref 때문에 throw 하면 출력된 행을 사용자에게 보여 주고 처리 방법을 묻는다. 기준선을 손으로 편집하지 않는다.

- [ ] **Step 3: 생성물 검토**

```bash
wc -l supabase/migrations/0000_baseline.sql supabase/migrations/0001_storage_realtime.sql
grep -c '^CREATE POLICY' supabase/migrations/0000_baseline.sql
grep -cE '^create policy' supabase/migrations/0001_storage_realtime.sql   # 상위 스펙 기대: storage 9 + realtime 2 = 11
grep -rn 'rglfgrwwwwdqejohdnty\|abtyahghvvkcriawffty' supabase docs/baseline   # 0건
grep -niE 'origincorp|@origincorp|원본 고객사' supabase/migrations/0000_baseline.sql | head  # 결과를 기록(함수 본문 하드코딩 여부 — 있으면 사용자 보고, SP1 이후 과제로 남김)
```

`0001` 의 정책 수가 11 이 아니면 운영 실측이 정본이다. 차이를 기록하고 커밋 메시지에 적는다.

- [ ] **Step 4: 스크립트 커밋(코드)**

```bash
git add scripts/baseline-dump.mjs
git commit -m "feat(scripts): 운영 스키마를 읽기 전용으로 1회 덤프하는 기준선 스크립트

읽기 롤 자격증명에 더해 세션도 default_transaction_read_only 로 열고, 카탈로그를 JSON 으로
함께 떠서 이후 검증이 운영에 다시 접속하지 않게 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: 기준선 커밋(마이그레이션 전용 — Task 6 의 db reset 성공 후에 한다)** — 파일은 만들어 둔 채 Task 6 으로 간다. 커밋 명령은 Task 6 Step 6 에 있다.

---

### Task 6: 로컬 Supabase 환경과 개발 부트스트랩

**Files:**
- Modify: `supabase/config.toml:5`, `supabase/seed.sql`, `package.json`
- Create: `scripts/dev-bootstrap.mjs`

**Interfaces:**
- Consumes: `resolveTarget('local')`, `localEnvFromStatus`, `mergeEnv`(Task 1)
- Produces: npm 스크립트 `db:start`·`db:stop`·`db:reset`·`env:local`·`dev:bootstrap`

- [ ] **Step 1: 설정**
  - `supabase/config.toml` 5행: `project_id = "d-flow"`
  - `supabase/seed.sql` 전체 교체:

```sql
-- 로컬 개발 시드 — 의도적으로 비어 있다. 팀·프로젝트는 앱에서 만든다(SP0: 5팀 가정 제거).
-- 첫 슈퍼유저는 npm run dev:bootstrap (비밀번호를 파일에 두지 않기 위해 스크립트로).
select 1;
```

  - `package.json` scripts 에 추가:

```json
"db:start": "supabase start",
"db:stop": "supabase stop",
"db:reset": "supabase db reset",
"dev:bootstrap": "node scripts/dev-bootstrap.mjs",
```

- [ ] **Step 2: 기동과 재생**

```bash
npm run db:start
npm run db:reset 2>&1 | tail -20
```

기대 결과: `Applying migration 0000_baseline.sql…`, `0001_storage_realtime.sql…`, `Seeding data…`, `Finished supabase db reset`.

실패하면 오류 유형별로 다음처럼 처리하고, `scripts/lib/baseline.mjs` 규칙과 테스트를 먼저 추가한 뒤 Task 5 Step 2 를 다시 실행한다. **`0000` 을 손으로 편집하지 않는다.**
- 없는 롤: `STANDARD_ROLES` 에 추가할지, GRANT 를 제거할지 판단한다.
- 확장 스키마 불일치: `wanted` 집합과 확장이 생성될 스키마를 조정한다.
- 이미 존재하는 객체: 해당 줄을 걸러내는 규칙을 추가한다.

- [ ] **Step 3: 기준선 스키마 사실 확인** — 부트스트랩 코드가 기대하는 컬럼·제약을 실측한다.

```bash
docker exec supabase_db_d-flow psql -U postgres -At -c "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.memberships'::regclass"
docker exec supabase_db_d-flow psql -U postgres -At -c "select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name in ('memberships','teams') order by table_name, ordinal_position"
```

`memberships.role` 허용값과 `teams` 필수 컬럼을 Step 4 코드와 대조한다. 다르면 Step 4 의 insert 값을 실측값에 맞춘다.

- [ ] **Step 4: `scripts/dev-bootstrap.mjs`**

```js
// scripts/dev-bootstrap.mjs — 로컬 빈 DB 에 첫 슈퍼유저를 만든다. 로컬 전용.
// memberships.team_id 가 not null(기준선 그대로, SP1 에서 폐기)이라 중립 전역 팀 1개를 함께 만든다.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { detectEnvTarget } from './lib/targets.mjs'

const envText = readFileSync('.env.local', 'utf8')
if (detectEnvTarget(envText) !== 'local') { console.error('✗ .env.local 이 로컬이 아니다 — 부트스트랩은 로컬 전용'); process.exit(1) }
const env = Object.fromEntries(envText.split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]))

const rl = createInterface({ input: process.stdin, output: process.stdout })
const email = (process.env.BOOTSTRAP_EMAIL || await rl.question('슈퍼유저 이메일: ')).trim().toLowerCase()
const password = process.env.BOOTSTRAP_PASSWORD || await rl.question('비밀번호(10자 이상): ')
const teamCode = (process.env.BOOTSTRAP_TEAM || '운영').trim()
rl.close()

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: created, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (uErr) { console.error(`✗ 계정 생성 실패: ${uErr.message}`); process.exit(1) }

const { data: team, error: tErr } = await admin.from('teams').upsert({ code: teamCode, name: teamCode }, { onConflict: 'code' }).select('id').single()
if (tErr) { console.error(`✗ 팀 생성 실패: ${tErr.message}`); process.exit(1) }

const { error: mErr } = await admin.from('memberships').insert({ user_id: created.user.id, team_id: team.id, role: 'pmo_admin', is_superuser: true })
if (mErr) { console.error(`✗ 멤버십 생성 실패: ${mErr.message}`); process.exit(1) }
console.log(`✓ 슈퍼유저 ${email} (팀 ${teamCode}) — npm run dev 후 로그인`)
```

- [ ] **Step 5: 실행 확인**

```bash
npm run env:local && grep -c '^NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321' .env.local   # 1
npm run dev:bootstrap
node scripts/check-env-target.mjs    # "dev 대상: local"
```

- [ ] **Step 6: 커밋 두 개(마이그레이션 / 코드 분리)**

```bash
git add supabase/migrations/0000_baseline.sql supabase/migrations/0001_storage_realtime.sql supabase/rollbacks/0001_storage_realtime_rollback.sql docs/baseline/prod-catalog.json
git commit -m "feat(db): 운영 스키마 기준선 0000 과 storage/realtime 0001

wbs-web 체인은 재생되지 않아 운영 스키마 덤프를 D-Flow 의 출발점으로 삼는다(데이터 제외).
pg_dump --schema=public 이 담지 않는 버킷·storage/realtime 정책은 운영 카탈로그에서 생성했다.
카탈로그 JSON 은 이후 baseline-diff 의 기대값이다.

Staging-verified: local db reset $(date '+%Y-%m-%d %H:%M')
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

`Staging-verified:` 줄의 `$(date …)` 는 실행 시각으로 채워진다(큰따옴표 안이라 셸이 치환한다). 대신 `git commit -F` 로 직접 적어도 된다.

```bash
git add supabase/config.toml supabase/seed.sql package.json scripts/dev-bootstrap.mjs
git commit -m "feat(dev): 로컬 Supabase 로 빈 DB 개발 환경을 띄운다

원격 스테이징 없이 supabase start/db reset 이 개발·리허설의 정본이다. 5팀 시드를 비우고
첫 슈퍼유저는 비밀번호를 파일에 남기지 않도록 부트스트랩 스크립트로 만든다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

`supabase/seed.sql` 은 `supabase/migrations/` 밖이라 G1 대상이 아니다.

---

### Task 7: 기준선 대조(`baseline-diff`)

**Files:**
- Create: `scripts/baseline-diff.mjs`, `docs/baseline/2026-09-23-live-catalog.md`

**Interfaces:**
- Consumes: `CATALOG_SQL`, `diffCatalog`(Task 4), `docs/baseline/prod-catalog.json`(Task 5)

- [ ] **Step 1: 스크립트**

```js
// scripts/baseline-diff.mjs — 로컬 db reset 결과가 운영 카탈로그(덤프 시점 JSON)와 같은지. 운영에 접속하지 않는다.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { CATALOG_SQL, diffCatalog } from './lib/baseline.mjs'

const expected = JSON.parse(readFileSync('docs/baseline/prod-catalog.json', 'utf8'))
const out = execFileSync('docker', ['exec', 'supabase_db_d-flow', 'psql', '-U', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', CATALOG_SQL], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const actual = JSON.parse(out.trim())
const { counts, problems } = diffCatalog(expected, actual)
for (const [k, v] of Object.entries(counts)) console.log(`${k.padEnd(10)} 운영 ${v.expected} · 로컬 ${v.actual}`)
if (process.argv.includes('--snapshot')) {
  const rows = expected.policies.map((p) => `| ${p.schema}.${p.table} | ${p.name} | ${p.cmd} | ${p.roles.join(',')} | \`${(p.qual ?? '').replace(/\|/g, '\\|')}\` | \`${(p.with_check ?? '').replace(/\|/g, '\\|')}\` |`)
  writeFileSync('docs/baseline/2026-09-23-live-catalog.md',
    `# 운영 라이브 카탈로그 스냅샷 (${expected.capturedAt}, ${expected.cutoff})\n\n` +
    `SP2 스펙의 "라이브 정책 목록" 입력(상위 스펙 6.7). 생성: \`node scripts/baseline-diff.mjs --snapshot\`.\n\n` +
    Object.entries(counts).map(([k, v]) => `- ${k}: ${v.expected}`).join('\n') +
    `\n- \`using (true)\` 읽기 정책: ${expected.policies.filter((p) => p.qual === 'true' && ['SELECT', 'ALL'].includes(p.cmd)).length}\n\n` +
    `| 테이블 | 정책 | cmd | roles | using | with check |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`)
  console.log('✓ docs/baseline/2026-09-23-live-catalog.md')
}
if (problems.length) { console.error(`✗ 불일치 ${problems.length}건\n  ${problems.join('\n  ')}`); process.exit(1) }
console.log('✓ 불일치 0')
```

- [ ] **Step 2: 실행** — `node scripts/baseline-diff.mjs --snapshot` → `✓ 불일치 0`.
불일치가 나오면 Task 6 Step 2 와 같은 원칙으로 처리한다: 규칙을 수정 → 덤프를 다시 실행(운영 재접속은 사용자 확인 후) → reset 을 다시 실행.

- [ ] **Step 3: 커밋** — 스냅샷(md)과 스크립트는 코드·문서 커밋이다.

```bash
git add scripts/baseline-diff.mjs docs/baseline/2026-09-23-live-catalog.md
git commit -m "feat(scripts): 로컬 기준선을 운영 카탈로그와 대조하고 라이브 정책 목록을 남긴다

마이그레이션 grep 수치와 라이브 상태가 다르다는 상위 스펙 6.7 의 열린 항목을 닫는다.
스냅샷은 SP2 격리 작업의 입력이다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (`engines`, `name`)

- [ ] **Step 1: `package.json`** — `"name": "d-flow"`, 최상위에 `"engines": { "node": ">=22.4" }`. 그다음 `npm install --package-lock-only` 로 lock 의 name 을 동기화한다.

- [ ] **Step 2: `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push: { branches: ['**'] }
  pull_request: {}
permissions: { contents: read }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build
        env:
          # 빌드는 env 존재만 요구한다 — 원격 DB 에 접속하지 않는 더미 값.
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-dummy
          SUPABASE_SERVICE_ROLE_KEY: ci-dummy
  db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: 2.75.0 }
      - run: supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor
      - run: supabase db reset
      - run: node scripts/baseline-diff.mjs
```

- [ ] **Step 3: 로컬 사전 검증**

```bash
npm run lint && NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x npm run build
```

빌드가 다른 env 를 요구하며 실패하면, 그 키를 `ci.yml` 의 `env` 에 더미 값으로 추가한다. 키 이름은 빌드 오류 메시지에서 확인한다.

- [ ] **Step 4: 커밋** — `git add .github/workflows/ci.yml package.json package-lock.json` 후 커밋(메시지: "ci: lint·test·build 와 기준선 재생 잡 — …왜…"). CI 초록 확인은 push 후(Task 17).

---

### Task 9: 팀 폴백 제거와 원본 고객사 잔재 정리

**Files:**
- Modify: `src/lib/teams/master.ts:18-19,46-48,67-70,135-137`, `tests/lib/teams-master.test.ts:48-58`, `src/lib/domain/minutes.ts:84-96`, `tests/minutes/team-subgroups.test.ts:54-65`, `src/lib/excel/profile.ts:141-142` 및 `LEGACY_ORIGIN_PROFILE` 소비처 4파일·테스트 8파일

- [ ] **Step 1: 테스트를 새 동작으로 교체** — `tests/lib/teams-master.test.ts` 의 두 케이스:

```ts
  it('콜드스타트 로드 실패 시 빈 목록 — 기본 팀을 지어내지 않는다', async () => {
    db.error = { message: 'down' }
    const m = await importMaster()
    expect(m.activeTeamCodesSync()).toEqual([])
  })

  it('빈 전역 teams 는 정상 — 빈 목록, 오류 로그 없음', async () => {
    db.rows = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(m.activeTeamCodesSync()).toEqual([])
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
```

(파일 상단에 `vi` import 가 없으면 추가한다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/lib/teams-master.test.ts` → 두 케이스 FAIL

- [ ] **Step 3: `master.ts` 수정**
  - `import { activeCodes, DEFAULT_TEAMS, resolveTeamsForProject, type Team }` → `DEFAULT_TEAMS` 제거
  - `let cache: readonly Team[] = DEFAULT_TEAMS` → `let cache: readonly Team[] = []`
  - `everLoaded` 주석: "'직전 유효값 보존 vs 빈 목록'을 가르는 기준"
  - `fetchTeams` 의 "빈 목록은 폴백 유지…" 주석 2줄과 `if (teams.filter(…).length === 0) throw …` 줄 삭제
  - `load()` catch 의 `'[teams] 최초 팀 마스터 로드 실패 — 기본 5팀으로 기동:'` → `'[teams] 최초 팀 마스터 로드 실패 — 빈 목록으로 기동:'`, 위 주석의 "기본 5팀" → "빈 목록"
  - 파일 끝 주석 "폴백 5팀으로 렌더된다" → "빈 팀 목록으로 렌더된다"

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS

- [ ] **Step 5: `TEAM_SUB_ALIASES` 삭제** — `src/lib/domain/minutes.ts`
  - 84~86행: 별칭 설명 주석과 `const TEAM_SUB_ALIASES` 를 삭제한다.
  - `resolveTeamSub` 의 `@deprecated` 문구와 별칭 두 줄(`const alias = …`, `return alias …`)을 `return null` 로 바꾼다. 결과는 "목록에 있으면 그 이름, 아니면 null" 이다.
  - `tests/minutes/team-subgroups.test.ts` 56·60행: `APS` 별칭을 기대하는 두 단언을 `expect(resolveTeamSub(tree, 'MES', 'APS')).toBeNull()` 한 줄로 바꾼다. 60행의 withAps 케이스(실폴더 우선)는 그대로 둔다.

- [ ] **Step 6: `LEGACY_ORIGIN_PROFILE` 개명**

```bash
grep -rl LEGACY_ORIGIN_PROFILE src tests | xargs sed -i '' 's/LEGACY_ORIGIN_PROFILE/LEGACY_EXCEL_PROFILE_V1/g'
```

`src/lib/excel/profile.ts:141` 주석 "원본 고객사 현행 3행 헤더 규약(5팀)" → "레거시 3행 헤더 규약 v1(5팀 열) — 라운드트립 계약 테스트의 기준, SP4 에서 fixtures 로 이동"

- [ ] **Step 7: 전체 테스트와 커밋**

```bash
npx vitest run
git add src/lib/teams/master.ts tests/lib/teams-master.test.ts src/lib/domain/minutes.ts tests/minutes/team-subgroups.test.ts $(git diff --name-only | grep -E 'profile|export|parse|import' )
git status --short   # stage 누락 없는지 확인 후
git commit -m "refactor(teams): 기본 5팀 폴백과 APS 별칭을 걷어낸다

빈 DB 로 출발하는 플랫폼에서 공용 팀 0개는 정상이다. 폴백은 원본 고객사 5팀을 지어내 화면에
보이게 했다. 레거시 엑셀 프로파일은 식별자에서 고객명을 뺀다(런타임 사용이 남아 SP4 에서 이동).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 프로젝트 생성 — 라벨 필수, 프리셋 삭제

**Files:**
- Modify: `src/app/actions/project.ts:55-86`, `src/components/home/NewProjectModal.tsx`, `src/lib/i18n/dict/home.ts`, `src/lib/i18n/dict/home.en.ts`, `tests/actions/project-actions.test.ts`
- Delete: `src/lib/domain/projectPresets.ts`, `tests/domain/project-presets.test.ts`

**Interfaces:**
- Produces: `createProject(name: string, start: string|null, end: string|null, description: string|null, levelLabels: string[]): Promise<void>` — 라벨 검증 실패·설정 저장 실패 시 throw
- Consumes: `validateLevelSettings({ labels, currentTreeMaxDepth: null })`(`src/lib/domain/levelSettings.ts:36`)

- [ ] **Step 1: 테스트 교체** — `tests/actions/project-actions.test.ts` 의 `describe('createProject …')` 블록 전체를 교체:

```ts
describe('createProject — 단계 라벨 필수(SP0, 프리셋 없음)', () => {
  it('입력 라벨로 project_settings 를 만들고 preset_applied 는 쓰지 않는다', async () => {
    await createProject('신규 프로젝트', '2026-01-01', '2026-12-31', '설명', ['단계', '작업'])
    expect(db.insertedSettings).toMatchObject({ project_id: 'proj-1', level_labels: ['단계', '작업'], max_depth: 2, extra_axis_label: null })
    expect(db.insertedSettings).not.toHaveProperty('preset_applied')
    expect((db.insertedSettings as { milestone_keywords: string[] }).milestone_keywords.length).toBeGreaterThan(0)
  })

  it('라벨이 비면 DB 를 건드리기 전에 거부', async () => {
    await expect(createProject('P', null, null, null, [])).rejects.toThrow(/단계/)
    await expect(createProject('P', null, null, null, ['단계', ' '])).rejects.toThrow(/비어/)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('설정 저장 실패는 조용히 넘기지 않는다', async () => {
    db.settingsInsertError = { message: 'RLS 위반' }
    await expect(createProject('P2', null, null, null, ['단계'])).rejects.toThrow(/RLS 위반/)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/actions/project-actions.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/app/actions/project.ts`
  - `import { PRESETS } from '@/lib/domain/projectPresets'` 를 삭제한다.
  - `import { validateLevelSettings } from '@/lib/domain/levelSettings'` 가 없으면 추가한다.
  - `createProject` 를 아래로 교체한다.

```ts
/** 마일스톤 카드 키워드 기본값 — 빈 배열이면 카드가 무증상 소실된다(§7.4). 설정 화면에서 바꾼다. */
const DEFAULT_MILESTONE_KEYWORDS = ['마일스톤', 'milestone', '킥오프', 'kick-off', '오픈', '완료보고']

export async function createProject(
  name: string,
  start: string | null,
  end: string | null,
  description: string | null,
  levelLabels: string[],
) {
  // 프로젝트 생성은 전역 관리 — 슈퍼유저만.
  const g = await requireSuperuser()
  if (!g.ok) throw new Error(g.error)
  if (!isValidDateRange(start || null, end || null)) throw new Error('종료일은 시작일보다 빠를 수 없습니다.')
  // 프리셋 없음(결정 5) — 단계 라벨은 생성자가 입력한다. 검증은 설정 화면과 같은 순수 함수.
  const lv = validateLevelSettings({ labels: levelLabels, currentTreeMaxDepth: null })
  if (!lv.ok) throw new Error(lv.error)
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('projects')
    .insert({ name, start_date: start, end_date: end, description })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  // project_settings 는 쓰기 정책이 없다(0058 — service_role 전용 관문) — admin 클라이언트가 필요하다.
  const admin = createAdminClient()
  const { error: settingsErr } = await admin.from('project_settings').insert({
    project_id: data.id,
    level_labels: lv.labels,
    max_depth: lv.maxDepth,
    extra_axis_label: null,
    milestone_keywords: DEFAULT_MILESTONE_KEYWORDS,
  })
  // 라벨은 사용자가 입력한 값이다 — 저장 실패를 폴백 라벨로 덮으면 입력이 조용히 사라진다.
  if (settingsErr) throw new Error(`프로젝트는 생성됐으나 단계 설정 저장 실패: ${settingsErr.message}`)
  revalidatePath('/projects')
}
```

`validateLevelSettings` 의 반환 타입에 `labels`·`maxDepth` 가 있는지 `src/lib/domain/levelSettings.ts` 에서 확인한다. `updateLevelSettings` 가 `v.labels`·`v.maxDepth` 를 쓰므로 있을 것이다.
`preset_applied` 컬럼이 not null 이면 insert 가 실패한다. 다음으로 확인한다: `docker exec supabase_db_d-flow psql -U postgres -At -c "select is_nullable from information_schema.columns where table_name='project_settings' and column_name='preset_applied'"`. `NO` 면 스키마 변경은 SP3 몫이므로 이 Task 에서는 `preset_applied: 'none'` 을 넣는다. 그때는 해당 check 제약도 확인하고, 테스트의 `not.toHaveProperty` 를 그 값 단언으로 바꾼다.

- [ ] **Step 4: 모달에 단계 입력** — `src/components/home/NewProjectModal.tsx`
  - 상태 추가: `const [levels, setLevels] = useState('')`. `reset()` 에 `setLevels('')` 를 넣는다.
  - `submit()`: `const labels = levels.split(/[,>\n]/).map(s => s.trim()).filter(Boolean)`. `if (labels.length === 0) { setError(t('home.errLevelsRequired')); return }` 를 추가하고, 호출을 `createProject(trimmed, start || null, end || null, description.trim() || null, labels)` 로 바꾼다.
  - 이름 필드 다음에 입력란 추가:

```tsx
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
              {t('home.fieldLevels')} <span className="text-delayed">*</span>
            </span>
            <input
              className="app-input"
              placeholder={t('home.phLevels')}
              value={levels}
              onChange={e => setLevels(e.target.value)}
            />
            <span className="mt-1 block text-xs text-ink-subtle">{t('home.hintLevels')}</span>
          </label>
```

  - 생성 버튼 `disabled={!name.trim() || !levels.trim() || busy}`
  - 13행 주석 `구 브랜드명 'WORKSPACE DIALOG / 새 프로젝트' 모달.` → `'WORKSPACE DIALOG / 새 프로젝트' 모달.`
  - `src/lib/i18n/dict/home.ts` 에 추가: `'home.fieldLevels': 'WBS 단계'`, `'home.phLevels': '예: 단계, 작업, 활동'`, `'home.hintLevels': '위에서부터 쉼표로 구분 — 개수가 곧 WBS 깊이입니다. 나중에 설정에서 바꿀 수 있습니다.'`, `'home.errLevelsRequired': 'WBS 단계를 1개 이상 입력하세요.'`
  - `home.en.ts`: `'WBS levels'`, `'e.g. Phase, Task, Activity'`, `'Top-down, comma-separated — the count is the WBS depth. You can change it later in settings.'`, `'Enter at least one WBS level.'`

- [ ] **Step 5: 프리셋 삭제와 잔존 확인**

```bash
git rm -q src/lib/domain/projectPresets.ts tests/domain/project-presets.test.ts
grep -rn "projectPresets\|PRESETS\.\|preset_applied" src tests | grep -v "^tests/migrations"   # 0건(또는 Step 3 의 'none' 분기만)
npx vitest run && npx tsc --noEmit -p .
```

`tsc` 가 i18n 키 타입(`DictKey`) 누락을 보고하면 dict 두 파일에 키를 모두 넣었는지 확인한다.

- [ ] **Step 6: 커밋** — 변경 파일을 명시해 add 한다. 메시지 요지: "프리셋 없음(결정 5) — 생성 시 단계 라벨 입력, 설정 저장 실패를 삼키지 않는다".

---

### Task 11: 초대 도메인 fail-closed

**Files:**
- Modify: `src/lib/domain/invites.ts:16-37,80`, `src/app/actions/projectInvites.ts:34-36`, `src/components/settings/ProjectInviteManager.tsx:137,149`, `tests/domain/invites.test.ts:33-46`, `tests/actions/project-invites-gate.test.ts`

**Interfaces:**
- Produces:
  - `ANY_DOMAIN = '*'`
  - `parseAllowedDomains(raw: string|undefined): string[]` — 미설정·공백이면 `[]`
  - `isAllowedInviteDomain(email, domains)` — `[]` 이면 false, `['*']` 이면 형식만 맞으면 true
  - `domainError(domains)` — `[]` 이면 설정 안내

- [ ] **Step 1: 도메인 테스트 교체** — `tests/domain/invites.test.ts` 의 `parseAllowedDomains`·`isAllowedInviteDomain` 블록:

```ts
describe('parseAllowedDomains', () => {
  it('쉼표·공백 구분, 소문자, 중복 제거', () => {
    expect(parseAllowedDomains('Example.com, corp.co.kr')).toEqual(['example.com', 'corp.co.kr'])
    expect(parseAllowedDomains('a.com  b.com\tc.com')).toEqual(['a.com', 'b.com', 'c.com'])
    expect(parseAllowedDomains('a.com, A.COM')).toEqual(['a.com'])
  })
  it("'@' 접두는 떼어낸다", () => { expect(parseAllowedDomains('@example.com')).toEqual(['example.com']) })
  it('미설정·공백은 빈 목록 — 제한 없음이 아니라 초대 불가(fail-closed)', () => {
    expect(parseAllowedDomains(undefined)).toEqual([])
    expect(parseAllowedDomains('')).toEqual([])
    expect(parseAllowedDomains('  , ,\t')).toEqual([])
  })
  it("'*' 는 명시적 전체 허용이며 다른 값과 섞이면 '*' 만 남는다", () => {
    expect(parseAllowedDomains('*')).toEqual(['*'])
    expect(parseAllowedDomains('a.com, *')).toEqual(['*'])
  })
})

describe('isAllowedInviteDomain', () => {
  it('빈 목록은 모두 거부', () => { expect(isAllowedInviteDomain('a@example.com', [])).toBe(false) })
  it("'*' 는 형식이 맞는 주소만 허용", () => {
    expect(isAllowedInviteDomain('a@anything.io', ['*'])).toBe(true)
    expect(isAllowedInviteDomain('@x.io', ['*'])).toBe(false)
    expect(isAllowedInviteDomain('a@', ['*'])).toBe(false)
  })
  it('정확 일치만 — 서브도메인·접두 사칭 거부', () => {
    expect(isAllowedInviteDomain('a@example.com', ['example.com'])).toBe(true)
    expect(isAllowedInviteDomain('a@x.example.com', ['example.com'])).toBe(false)
    expect(isAllowedInviteDomain('a@example.com.evil.io', ['example.com'])).toBe(false)
  })
})
```

같은 파일의 나머지 `example-corp.com` 픽스처(maskEmail 등)는 `example.com` 으로 바꾼다(`sed -i '' 's/origincorp\.com/example.com/g; s/origincorp-chem\.co\.kr/corp.co.kr/g' tests/domain/invites.test.ts`).

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/domain/invites.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/lib/domain/invites.ts` 16~37행 교체:

```ts
/** 명시적 전체 허용 값. 미설정을 '제한 없음'으로 읽지 않기 위해 전체 허용은 이 값으로만 켠다. */
export const ANY_DOMAIN = '*'

/** 허용 도메인 목록 파싱(쉼표·공백 구분). 미설정·공백이면 [] — 초대 불가(fail-closed).
 *  '*' 가 하나라도 있으면 ['*']. */
export function parseAllowedDomains(raw: string | undefined): string[] {
  const out: string[] = []
  for (const part of (raw ?? '').split(/[\s,]+/)) {
    // '@example.com' 처럼 적어도 받아들인다(설정 실수가 잦은 형태).
    const d = part.trim().toLowerCase().replace(/^@/, '')
    if (d === ANY_DOMAIN) return [ANY_DOMAIN]
    if (d && !out.includes(d)) out.push(d)
  }
  return out
}

/** normalizeInviteEmail 을 거친 주소가 허용 도메인인가. 빈 목록은 전부 거부.
 *  '@' 뒤 전체가 목록의 한 항목과 정확히 같아야 한다 — 'a.example.com' 같은 서브도메인은 불허(사칭 차단). */
export function isAllowedInviteDomain(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return false
  if (domains.includes(ANY_DOMAIN)) return true
  const host = email.slice(at + 1).toLowerCase()
  return domains.some((d) => d.trim().toLowerCase().replace(/^@/, '') === host)
}
```

80행 주석 예시: `'<이름>@<고객 도메인>' → '<이름>@example.com'`

`src/app/actions/projectInvites.ts` 34~36행:

```ts
function domainError(domains: string[]): string {
  if (domains.length === 0) return '초대 허용 도메인이 설정되지 않아 초대할 수 없습니다. 운영자에게 INVITE_ALLOWED_DOMAINS 설정을 요청하세요.'
  return `허용된 이메일 도메인(${domains.map((d) => `@${d}`).join(', ')})으로만 초대할 수 있습니다.`
}
```

(`'*'` 이면 도메인 검사를 통과하므로 이 문구에 `@*` 가 나올 일은 없다.)

`src/components/settings/ProjectInviteManager.tsx`
- 137행 문구: "합류한 사람은 이 프로젝트뿐 아니라 원본 고객사 전체의 회의록·WBS·이슈·근태를 조회할 수 있습니다. 사내 인원에게만 발급하세요." → "합류한 사람은 이 프로젝트뿐 아니라 전체 회의록·WBS·이슈·근태를 조회할 수 있습니다. 신뢰할 수 있는 인원에게만 발급하세요."
- 149행 placeholder: `name@example.com`

- [ ] **Step 4: 게이트 테스트 갱신** — `tests/actions/project-invites-gate.test.ts`
  - `beforeEach` 의 `delete process.env.INVITE_ALLOWED_DOMAINS` → `process.env.INVITE_ALLOWED_DOMAINS = 'example.com'`
  - 파일 전체 `example-corp.com` → `example.com`, `origincorp-group.co.kr` → `corp.co.kr`
  - 문구 단언 `'사내 이메일 주소(@…)로만 초대할 수 있습니다.'` → `'허용된 이메일 도메인(@…)으로만 초대할 수 있습니다.'`
  - 새 케이스 추가:

```ts
  it('허용 도메인 미설정이면 어떤 주소도 초대하지 않고 설정을 안내한다(fail-closed)', async () => {
    delete process.env.INVITE_ALLOWED_DOMAINS
    const res = await createProjectInvite(P1, { ...VALID, email: 'someone@example.com' })
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('INVITE_ALLOWED_DOMAINS') })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
```

- [ ] **Step 5: 확인·커밋**

```bash
npx vitest run tests/domain/invites.test.ts tests/actions/project-invites-gate.test.ts tests/mail tests/ui/invite-redeem-card.test.tsx
```

`.env.local.example` 에 `INVITE_ALLOWED_DOMAINS=` 줄을 추가하고, 그 위에 `# 쉼표 구분. 비우면 초대 불가, * 는 전체 허용` 주석을 단다.
변경 파일을 명시해 커밋한다. 메시지 요지: "고객사 도메인 하드코딩 제거, 미설정은 초대 불가 — 제한 없음을 기본값으로 두지 않는다".

---

### Task 12: 브랜드 단일 출처와 비-UI-위험 문자열

**Files:**
- Create: `src/lib/branding.ts`, `tests/lib/branding.test.ts`
- Modify: 아래 목록(UI 위험 파일 `src/app/layout.tsx`·`src/app/globals.css`·`src/components/app/*`·`src/app/(app)/layout.tsx` 는 **제외** — Task 14)

**Interfaces:**
- Produces: `BRAND: { productName: string; tagline: string; mailFromName: string; copyright: string }`, `ASSISTANT_NAME = { ko: 'AI 어시스턴트', en: 'AI Assistant' }`

- [ ] **Step 1: 실패 테스트** — `tests/lib/branding.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('BRAND', () => {
  it('기본값은 D-Flow', async () => {
    const { BRAND } = await import('@/lib/branding')
    expect(BRAND.productName).toBe('D-Flow')
    expect(BRAND.mailFromName).toBe('D-Flow 알림')
    expect(BRAND.copyright).toBe('')
  })
  it('env 로 덮어쓴다', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', 'Acme PM')
    vi.stubEnv('MAIL_FROM_NAME', 'Acme 알림')
    vi.stubEnv('NEXT_PUBLIC_BRAND_COPYRIGHT', '© 2026 Acme')
    const { BRAND } = await import('@/lib/branding')
    expect(BRAND).toMatchObject({ productName: 'Acme PM', mailFromName: 'Acme 알림', copyright: '© 2026 Acme' })
  })
  it('공백 env 는 기본값', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', '  ')
    const { BRAND } = await import('@/lib/branding')
    expect(BRAND.productName).toBe('D-Flow')
  })
})
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현** — `src/lib/branding.ts`

```ts
// 제품 브랜드 단일 출처(SP0). SP3 에서 workspace_settings.values.branding 으로 승격한다.
// NEXT_PUBLIC_* 은 클라이언트 번들에도 들어간다 — 비밀을 두지 않는다.
const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback)

const productName = pick(process.env.NEXT_PUBLIC_BRAND_NAME, 'D-Flow')

export const BRAND = {
  productName,
  tagline: pick(process.env.NEXT_PUBLIC_BRAND_TAGLINE, '일하는 방식이 바뀌다'),
  mailFromName: pick(process.env.MAIL_FROM_NAME, `${productName} 알림`),
  /** 비면 로그인 화면에 저작권 줄을 그리지 않는다. */
  copyright: pick(process.env.NEXT_PUBLIC_BRAND_COPYRIGHT, ''),
} as const

/** AI 어시스턴트 표시명 — 고객 브랜드와 무관한 중립명. */
export const ASSISTANT_NAME = { ko: 'AI 어시스턴트', en: 'AI Assistant' } as const
```

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: 사용자 노출 문자열 교체**

| 파일:행 | 교체 |
|---|---|
| `src/app/api/v1/minutes/route.ts:224` | `` `비활성 팀(${p.teamCode})입니다. ${BRAND.productName}에서 팀을 활성화한 뒤 다시 시도하세요.` `` |
| `src/app/api/v1/minutes/route.ts:399`, `folder/route.ts:277`, `link/route.ts:42`, `src/lib/agent/routeShared.ts:56` | `` `해당 이메일의 ${BRAND.productName} 사용자가 없습니다.` `` |
| `src/lib/minutes/export.ts:142` | `` `${BRAND.productName} 회의록 전체 내보내기` `` |
| `src/lib/report/excel.ts:224` | `wb.creator = BRAND.productName` |
| `src/lib/mail/transport.ts:18` | `const DEFAULT_FROM_NAME = BRAND.mailFromName` |
| `src/lib/mail/projectInvite.ts:63` | `` oneLine(`[${BRAND.productName}] ${projectName} 프로젝트 초대`) `` |
| `src/lib/ai/answer.ts:21` | `` `너는 '${ASSISTANT_NAME.ko}', 프로젝트 관리 도구 ${BRAND.productName} 의 AI 어시스턴트야.` `` |
| `src/lib/ai/minutes-answer.ts:11,18`, `src/lib/ai/chat/orchestrator.ts:282` | `구 브랜드명` → `${BRAND.productName}` |
| `src/app/api/chat/v2/stream/route.ts:64,95`, `src/lib/ai/chat/router.ts:648,666,678,711` | `기존 구 봇 브랜드명` → `기존 ${ASSISTANT_NAME.ko}` |
| `src/components/attendance/AttendanceView.tsx:290` | `locale === 'en' ? `${ASSISTANT_NAME.en} filter` : `${ASSISTANT_NAME.ko} 필터`` |
| `src/components/chat/RobotMascot.tsx:5`, `src/components/chat/LegacyBot.tsx:494,515` | `구 봇 브랜드명` → `{ASSISTANT_NAME.ko}` (aria-label 은 문자열 prop) |
| `src/lib/i18n/dict/chat.ts`·`chat.en.ts`·`settings.ts`·`settings.en.ts` | 값 안의 `구 봇 브랜드명` → `AI 어시스턴트` / `AI Assistant` (dict 는 정적 문자열이라 리터럴 치환) |
| `src/app/invite/[token]/page.tsx:30` | `{BRAND.productName} 프로젝트 초대` |
| `src/app/login/page.tsx:152` | `{BRAND.copyright && <div …>{BRAND.copyright}</div>}` (기존 className 유지) |
| `src/components/ui/BrandMark.tsx` | 워드마크 `D&apos;Flow` → `{BRAND.productName}`, 주석 "구 브랜드명 브랜드 마크" → "제품 브랜드 마크" |

각 파일에 `import { BRAND } from '@/lib/branding'` / `import { ASSISTANT_NAME } from '@/lib/branding'` 를 추가한다(없는 것만). 클라이언트 컴포넌트(`'use client'`)에서도 import 해도 된다 — NEXT_PUBLIC_ 값이다. 단 `mailFromName`(`MAIL_FROM_NAME`)은 서버에서만 읽힌다.

- [ ] **Step 6: 주석·식별자 아닌 잔여 치환**

```bash
# 주석·기타 — 구 브랜드명 → D-Flow, DK Flow 벤치마크 문구 제거, 고객명 주석 중립화
grep -rlE "구 브랜드명" src public | grep -vE '^src/app/(layout\.tsx|globals\.css)$|^src/components/app/' \
  | xargs sed -i '' "s/구 브랜드명/D-Flow/g"
grep -rlE "구 봇 브랜드명" src | grep -vE '^src/components/app/|^src/app/\(app\)/layout\.tsx$' | xargs sed -i '' 's/구 봇 브랜드명/AI 어시스턴트/g'
grep -rnE 'origincorp|원본 고객사|ORIGIN|원본 고객사' src public | grep -vE '^src/app/(layout\.tsx|globals\.css):|^src/components/app/'
```

마지막 명령에 남은 줄은 주석이다. 한 줄씩 중립 표현으로 고친다. 예:
- "원본 고객사 회귀 기준" → "레거시 v1 회귀 기준"
- "원본 계열사A 주간보고" → "주간보고"
- "원본 고객사 보라" → "보라 테마"
- "(원본 고객사 형)" → 삭제

`src/lib/ai/intent.ts:99` 의 어포스트로피 예시 `구 브랜드명` 는 `O'Neil` 로 바꾼다.

- [ ] **Step 7: 테스트 갱신과 확인**

```bash
npx vitest run 2>&1 | tail -30
```

사용자 노출 문자열을 단언하던 테스트(`tests/mail/project-invite.test.ts`, `tests/minutes/*`, `tests/agent/*`, `tests/ai/*` 등)는 기대값을 `BRAND.productName`/`ASSISTANT_NAME` import 로 바꾼다. 리터럴 `'D-Flow'` 로 바꾸지 않는다.

- [ ] **Step 8: 커밋** — 파일 목록은 `git diff --name-only` 로 뽑아 UI 위험 파일이 없는지 확인한 뒤 명시해 add 한다. 메시지 요지: "브랜드 단일 출처 — 사본에 박힌 구 브랜드명·구 봇 브랜드명·고객사명을 걷어낸다".

---

### Task 13: 팀 색 중립화와 보고서 팔레트 개명

**Files:**
- Modify: `src/components/wbs/shared.tsx:4-15`, `src/lib/report/brand.ts:33-39`, `src/lib/report/excel.ts`
- Rename: `src/lib/report/dkbrand.ts` → `src/lib/report/excelPalette.ts`
- Test: `tests/ui/team-style.test.ts`

**Interfaces:**
- Produces: `teamStyle(team: TeamCode): { fg: string; bar: string }` — 코드의 안정 해시로 5색 슬롯 중 하나(같은 코드는 항상 같은 색)

- [ ] **Step 1: 실패 테스트** — `tests/ui/team-style.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { teamStyle } from '@/components/wbs/shared'

const SLOTS = ['text-team-pmo', 'text-team-dt', 'text-team-erp', 'text-team-mes', 'text-team-mdm']

describe('teamStyle — 팀 코드 무관 순번 팔레트', () => {
  it('임의 팀 코드도 팔레트 색을 받는다(중립 회색으로 떨어지지 않는다)', () => {
    for (const code of ['운영', 'Alpha', '생산', 'QA']) expect(SLOTS).toContain(teamStyle(code).fg)
  })
  it('같은 코드는 항상 같은 색', () => { expect(teamStyle('Alpha')).toEqual(teamStyle('Alpha')) })
  it('fg 와 bar 슬롯이 짝이 맞다', () => {
    const s = teamStyle('운영')
    expect(s.bar).toBe(s.fg.replace('text-', 'bg-'))
  })
})
```

- [ ] **Step 2: 실패 확인** → FAIL(`운영` 은 현재 `text-ink-subtle`)

- [ ] **Step 3: 구현** — `src/components/wbs/shared.tsx` 4~15행 교체:

```ts
/** 팀 색 슬롯 — CSS 토큰 이름은 옛 5팀 것이지만 여기서는 순번 팔레트로만 쓴다(팀 색 컬럼화는 SP4).
 *  Tailwind JIT 가 읽도록 클래스는 리터럴로 둔다. */
const TEAM_SLOTS = [
  { fg: 'text-team-pmo', bar: 'bg-team-pmo' },
  { fg: 'text-team-dt', bar: 'bg-team-dt' },
  { fg: 'text-team-erp', bar: 'bg-team-erp' },
  { fg: 'text-team-mes', bar: 'bg-team-mes' },
  { fg: 'text-team-mdm', bar: 'bg-team-mdm' },
] as const

/** 팀 틴트 — 코드 문자열의 안정 해시로 슬롯을 고른다(팀 이름에 색을 묶지 않는다). */
export function teamStyle(team: TeamCode): { fg: string; bar: string } {
  let h = 0
  for (const ch of team) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return TEAM_SLOTS[h % TEAM_SLOTS.length]
}
```

`TEAM` export 를 직접 쓰는 곳을 찾는다: `grep -rn "TEAM\[\|{ TEAM\b\|, TEAM\b" src`. 찾은 곳은 `teamStyle(code)` 로 바꾼다.

- [ ] **Step 4: `TEAM_COLOR` 삭제·팔레트 개명**

```bash
grep -rn "TEAM_COLOR" src tests      # brand.ts 정의만 — 삭제
git mv src/lib/report/dkbrand.ts src/lib/report/excelPalette.ts
sed -i '' "s#@/lib/report/dkbrand#@/lib/report/excelPalette#; s#'./dkbrand'#'./excelPalette'#" src/lib/report/excel.ts
```

- `src/lib/report/brand.ts` 33~39행의 `TEAM_COLOR` 블록을 삭제한다. `TeamCode` import 가 더 이상 안 쓰이면 함께 지운다.
- `excelPalette.ts` 머리 주석 4줄을 다음으로 바꾼다: `/* 주간 공정보고 Excel 팔레트(보라 테마). Hex는 '#' 없는 6자리(RRGGBB). PPT 는 템플릿(.pptx) 서식을 재사용해 색 토큰이 필요 없다. */`

- [ ] **Step 5: 확인·커밋** — `npx vitest run tests/ui tests/report` → PASS. 메시지 요지: "팀 색을 팀 이름에서 떼어 순번 팔레트로 — 새 팀이 회색으로 떨어지던 5팀 가정 제거".

---

### Task 14: UI 위험 파일 탈-브랜드 (`ui/sp0-debrand` 브랜치)

**Files:**
- Modify: `src/app/layout.tsx:9`, `src/app/globals.css:38,497`, `src/components/app/HeaderChrome.tsx:155`, `src/app/(app)/projects/page.tsx:181`(해당되면)
- Replace: `public/logo.png` → 텍스트 워드마크로 대체

- [ ] **Step 1: 브랜치** — `git switch -c ui/sp0-debrand`

- [ ] **Step 2: 수정**
  - `src/app/layout.tsx`: `import { BRAND } from '@/lib/branding'`, `title: \`${BRAND.productName} — ${BRAND.tagline}\``
  - `src/app/globals.css:38` 주석 → `/*  디자인 토큰 — warm cream + teal  */`, 497행 주석의 `(DK Flow 벤치마크)` 삭제. 규칙 본문은 건드리지 않는다.
  - `HeaderChrome.tsx:155`: ``aria-label={`${BRAND.productName} 홈`}``
  - UI 위험 파일에 남은 브랜드 문자열도 치환한다: `grep -rnE "구 브랜드명|DK ?Bot|원본 고객사|원본 고객사" src/components/app "src/app/(app)/layout.tsx" src/app/layout.tsx src/app/globals.css`. 사용자 노출 문자열은 `BRAND`/`ASSISTANT_NAME` 으로, 주석은 중립 표현으로 바꾼다.
  - `src/app/(app)/projects/page.tsx:181` 의 `Workspace · D…` 문자열을 확인한다(`sed -n 181p`). 제품명 리터럴이면 `BRAND.productName` 으로 바꾼다.
  - 로고: `BrandGlyph`(`src/components/ui/BrandMark.tsx`)의 `<img src="/logo.png">` 를 `BRAND.productName` 첫 글자 모노그램으로 교체한다.

```tsx
      <span className="flex h-full w-full items-center justify-center bg-brand font-bold text-white" style={{ fontSize: Math.round(size * 0.46) }}>
        {BRAND.productName.slice(0, 1)}
      </span>
```

  `bg-brand` 토큰 존재 여부를 `grep -n -- '--color-brand' src/app/globals.css` 로 확인한다. 없으면 기존 강조 토큰(예: `bg-accent`)을 쓴다. `src/app/login/page.tsx:130,163` 의 `<img src="/logo.png">` 두 곳도 `<BrandGlyph size={80|56} />` 로 교체한다. 그다음 `git rm public/logo.png` 를 실행하고 `grep -rn "logo.png" src` 가 0건인지 확인한다.

- [ ] **Step 3: 로컬 눈확인** — `npm run dev` 후 브라우저(claude-in-chrome 또는 사용자)로 다음 세 화면을 확인하고 스크린샷을 `/private/tmp/claude-501/-Users-jerry-D-Flow/sp0-ui-*.png` 에 저장한다.
  - `/login`: 모노그램과 제품명, 저작권 줄 없음
  - `/projects`: 헤더 워드마크
  - 프로젝트 1개의 WBS 화면: 레이아웃과 반응형이 깨지지 않았는지. 창 폭 375px 와 1440px 두 가지로 본다.

- [ ] **Step 4: 커밋·머지**

```bash
npx vitest run tests/ui tests/css
git add src/app/layout.tsx src/app/globals.css src/components/app/HeaderChrome.tsx src/components/ui/BrandMark.tsx src/app/login/page.tsx "src/app/(app)/projects/page.tsx"
git commit -m "feat(ui): 제목·헤더·로고를 브랜드 단일 출처로 — 원본 로고 파일 제거

Preview-checked: local <YYYY-MM-DD HH:MM> — /login·/projects·WBS 375/1440px
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git switch main && git merge --no-ff ui/sp0-debrand -m "Merge branch 'ui/sp0-debrand'"
```

(`public/logo.png` 삭제는 `git rm` 으로 이미 stage 돼 있다. 트레일러 일시는 실제 확인 시각으로 적는다.)

---

### Task 15: PPTX 기본 양식 중립화

**Files:**
- Create: `scripts/neutralize-pptx.mjs`, `tests/report/template-neutral.test.ts`
- Modify: `src/lib/report/assets/weekly-template.pptx`, `src/lib/report/assets/issue-analysis-template.pptx`

- [ ] **Step 1: 실패 테스트** — `tests/report/template-neutral.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const BRAND_RE = /원본 고객사|ORIGIN|원본 고객사|ORIGINCORP|Origincorp|구 브랜드명/

describe.each(['weekly-template.pptx', 'issue-analysis-template.pptx'])('%s', (file) => {
  it('XML 어디에도 고객사·원본 브랜드 문자열이 없다', async () => {
    const zip = await JSZip.loadAsync(readFileSync(`src/lib/report/assets/${file}`))
    const hits: string[] = []
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !/\.(xml|rels)$/.test(name)) continue
      const m = (await entry.async('string')).match(BRAND_RE)
      if (m) hits.push(`${name}: ${m[0]}`)
    }
    expect(hits).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인** → FAIL(weekly 에 `원본 계열사A` 등, issue-analysis 에 `원본 고객사` 8건)

- [ ] **Step 3: 로고 이미지 식별** — 미디어를 풀어 눈으로 본다.

```bash
S=/private/tmp/claude-501/-Users-jerry-D-Flow/pptx && rm -rf $S && mkdir -p $S/w $S/i
unzip -q -o src/lib/report/assets/weekly-template.pptx 'ppt/media/*' -d $S/w
unzip -q -o src/lib/report/assets/issue-analysis-template.pptx 'ppt/media/*' -d $S/i
ls -la $S/w/ppt/media $S/i/ppt/media
```

각 png 를 Read 도구로 열어 로고·CI(회사명·심볼)인지 판정하고, 대상 파일명을 기록한다. `image1.emf` 는 `soffice --headless --convert-to png` 로 변환해서 본다.

- [ ] **Step 4: 중립화 스크립트** — `scripts/neutralize-pptx.mjs`

```js
// scripts/neutralize-pptx.mjs — 기본 양식에서 고객사 문자열·로고를 걷어낸다. 슬라이드 구조·자리 이름은 불변.
// 사용: node scripts/neutralize-pptx.mjs <pptx> <로고 media 경로...>
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'

// 1x1 투명 PNG — 로고 자리를 비우되 관계(rels)·도형 크기는 그대로 둔다.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const REPLACE = [
  [/원본 계열사A 문서 표지 양식/g, '문서 표지'],
  [/원본 계열사B 전략팀\s*/g, ''],
  [/ORIGINCORP CM/g, ''],
  [/원본 계열사A\s*/g, ''],
  [/원본 고객사/g, '프로젝트'],
]

const [file, ...logos] = process.argv.slice(2)
const zip = await JSZip.loadAsync(readFileSync(file))
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir || !/\.(xml|rels)$/.test(name)) continue
  let xml = await entry.async('string')
  const before = xml
  for (const [re, to] of REPLACE) xml = xml.replace(re, to)
  if (xml !== before) { zip.file(name, xml); console.log(`텍스트: ${name}`) }
}
for (const m of logos) {
  if (!zip.file(m)) throw new Error(`없는 media: ${m}`)
  if (!m.endsWith('.png')) throw new Error(`png 만 교체한다(${m}) — emf 등은 수동 판단`)
  zip.file(m, BLANK_PNG); console.log(`로고 비움: ${m}`)
}
writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
```

- [ ] **Step 5: 실행과 치환 결과 확인**

```bash
node scripts/neutralize-pptx.mjs src/lib/report/assets/weekly-template.pptx <Step 3 에서 고른 로고들>
node scripts/neutralize-pptx.mjs src/lib/report/assets/issue-analysis-template.pptx <…>
npx vitest run tests/report
```

`원본 고객사` → `프로젝트` 치환이 문맥상 어색한 자리(예: "프로젝트 Project")는 `unzip -p … | grep -o '.\{40\}프로젝트.\{40\}'` 로 확인한다. 어색하면 그 문맥에 맞는 규칙을 `REPLACE` 에 더 구체적으로 추가하고, 원본은 `git checkout` 으로 되돌린 뒤 다시 실행한다.

- [ ] **Step 6: 시각 확인** — `soffice --headless --convert-to pdf --outdir $S src/lib/report/assets/*.pptx` 를 실행하고, PDF 첫 페이지를 Read 로 본다. 레이아웃이 깨지지 않았고 로고 자리가 비었는지 확인한다.

- [ ] **Step 7: 커밋** — `git add scripts/neutralize-pptx.mjs tests/report/template-neutral.test.ts src/lib/report/assets/*.pptx`. 메시지 요지: "기본 양식에서 고객사 표지·로고를 걷어낸다 — 구조 불변이라 렌더 코드 무수정, 엔진은 SP6".

---

### Task 16: 운영 스크립트 env 화·문서 좌표 개정·FLOOR 재측정

**Files:**
- Modify: `scripts/smoke-prod.mjs:24,35-41`, `scripts/mark-good.mjs:27`, `scripts/vercel-ignore-build.sh`, `scripts/agent-harness-example.mjs:4`, `docs/runbook-staging.md`, `docs/runbook-rollback.md`, `README.md`

- [ ] **Step 1: URL 필수화**
  - `smoke-prod.mjs:24` → `const BASE = (process.env.SMOKE_URL ?? '').replace(/\/$/, '')`. 바로 아래에 추가: `if (!BASE) { console.error('SMOKE_URL 필수 — 예: SMOKE_URL=http://localhost:3000 npm run smoke:prod'); process.exit(2) }`
  - `mark-good.mjs:27` → 같은 방식으로 `PROD_URL`
  - `agent-harness-example.mjs:4` 사용법 주석의 예시 URL → `http://localhost:3000`
  - `vercel-ignore-build.sh`: 머리 주석에서 wbs-web 프로젝트 설명을 지우고 "D-Flow 프로젝트는 첫 배포 SP 에서 생성" 으로 바꾼다. `dflow-staging*)` → `"${STAGING_PROJECT_PREFIX:-__unset__}"*)`

- [ ] **Step 2: FLOOR 재측정**

```bash
npm run build && (npm start >/private/tmp/claude-501/-Users-jerry-D-Flow/next-start.log 2>&1 &) && sleep 8
SMOKE_URL=http://localhost:3000 npm run smoke:prod; echo "exit=$?"
```

출력의 실측값(CSS 바이트, 규칙 수, 커스텀 프로퍼티 수, `@property` 수, `@keyframes` 수)을 읽는다. `FLOOR` 가 실측을 넘으면 실측의 약 75% 로 내린다. 주석의 "프로덕션 실측값(2026-07-28 …)" 은 "로컬 next start 실측(2026-09-23 …)" 으로 갱신한다. 끝나면 서버를 종료한다: `pkill -f "next start"`.

- [ ] **Step 3: 문서**
  - `docs/runbook-staging.md`·`docs/runbook-rollback.md` 맨 위에 다음 절을 추가한다.

```markdown
> **D-Flow 현황(2026-09-23)** — 원격 스테이징·운영·Vercel 미생성. 아래 본문은 원본 리포(wbs-web) 기록이며
> 그 ref·URL 로 접속하지 않는다(CLAUDE.md "원본 DB 금지"). 현재 절차: 로컬 `npm run db:reset` 리허설,
> 롤백은 `supabase/rollbacks/NNNN_*_rollback.sql` 을 로컬에 적용 후 `npm run db:reset` 으로 재검증.
```

  - `README.md` 첫 문단: 제품명 D-Flow, "범용 프로젝트 관리 플랫폼 — wbs-web 포크", 로컬 시작 4줄(`npm ci` / `npm run db:start` / `npm run db:reset && npm run env:local && npm run dev:bootstrap` / `npm run dev`).

- [ ] **Step 4: 커밋** — 파일을 명시해 add. 메시지 요지: "운영 스크립트에서 원본 URL 기본값 제거, 로컬 기준 FLOOR 재측정, 문서 좌표 개정".

---

### Task 17: 완료 조건 실측과 `sp0-done`

**Files:**
- Create: `docs/baseline/sp0-e2e.md`

- [ ] **Step 1: 깨끗한 재생부터 E2E**

```bash
npm run db:reset && npm run env:local && BOOTSTRAP_EMAIL=admin@example.com npm run dev:bootstrap
INVITE_ALLOWED_DOMAINS=example.com npm run dev
```

브라우저(claude-in-chrome, GIF 녹화 `sp0-e2e.gif`)에서 다음을 순서대로 진행한다.
1. `/login` 에서 로그인
2. 새 프로젝트 생성: 단계 `단계, 작업, 활동`
3. WBS 엑셀 양식 다운로드 → 행 3~5개 입력 → 임포트. 팀 열은 부트스트랩 팀 `운영`.
4. 주간보고 PPT 내보내기, 엑셀 내보내기

각 단계의 스크린샷 경로와 시각을 `docs/baseline/sp0-e2e.md` 에 기록한다.

- [ ] **Step 2: 산출물 검사**

```bash
for f in ~/Downloads/<내보낸 pptx> ~/Downloads/<내보낸 xlsx>; do
  unzip -p "$f" '*.xml' | grep -cE "원본 고객사|ORIGIN|원본 고객사|ORIGINCORP|구 브랜드명" ; done    # 각 0
soffice --headless --convert-to pdf --outdir /private/tmp/claude-501/-Users-jerry-D-Flow ~/Downloads/<pptx>   # 열림 확인
```

- [ ] **Step 3: done_when 전 항목**

```bash
npx vitest run && npm run lint && npm run build
grep -rE "origincorp|원본 고객사|ORIGIN|원본 고객사|구 브랜드명|D&apos;Flow|DK ?Bot" src public | wc -l          # 0
grep -rn 'rglfgrwwwwdqejohdnty\|abtyahghvvkcriawffty' scripts src .github supabase | grep -v 'scripts/lib/targets.mjs'   # 0
node scripts/baseline-diff.mjs                                                          # 불일치 0
test -f docs/fork-policy.md && echo ok
```

결과를 `docs/baseline/sp0-e2e.md` 의 체크리스트에 붙인다. 이 체크리스트는 스펙 9절과 같은 항목이다.

- [ ] **Step 4: 사용자 확인 후 push·CI·태그**

사용자에게 결과를 보고하고 push 승인을 받는다. 승인되면:

```bash
git add docs/baseline/sp0-e2e.md && git commit -m "docs: SP0 완료 실측 기록 …"
SKIP_GUARD=1 git push --force-with-lease=refs/heads/main:<origin/main 현재 SHA> -u origin main   # 1회성 강제 교체 (부록 17′ 참고); 이후 push 부터 G1~G4, force 금지
gh run watch                       # ci 두 잡 초록
git tag -a sp0-done -m "SP0 포크 부트스트랩 완료 — docs/baseline/sp0-e2e.md" && git push origin sp0-done
```

CI 가 실패하면 superpowers:systematic-debugging 으로 원인을 찾아 고치고 다시 push 한다. 태그는 CI 초록 뒤에만 단다.

---

## 부록 A — 흔적 전면 제거 (2026-09-24 사용자 결정으로 추가)

사용자 지시: "원본 고객사 에 대한 모든 흔적을 다 없애야 한다 — 범용으로 쓸 것". 전수 조사(워크플로 `wf_735b7928-2a8`, `.superpowers/sdd/…/origincustomer-inventory-wf.json`)와 사용자 결정 4가지를 반영한 추가 태스크다. 업무 어휘(5팀·주간 11구분·PI 이슈 체계·`pmo_admin`·Asia/Seoul)는 로드맵대로 SP3~SP5 에서 설정화하며 여기 범위가 아니다. 또박또박(연동 파트너 제품명)은 유지한다.

| # | 태스크 | 순서 |
|---|---|---|
| 18 | 개인정보·고객 픽스처·주석·스크립트·스킬 문자열 일소 | Task 14 뒤 |
| 19 | `legacybot` 식별자 계열 개명 | 18 뒤 |
| 20 | 물려받은 문서 삭제 + 코드의 문서 포인터 정리 | 19 뒤 |
| 15′ | PPTX 양식 완전 중립화(로고·문서속성·테마·썸네일·샘플 데이터까지) — 기존 Task 15 를 대체 | 20 뒤 |
| 16 | (기존) 스크립트 env 화·README·런북 — 문서 삭제 후 실행 | 15′ 뒤 |
| 17′ | (기존 Task 17 에 추가) push 전 **깨끗한 트리로 새 루트 커밋** | 마지막 |

### Task 18: 개인정보·고객 픽스처·주석·스크립트·스킬 문자열 일소

**Files:** `tests/**`, `src/**`(주석·플레이스홀더만), `scripts/**`, `.claude/**`, `kit/**`, `docs/mockups/**`(삭제는 Task 20)

- 개인정보(무조건): 실제 인물 핸들·개인 메일·호스트명 4건, 고객사 직원 실명·사내 메일 핸들 3건 → 중립 픽스처(`alice`, `alice@example.com`, `agent-host-1` 등). 인벤토리 critic 항목과 tests 스윕의 personal-data 항목이 위치 목록이다(식별자 자체는 이 문서에 적지 않는다).
- 테스트 픽스처: 고객사명·계열사명·고객 도메인 3종, 고객 MES 하위 프로젝트명 5종, 공장 지역·창고·제품·라인명 같은 고객 업무 문자열, 실제 회의록 제목, 테스트 제목의 `사내` 표현 → 중립값(`Acme Project`, `example.com`, `proj-a`, `Widget`). **5팀 코드(PMO/ERP/MES/가공/MDM)·주간 11구분·PI-I 코드는 SP4/SP5 어휘라 이 태스크에서 바꾸지 않는다.**
- src 주석·플레이스홀더: 운영 실측치·사고 인용(`운영 최대 528행`, `2026-08-05 사고`), 고객 하위 프로젝트 리허설 언급, DRM 제품명, 사내 메일 핸들 관례, 특정 공장명 플레이스홀더 → 일반 표현.
- scripts: 일회성 운영 스크립트 삭제(`scripts/apply-0028`~`apply-0050` 8개, `apply-legacybot-migration.*`, `wiki-rebuild.runner.ts`·`wiki-rebuild.vitest.ts` 와 이를 고정하는 `tests/lib/wiki-rebuild-loop.test.ts`, 관련 package.json 스크립트), `scripts/wbs/build-xlsx.mjs:7` 고객명, `kit/.env.example` 의 `dflow-staging.vercel.app` 기본값 제거(필수 env 로), `.claude/commands` 의 `/deploy` 가 `vercel ls wbs-web` 을 부르면 프로젝트명 env 화.
- 스킬·킷: `.claude/skills/**`·`kit/**` 의 `구 브랜드명` → `D-Flow`(126곳), `wbs-web` → `원본 리포`/삭제, `dflow-wbs-nlevel` 의 업종 특화 MES 샘플 계약·`wbs-nlevel-parse.py` 의 구 브랜드명 문구 → 중립 샘플(가공/조업 코드 PLTCM·2CGL·ACCL 제거), 내부 사전 실측 인용 → 일반화. `tests/skills/*` 가 문구를 고정하므로 함께 갱신(단정 완화 금지).
- 검증: 고객사명·계열사명·고객 도메인·공장 지역·라인명·하위 프로젝트명·내부 사전명을 담은 grep 패턴(패턴 자체는 고객 식별자라 이 문서에 적지 않는다)으로 `src tests scripts .claude kit public` 0건(개인 식별자는 별도 목록으로 검사했다 — 문서에 남기지 않는다. `scripts/lib/targets.mjs` 의 금지 ref 2개와 그 테스트, `baseline-*.mjs` 의 운영 안전장치 문구만 예외 — 이 셋은 "원본 운영 DB" 로 표현을 바꾸고 ref 문자열은 유지). 전체 스위트 0 실패.

### Task 19: `legacybot` 식별자 계열 개명

- `src/components/chat/LegacyBot.tsx` → `AssistantChat.tsx`(컴포넌트 `AssistantChat`), `legacybotHealth`/`legacybotIndexStatus`/`LegacybotHealth`/`legacybotBadge`/`dkIndex` → `assistant*`, `[legacybot]` 로그 태그 33곳 → `[assistant]`, i18n 키 `settings.legacybot*` → `settings.assistant*`(ko/en 둘 다), `https://legacybot.invalid` → `https://assistant.invalid`, `docs/legacybot.md` 는 Task 20 에서 삭제.
- env `LEGACYBOT_MIN_SIMILARITY` → `ASSISTANT_MIN_SIMILARITY`, 읽는 곳에서 옛 이름을 폴백으로 1회 더 읽고 `console.warn`(운영 설정 무효화 방지). `.env.local.example` 갱신.
- 테스트 파일명(`tests/ui/legacybot-*.test.*`)·목·스냅샷 갱신. `git mv` 로 이력 유지.
- 검증: `grep -rni legacybot src tests scripts .claude kit public .env.local.example` 0건(폴백 env 이름 1곳 예외). 전체 스위트 0 실패, tsc 기준선 28 유지.

### Task 20: 물려받은 문서 삭제 + 포인터 정리

- 삭제: `docs/**` 전부, 단 다음은 **유지**: `docs/superpowers/specs/2026-09-23-generic-platform-design.md`, `docs/superpowers/specs/2026-09-23-sp0-fork-bootstrap-design.md`, `docs/superpowers/plans/2026-09-23-sp0-fork-bootstrap.md`, `docs/fork-policy.md`, `docs/baseline/**`, `docs/runbook-staging.md`·`docs/runbook-rollback.md`(Task 16 이 재작성), `docs/design/dflow-minutes-upload-api-spec.md`·`docs/design/dflow-agent-work-api-spec.md`(외부 계약 — 유지하되 `구 브랜드명`→제품명 템플릿·고객명 0건으로 정리). `docs/mockups/**` 의 PNG·HTML(개인 핸들 노출)은 삭제 대상에 포함.
- 코드·스킬·CLAUDE.md 의 삭제 문서 포인터(인벤토리 critic 항목: `src/lib/domain/*` 등 26곳) → 포인터 삭제 또는 한 줄 근거로 대체. `grep -rn "docs/superpowers/\(specs\|plans\)/2026-0[6-9]-[0-2]" src tests .claude kit CLAUDE.md` 가 유지 문서 3개 외 0건.
- 유지하는 SP0 문서 6개는 포크 출처를 기록하는 유일한 자리로 남긴다(사용자 확인 사항).

### Task 15′: PPTX 양식 완전 중립화 (기존 Task 15 대체)

기존 Task 15 의 텍스트 치환에 더해: 로고 미디어 13개 전부(투명 PNG 또는 삭제 + 관계 정리), `docProps/core.xml`·`app.xml`(작성자·제목·TitlesOfParts), 테마 이름 `원본 고객사`·색(002452/C51F2A → 중립 팔레트), `docProps/thumbnail.jpeg`, 레이아웃 텍스트(`원본 계열사B 전략팀`, `문서 표지 양식`, `ORIGINCORP CM`, `70주년 표지`), 슬라이드 내 실제 샘플 데이터(주간보고 slide2 표 본문, 이슈분석 slide 3·5~12 의 PI-I-02-xx 문항·Luxteel/Appsteel/SteelShop/E-Biz 구조) → 중립 예시. 슬라이드 수·`sourceSlide` 번호·shape id·표 좌표는 불변(렌더 코드 무수정). 검증: `unzip -p` 전 XML + `docProps` 에 브랜드·고객명·인명 0건, 렌더 테스트 초록, PDF 변환 후 육안.

### Task 17′ 추가: 깨끗한 루트 커밋

- Task 17 의 push 직전: `git checkout --orphan sp0-clean`(index·worktree 보존 — `git switch --orphan` 은 트리를 비운다) → 트리가 리뷰한 커밋과 같은지 `git diff --cached --stat sp0/fork-bootstrap` 이 비어 있는지 확인 → `git commit -m "D-Flow 출발점 — wbs-web@77cf6785 포크의 SP0 결과" --trailer "Fork-of: wbs-web@77cf6785e088e65a35857ae69b4b5b040fa13bf3"` → `git branch -M sp0-clean main`(기존 `main` 은 먼저 `main-fork-history` 로 개명해 로컬 보관, push 금지) → 사용자 확인 후 **`SKIP_GUARD=1 git push --force-with-lease=refs/heads/main:<origin/main 현재 SHA> -u origin main`**(2026-09-24 실측: origin/main 에 f790e82 가 이미 올라가 있어 강제 교체 — 사용자 결정) → `git tag -a sp0-done` → `git push origin sp0-done`(태그 push 는 훅 대상 아님). `SKIP_GUARD=1` 이 정상 경로인 이유: squash 한 루트 커밋은 의도적으로 `supabase/migrations/` 와 `src/` 를 함께 담아 G1 에 걸린다(origin/main 이 없을 때는 G4 범위 계산도 실패한다). 바로 다음 push 부터는 훅이 정상으로 돈다.
- `docs/fork-policy.md` 에 "원본 이력은 로컬 보관 브랜치에만 있고 원격에는 없다" 를 적는다.
