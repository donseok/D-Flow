# 워크스페이스 발송 메일 설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크스페이스 관리자가 워크스페이스 설정 화면에서 Gmail 주소·앱 비밀번호(또는 직접 입력한 SMTP 서버)를 저장하면, 재배포 없이 회의 안내·프로젝트 초대 메일이 그 계정으로 나간다.

**Architecture:** 워크스페이스별 전용 표 `workspace_mail_settings`(service_role 전용, 마이그레이션 0059)에 저장하고, `src/lib/mail/transport.ts` 의 `getTransport` 가 비동기로 워크스페이스 설정 → 배포 env(`SMTP_*`) → 미설정 순으로 고른다. 입력 검증은 클라이언트·서버 공용 순수 함수 하나, 워크스페이스 행의 서버 주소는 발송 직전 DNS 로 사설 대역을 막고 IP 를 고정해 연결한다. 화면은 기존 워크스페이스 설정 페이지에 '메일 발송' 섹션을 더한다.

**Tech Stack:** Next.js 15 App Router(서버 액션), Supabase(Postgres·RLS), nodemailer, vitest(+ RLS 전용 설정 `vitest.config.rls.ts`), Tailwind v4.

**정본 설계:** `docs/superpowers/specs/2026-10-15-workspace-mail-settings-design.md`

**실행 순서와 커밋:** Task 1 은 마이그레이션·롤백·`tests/rls` 만 담은 단독 커밋(G1·G4). Task 4 뒤 Task 5 전까지는 호출처 시그니처 때문에 타입체크가 빨갛다 — 두 커밋을 함께 push 한다. push(=운영 배포)·운영 DB 적용·Vercel 환경변수 추가는 Task 9 에서 사람 확인 후에만 한다.

---

## 공유 계약(작업 사이의 이름)

정본 설계: docs/superpowers/specs/2026-10-15-workspace-mail-settings-design.md (모든 작업은 이 설계를 따른다).
이 파일은 작업들이 서로 부르는 이름을 고정한다. 여기 이름을 바꾸지 말 것. 설계와 다른 곳은 아래 "설계와의 차이"에 적혀 있다.

### 설계와의 차이(계획이 정한 것)
- 순환 import 를 피하려고 판정 함수(MailStatus·resolveMailStatus·발송 설정 선택)는 `src/lib/mail/transport.ts` 에 둔다.
  `src/lib/mail/workspaceSmtp.ts` 는 행 형·매핑·조회·호스트 검사만 가지며 transport.ts 를 import 하지 않는다.
- `connectTo` 로 IP 를 고정할 때 nodemailer 의 `name`(EHLO 이름)은 두지 않고 `tls.servername` 만 원래 호스트로 둔다 — 서버 자기 이름으로 EHLO 하면 많은 MTA 가 거부한다(설계 §2.2 의 `name` 은 따르지 않는다).
- `vetMailHost` 는 모든 주소가 허용 대역일 때 IPv4 를 먼저 고른다(Vercel 함수는 IPv6 외부 연결이 보통 안 된다).
- `MAIL_SETTINGS_UNAVAILABLE`·`MAIL_HOST_NOT_ALLOWED` 는 사전 키가 아니라 transport.ts 의 상수다 — 서버 사전을 값으로 import 할 수 있는 파일이 닫혀 있다(`tests/invariants/i18n-server-messages.test.ts`).
- `MailSettingsEditor` 는 선택 prop `timeZone?: string | null` 을 더 받는다(비밀번호 설정 일시를 워크스페이스 시간대로 — `tests/invariants/instant-format-zone.test.ts`).
- 사용자 문구는 사전 키로 둔다(파일별 한국어 리터럴 상한 불변식 `tests/invariants/i18n-no-korean-literals.test.ts` 를 넘기지 않게). 각 작업이 쓰는 키는 그 작업이 사전에 더한다.

### 파일과 공개 이름

### src/lib/mail/settingsInput.ts (순수, 클라이언트·서버 공용 — 'server-only' 금지)
```ts
export type MailPreset = 'gmail' | 'custom'
export const MAIL_PORTS = [25, 465, 587, 2525] as const
export const GMAIL_HOST = 'smtp.gmail.com'
export type MailSettingsReason =
  | 'preset_invalid' | 'address_invalid' | 'host_invalid' | 'port_invalid'
  | 'tls_mismatch' | 'username_required' | 'from_invalid' | 'password_required'
export interface MailSettingsInput {
  preset: MailPreset
  address?: string; password?: string            // gmail
  host?: string; port?: number | string; secure?: boolean; username?: string; fromAddress?: string // custom (+password)
}
/** 저장할 꼴. password null = 입력 빈칸(저장값 재사용 후보) */
export interface NormalizedMailSettings {
  preset: MailPreset; host: string; port: number; secure: boolean
  username: string; password: string | null; from_address: string | null
}
export function normalizeMailSettingsInput(input: unknown):
  { ok: true; value: NormalizedMailSettings } | { ok: false; code: MailSettingsReason }
/** 빈 비밀번호일 때 저장값을 재사용해도 되는가 — host 동일(정규화 후) && username 동일(trim·소문자) */
export function canReusePassword(next: { host: string; username: string }, stored: { host: string; username: string } | null): boolean
/** 사유 코드 → 공용 사전 키 'mailSettings.reason.<code>' */
export function reasonKey(code: MailSettingsReason): DictKey
```
host 정규화: `toAsciiHostname(host.trim().toLowerCase().replace(/\.$/, ''))` (src/lib/domain/hostname.ts), null 이면 host_invalid. 단일 레이블(점 없음)도 host_invalid.

### src/lib/mail/workspaceSmtp.ts ('server-only')
```ts
export interface WorkspaceMailRow {
  workspace_id: string; preset: MailPreset; host: string; port: number; secure: boolean
  username: string; password: string; from_address: string | null
  password_set_by: string | null; password_set_at: string; updated_by: string | null; updated_at: string
}
export const WORKSPACE_MAIL_COLUMNS: string  // select 열 목록(위 필드 전부)
export function rowToSmtpEnv(row: Pick<WorkspaceMailRow, 'host'|'port'|'secure'|'username'|'password'|'from_address'>): Record<string, string>
export type WorkspaceMailLoad = { kind: 'row'; row: WorkspaceMailRow } | { kind: 'none' } | { kind: 'archived' }
/** 조회 실패·보관 임베드 판독 불가는 throw */
export async function loadWorkspaceMailRow(admin: Pick<AdminClient, 'from'>, workspaceId: string): Promise<WorkspaceMailLoad>
/** 발송 직전 DNS 검사. 통과하면 연결할 IP */
export async function vetMailHost(host: string): Promise<{ ok: true; address: string } | { ok: false }>
export function isForbiddenAddress(ip: string): boolean   // 순수, 테스트용 export
```
AdminClient 는 `import type { AdminClient } from '@/lib/supabase/adminFor'`.

### src/lib/mail/transport.ts (기존 파일 수정)
```ts
// 기존 유지: MailMessage, Transport, SmtpSettings, resolveSmtpSettings, mailConfigured, SMTP_NOT_CONFIGURED, SMTP_MISCONFIGURED
export const MAIL_SETTINGS_UNAVAILABLE: string
export const MAIL_HOST_NOT_ALLOWED: string
export type MailStatus =
  | { source: 'workspace'; valid: true; fromAddress: string } | { source: 'workspace'; valid: false }
  | { source: 'env'; valid: true; fromAddress: string } | { source: 'env'; valid: false }
  | { source: 'none' }
export async function resolveMailStatus(workspaceId: string | null): Promise<MailStatus | { error: string }>
export function transportFromSettings(settings: SmtpSettings, opts?: { fromName?: string; connectTo?: string }): Transport
export async function getTransport(opts: { workspaceId: string | null; fromName?: string }): Promise<Transport>
```
(문자열 상수의 값은 기존 SMTP_* 상수와 같은 방식으로 둔다 — 기존 두 상수가 리터럴이면 같은 방식, 상한 불변식에 걸리면 사전 키.)

### src/lib/mail/errors.ts
```ts
export function smtpErrorMessage(tr: ServerTranslate, e: unknown, opts?: { test?: boolean }): string
```

### src/app/actions/mailSettings.ts ('use server')
```ts
export interface MailSettingsView {
  preset: MailPreset; host: string; port: number; secure: boolean
  username: string; fromAddress: string | null; hasPassword: true
}
export type GetMailSettingsResult =
  | { ok: true; settings: MailSettingsView | null; status: MailStatus
      passwordSetBy: string | null; passwordSetAt: string | null; passwordSetterIsAdmin: boolean | 'unknown' | null }
  | { ok: false; error: string }
export async function getWorkspaceMailSettings(wid: string): Promise<GetMailSettingsResult>
export async function saveWorkspaceMailSettings(wid: string, input: MailSettingsInput): Promise<{ ok: true } | { ok: false; error: string }>
export async function deleteWorkspaceMailSettings(wid: string): Promise<{ ok: true } | { ok: false; error: string }>
export async function sendWorkspaceTestMail(wid: string, input: MailSettingsInput): Promise<{ ok: true; to: string } | { ok: false; error: string }>
```

### src/components/settings/MailSettingsEditor.tsx ('use client')
```ts
export function MailSettingsEditor(props: { workspaceId: string; initial: Extract<GetMailSettingsResult, { ok: true }> }): JSX.Element
```

### 사전 키
- pagesUi.ts: `pages.wsSettings.nav.mail`='메일 발송', `pages.wsSettings.mailTitle`='메일 발송'
- settingsUi.ts(공용): `mailSettings.reason.<MailSettingsReason>` 8개 + 편집기 문구 `mailSettings.*`
- serverUi.ts: `srv.mailSettings.*`(테스트 발송 결과·SMTP 오류·조회 실패·호스트 거부)

### 마이그레이션
- supabase/migrations/0059_workspace_mail_settings.sql, supabase/rollbacks/0059_workspace_mail_settings_rollback.sql
- 표·제약은 설계 §1.1 그대로.

### 작업 번호(계획의 Task)
1 DB 마이그레이션·롤백·RLS 테스트 / 2 settingsInput / 3 workspaceSmtp / 4 transport·errors / 5 호출처(회의·초대) / 6 액션·매니페스트 / 7 편집기 컴포넌트 / 8 설정 페이지 연결 / 9 최종 검증·배포
커밋: Task 1 은 단독 커밋(마이그레이션 + tests/rls 만, src 금지 — G1). 이후 각 Task 끝에 커밋(src+tests). 커밋 메시지 한국어, 끝에
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add -A` 금지 — 파일명 명시.

---

### Task 1: DB — 메일 설정 표·권한·`delete_empty_workspace` 부속 표·롤백·RLS 테스트

이 작업은 마이그레이션 커밋 하나로 끝난다. 설계 §1(표·권한·삭제 관계·롤백), §6(불변식·DB), §7-1(배포 순서 1)이 근거다.
`src/` 는 건드리지 않는다. G1 은 `supabase/migrations/*` 와 `src/` 가 한 커밋에 섞이는 것을 막고, `tests/` 는 같이 담아도 된다.
사용자 문구는 없다. 이 작업이 만드는 것은 DB 토큰(제약 이름·`WORKSPACE_MAIL_SETTINGS_POSTCHECK`)뿐이므로 사전(`src/lib/i18n/dict/*`)에 더할 것이 없다.
`MAIL_SETTINGS_UNAVAILABLE` 같은 앱 문구는 Task 4·6 이 더한다.

**Files:**
- Create: `supabase/migrations/0059_workspace_mail_settings.sql`
- Create: `supabase/rollbacks/0059_workspace_mail_settings_rollback.sql`
- Create (Test): `tests/rls/workspace-mail-settings.test.ts`
- Modify (Test): `tests/rls/isolation-map.ts` — `A_ROW_FILTER` 한 줄, `UPDATE_DENIED_BY_GRANT` 한 항목과 주석의 개수
- Modify (Test): `tests/rls/fixture-ws.sql` — A 워크스페이스의 메일 설정 행 하나(파일 끝, SP7 `integration_credentials` 블록 뒤)

**검토한 불변식과 이 작업이 그것을 지키는 방법:**

| 불변식 | 이 작업에서 |
|---|---|
| `tests/invariants/migration-files.test.ts` | 이름이 `NNNN_snake.sql` 이고 0059 는 유일하다(최신이 `0058_project_delete.sql`). `_rollback` 짝이 `supabase/rollbacks/` 에 있다 |
| CLAUDE.md 데이터 규칙 | 롤백 이름은 `0059_workspace_mail_settings_rollback.sql` 이다. 이름이 `atomic` 으로 끝나는 식별자는 없다. 테스트는 마이그레이션을 번호가 아니라 접미(`_workspace_mail_settings.sql`)로 찾는다. `supabase db push` 는 쓰지 않는다 |
| `tests/gates/rpc-tables.test.ts` | `delete_empty_workspace` 의 마지막 정의가 0059 로 바뀐다. 본문이 쓰는 표는 여전히 `workspaces` 하나뿐이다(`execute … count(*)` 는 읽기라 셈에 들지 않는다). 그래서 `tests/gates/_rpc-tables.ts` 의 `delete_empty_workspace: ['workspaces']` 는 그대로 둔다 |
| `tests/invariants/rpc-actor-source.test.ts` | `p_actor` 를 받는 함수 집합은 그대로다(같은 함수를 다시 정의할 뿐이다) |
| `tests/invariants/b3-excluded-features.test.ts` | 새 표 이름은 금지 패턴(`reserv`·`upload_…`·`version_attachments`)에 걸리지 않는다 |
| `tests/rls/workspace-isolation.test.ts` | 카탈로그의 모든 표가 `A_ROW_FILTER` 에 있어야 한다. A 행이 없으면 `UNFILLED` 에 사유가 있어야 하는데 `UNFILLED` 는 비워 둔 채 픽스처가 A 행을 넣는다. UPDATE 할 열이 없는 표는 `UPDATE_DENIED_BY_GRANT` 에 있어야 한다. 세 변경을 함께 넣는다 |
| `tests/rls/h2-table-grants.test.ts` | anon·authenticated 의 TRUNCATE·TRIGGER·REFERENCES·MAINTAIN 이 0이고, 정책 없는 DML 권한도 0이다. `revoke all … from public, anon, authenticated` 로 둘 다 지킨다 |
| `tests/rls/schema-invariants.test.ts` | "같은 public 표 쌍의 FK 는 하나"를 본다. 두 행위자 열은 `auth.users` 를 가리키므로 public 쌍이 아니고, `workspaces` FK 는 하나다 |
| `tests/rls/workspace-rename-delete.test.ts` | "빈 워크스페이스 삭제"의 `removed` 기대값(`{ workspace_settings: 1, workspace_settings_history: 1 }`)은 메일 행이 없는 워크스페이스라 그대로 맞는다. A 거부 케이스는 `toMatchObject` 라 픽스처의 A 메일 행이 더해져도 깨지지 않는다(부속이라 remaining 에 오지 않는다) |
| `tests/rls/project-delete.test.ts` | `projects` 에서 캐스케이드로 닿는 표만 본다. 새 표는 `workspaces` 만 참조하므로 그 범위 밖이다 |
| i18n·`tests/gates/manifest.ts`·`tests/invariants/admin-scope.test.ts`·`tests/settings/operational-env.test.ts` | `src/` 를 바꾸지 않으므로 이 작업과 관계없다. 액션·admin 클라이언트·env 는 Task 3·4·6 의 몫이다 |

`src/lib/workspace/deleteRemaining.ts` 는 건드리지 않는다. 부속 표는 `remaining` 에 오지 않기 때문이다(설계 §1.3).

- [ ] **Step 1: 로컬 DB 준비 — Docker 와 로컬 Supabase**

```bash
docker info >/dev/null && echo docker-ok          # Docker Desktop 또는 colima 가 떠 있어야 한다
supabase --version                                  # 검증한 버전은 2.75
cd /Users/jerry/orca/D-Flow
npm run db:start                                    # 로컬 Supabase 기동(이미 떠 있으면 그대로)
test -f .env.local || npm run env:local             # RLS 하네스는 .env.local 이 로컬을 가리켜야 붙는다(tests/rls/harness.ts localDsn)
```

기대 결과: `docker-ok`, CLI 버전 출력, `supabase start` 의 상태 표(또는 "already running").
RLS 테스트는 `npm run test` 가 아니라 `vitest.config.rls.ts`(`npm run test:rls`) 로 돈다. 기본 설정(`vitest.config.ts`)이 `tests/rls/**` 를 빼기 때문이다.
그래서 이 작업의 테스트 명령은 `npx vitest run -c vitest.config.rls.ts <file>` 꼴이다.

- [ ] **Step 2: 실패하는 RLS 테스트를 쓴다 — `tests/rls/workspace-mail-settings.test.ts`**

이 파일이 다루는 것: 세션(authenticated·anon) 거부, 공백 계정 23514(`workspace_mail_settings_login`)와 나머지 검사 제약,
`delete_empty_workspace` 가 메일 설정 행을 부속으로 함께 지우는 것, 재정의 뒤의 머리·실행권, 롤백 왕복.
꼴은 `tests/rls/workspace-rename-delete.test.ts`(`createEmpty`·`del`)와 `tests/rls/drop-agent-legacy.test.ts`(`inTx`)를 따른다.

```ts
// 워크스페이스 발송 메일 설정(*_workspace_mail_settings — 0059).
// ① 표는 service_role 전용 — RLS 켜짐·정책 0, anon·authenticated 의 표 권한 0. 세션은 읽지도 쓰지도 못한다(워크스페이스 관리자·플랫폼 관리자여도).
// ② 검사 제약 — 공백 계정·비밀번호(23514 workspace_mail_settings_login), 포트 넷, 포트-보안 짝, Gmail 고정값, 정규형 호스트, 빈 보내는 주소.
// ③ delete_empty_workspace 재정의 — 메일 설정 행은 부속 표다(함께 지워지고 removed 에 센다). 머리(DEFINER·search_path='')와 실행권은 0055 그대로.
// ④ 롤백 왕복 — 롤백이 함수를 0055 본문으로 되돌리고 표를 지우며, 다시 적용하면 같은 상태다.
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다. 마이그레이션은 번호가 아니라 접미로 찾는다(CLAUDE.md 데이터 규칙).
import { readFileSync, readdirSync } from 'node:fs'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const U = F.users
const ID = (nn: string) => `00000000-0000-4000-8000-0000000059${nn}`
const SLUG = 'rls-0059-empty'
const TABLE = 'public.workspace_mail_settings'
const FN = 'public.delete_empty_workspace(uuid, uuid, text)'
const DELETE = 'select public.delete_empty_workspace($1, $2, $3) as r'
const CREATE = 'select public.create_workspace_with_admin($1, $2, $3, $4, $5::jsonb, $6, $7) as r'
const INSERT = `insert into public.workspace_mail_settings (workspace_id, preset, host, port, secure, username, password, from_address)
                values ($1, $2, $3, $4, $5, $6, $7, $8)`

const sqlBySuffix = (dir: string, suffix: string) => {
  const hits = readdirSync(dir).filter((f) => f.endsWith(suffix))
  if (hits.length !== 1) throw new Error(`${dir} 에서 *${suffix} 가 ${hits.length}개다`)
  return readFileSync(`${dir}/${hits[0]}`, 'utf8')
}
/** 자체 begin;/commit; 을 걷어 이 연결의 트랜잭션 안에서 돈다(drop-agent-legacy.test.ts 와 같은 방식) */
const inTx = (sql: string) => sql.replace(/^begin;[ \t]*$/m, '').replace(/^commit;[ \t]*$/m, '')
const MIGRATION = inTx(sqlBySuffix('supabase/migrations', '_workspace_mail_settings.sql'))
const ROLLBACK = inTx(sqlBySuffix('supabase/rollbacks', '_workspace_mail_settings_rollback.sql'))

type Row = { preset: string; host: string; port: number; secure: boolean; username: string; password: string; from_address: string | null }
/** 검사 제약을 통과하는 기본 행(직접 입력·STARTTLS) — 케이스마다 한 칸씩 바꿔 넣는다 */
const BASE: Row = { preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'mailer@example.com', password: 'app-pass', from_address: null }
const values = (ws: string, over: Partial<Row>) => {
  const r = { ...BASE, ...over }
  return [ws, r.preset, r.host, r.port, r.secure, r.username, r.password, r.from_address]
}
const mailCount = async (c: PoolClient, ws: string) =>
  (await c.query<{ n: number }>('select count(*)::int as n from public.workspace_mail_settings where workspace_id = $1', [ws])).rows[0].n
/** 빈 워크스페이스 하나 — 첫 관리자를 정해 만든다(0054 의 생성 RPC 그대로 — workspace-rename-delete.test.ts 와 같은 꼴) */
async function createEmpty(c: PoolClient, admin: string): Promise<string> {
  const { rows: [{ r }] } = await c.query<{ r: { workspace_id: string } }>(
    CREATE, [U.platform, SLUG, '빈 조직', admin, JSON.stringify({ 'modules.allowed': [] }), ID('c1'), 1])
  return r.workspace_id
}
type Deleted = { status: string; slug: string; name: string; removed?: Record<string, number>; remaining?: Record<string, number> }
const del = async (c: PoolClient, actor: string, ws: string, slug: string) =>
  (await c.query<{ r: Deleted }>(DELETE, [actor, ws, slug])).rows[0].r
/** 함수 머리·실행권 — 재정의·롤백이 DEFINER·search_path 를 잃지 않았는지 */
const fnShape = async (c: PoolClient) => (await c.query<{ definer: boolean; path: boolean; anon: boolean; auth: boolean; svc: boolean; mail: boolean }>(
  `select p.prosecdef as definer, coalesce('search_path=""' = any (p.proconfig), false) as path,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as svc, position('workspace_mail_settings' in p.prosrc) > 0 as mail
     from pg_proc p where p.oid = $1::regprocedure`, [FN])).rows[0]

describe('① 권한 — service_role 전용', () => {
  it('RLS 켜짐·정책 0 · FK 는 workspaces 캐스케이드, 두 행위자 열(auth.users)은 set null', async () => {
    const { rows: [rel] } = await pool.query<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'workspace_mail_settings') as policies
         from pg_class c where c.oid = $1::regclass`, [TABLE])
    expect(rel).toEqual({ rls: true, policies: 0 })
    const { rows: fks } = await pool.query<{ col: string; target: string; deltype: string }>(
      `select a.attname::text as col, n.nspname || '.' || t.relname as target, c.confdeltype::text as deltype
         from pg_constraint c
         join pg_class t on t.oid = c.confrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.conrelid = $1::regclass and c.contype = 'f' order by 1`, [TABLE])
    expect(fks).toEqual([
      { col: 'password_set_by', target: 'auth.users', deltype: 'n' },
      { col: 'updated_by', target: 'auth.users', deltype: 'n' },
      { col: 'workspace_id', target: 'public.workspaces', deltype: 'c' },
    ])
  })

  it('anon·authenticated 의 실효 권한 0(열 권한 포함), service_role 은 읽기·쓰기 넷', async () => {
    const { rows } = await pool.query<{ role: string; priv: string }>(
      `select r.role, p.priv
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
        where has_table_privilege(r.role, $1::regclass, p.priv)
           or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege(r.role, $1::regclass, p.priv))
        order by 1, 2`, [TABLE])
    expect(rows.filter((r) => r.role !== 'service_role')).toEqual([])
    expect(rows.filter((r) => r.role === 'service_role').map((r) => r.priv)).toEqual(expect.arrayContaining(['DELETE', 'INSERT', 'SELECT', 'UPDATE']))
  })

  it('세션은 읽지도 쓰지도 못한다(42501 permission denied) — 그 워크스페이스의 관리자·플랫폼 관리자여도', async () => {
    for (const uid of [U.wsAdmin, U.platform]) {
      await asUser(pool, uid, async (c) => {
        const denied = { code: '42501', message: expect.stringContaining('permission denied for table workspace_mail_settings') }
        expect(await pgError(c, 'select * from public.workspace_mail_settings where workspace_id = $1', [F.ws]), `${uid}:select`).toMatchObject(denied)
        expect(await pgError(c, INSERT, values(F.wsB, {})), `${uid}:insert`).toMatchObject(denied)
        expect(await pgError(c, `update public.workspace_mail_settings set host = 'evil.example.com' where workspace_id = $1`, [F.ws]), `${uid}:update`)
          .toMatchObject(denied)
        expect(await pgError(c, 'delete from public.workspace_mail_settings where workspace_id = $1', [F.ws]), `${uid}:delete`).toMatchObject(denied)
      })
    }
  })

  it('anon 도 읽지 못한다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role anon')
      expect(await pgError(c, 'select * from public.workspace_mail_settings'))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for table workspace_mail_settings') })
    })
  })

  it('service_role 은 읽고 쓴다 — 픽스처의 A 행이 보이고, B 에 새 행을 넣고 지운다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      const { rows } = await c.query<{ host: string; port: number }>('select host, port from public.workspace_mail_settings where workspace_id = $1', [F.ws])
      expect(rows).toEqual([{ host: 'smtp.rls.invalid', port: 2525 }])
      expect(await pgError(c, INSERT, values(F.wsB, {}))).toBeNull()
      expect((await c.query('delete from public.workspace_mail_settings where workspace_id = $1', [F.wsB])).rowCount).toBe(1)
    })
  })
})

describe('② 검사 제약', () => {
  it('공백뿐인 계정·비밀번호는 23514 workspace_mail_settings_login — 행이 미설정으로 읽히는 일이 없다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const over of [{ username: '   ' }, { username: '' }, { password: ' \t ' }, { password: '' }] as Partial<Row>[]) {
        expect(await pgError(c, INSERT, values(F.wsB, over)), JSON.stringify(over))
          .toMatchObject({ code: '23514', constraint: 'workspace_mail_settings_login' })
      }
      expect(await mailCount(c, F.wsB)).toBe(0)
    })
  })

  it('포트 넷 밖·포트-보안 짝·Gmail 고정값·정규형 아닌 호스트·빈 보내는 주소·모르는 방식은 23514 — 제약 이름까지', async () => {
    const cases: [Partial<Row>, string][] = [
      [{ port: 2526 }, 'workspace_mail_settings_port_check'],
      [{ port: 8025 }, 'workspace_mail_settings_port_check'],
      [{ port: 465, secure: false }, 'workspace_mail_settings_tls'],
      [{ port: 587, secure: true }, 'workspace_mail_settings_tls'],
      [{ port: 25, secure: true }, 'workspace_mail_settings_tls'],
      [{ preset: 'gmail', host: 'smtp.gmail.com', port: 587, secure: false }, 'workspace_mail_settings_gmail'],
      [{ preset: 'gmail', host: 'smtp.example.com', port: 465, secure: true }, 'workspace_mail_settings_gmail'],
      [{ host: 'SMTP.example.com' }, 'workspace_mail_settings_host'],
      [{ host: 'smtp.example.com.' }, 'workspace_mail_settings_host'],
      [{ host: '' }, 'workspace_mail_settings_host'],
      [{ host: `${'a'.repeat(250)}.com` }, 'workspace_mail_settings_host'],
      [{ from_address: '  ' }, 'workspace_mail_settings_from'],
      [{ preset: 'outlook' }, 'workspace_mail_settings_preset_check'],
    ]
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const [over, constraint] of cases) {
        expect(await pgError(c, INSERT, values(F.wsB, over)), JSON.stringify(over)).toMatchObject({ code: '23514', constraint })
      }
      expect(await mailCount(c, F.wsB)).toBe(0)
    })
  })

  it('통과 — Gmail 고정값, 465 SSL, 25 STARTTLS, 2525 는 어느 쪽이든, 보내는 주소 지정', async () => {
    const ok: Partial<Row>[] = [
      { preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'sender@gmail.com' },
      { port: 465, secure: true },
      { port: 25, secure: false },
      { port: 2525, secure: true },
      { port: 2525, secure: false },
      { from_address: 'noreply@example.com' },
    ]
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const over of ok) {
        expect(await pgError(c, INSERT, values(F.wsB, over)), JSON.stringify(over)).toBeNull()
        await c.query('delete from public.workspace_mail_settings where workspace_id = $1', [F.wsB])
      }
      // 기본값: 비밀번호 설정 시각·갱신 시각은 now(), 행위자 열은 null
      await c.query(INSERT, values(F.wsB, {}))
      const { rows: [row] } = await c.query<{ set_at: boolean; upd_at: boolean; set_by: string | null; updated_by: string | null }>(
        `select password_set_at = now() as set_at, updated_at = now() as upd_at, password_set_by as set_by, updated_by
           from public.workspace_mail_settings where workspace_id = $1`, [F.wsB])
      expect(row).toEqual({ set_at: true, upd_at: true, set_by: null, updated_by: null })
    })
  })

  it('워크스페이스당 한 행 — 같은 워크스페이스에 둘째 행은 23505', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect(await pgError(c, INSERT, values(F.ws, {}))).toMatchObject({ code: '23505' })
    })
  })
})

describe('③ delete_empty_workspace — 메일 설정은 부속 표', () => {
  it('재정의가 머리를 잃지 않았다 — SECURITY DEFINER·search_path 빈 값·service_role 전용, 본문에 새 부속 표', async () => {
    expect(await asService(pool, fnShape)).toEqual({ definer: true, path: true, anon: false, auth: false, svc: true, mail: true })
  })

  it('메일 설정만 저장한 빈 워크스페이스도 지운다 — 메일 설정 행이 함께 사라지고 removed 에 센다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      await c.query(INSERT, values(ws, { preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true }))
      expect(await mailCount(c, ws)).toBe(1)
      const others = [await mailCount(c, F.ws), await mailCount(c, F.wsB)]
      await c.query('set local role service_role')
      const r = await del(c, U.platform, ws, SLUG)
      await c.query('reset role')
      expect(r).toEqual({
        status: 'deleted', slug: SLUG, name: '빈 조직',
        removed: { workspace_settings: 1, workspace_settings_history: 1, workspace_mail_settings: 1 },
      })
      expect(await mailCount(c, ws)).toBe(0)
      expect([await mailCount(c, F.ws), await mailCount(c, F.wsB)]).toEqual(others)
    })
  })

  it('자료가 있는 워크스페이스(A)는 거부한다 — 메일 설정 행은 남은 것으로 세지 않고 지워지지도 않는다', async () => {
    await asService(pool, async (c) => {
      expect(await mailCount(c, F.ws), '픽스처 A 행').toBe(1)
      const { rows: [{ slug }] } = await c.query<{ slug: string }>('select slug from public.workspaces where id = $1', [F.ws])
      const r = await del(c, U.platform, F.ws, slug)
      expect(r.status).toBe('blocked')
      expect(r.remaining).not.toHaveProperty('workspace_mail_settings')
      expect(await mailCount(c, F.ws)).toBe(1)
    })
  })

  it('메일 설정 행이 있어도 등급 재판정은 그대로 — 그 워크스페이스의 관리자는 지우지 못한다(AUTHZ_FORBIDDEN)', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.aLoose)
      await c.query(INSERT, values(ws, {}))
      expect(await pgError(c, DELETE, [U.aLoose, ws, SLUG])).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      expect(await mailCount(c, ws)).toBe(1)
    })
  })
})

describe('④ 롤백 왕복', () => {
  it('롤백은 함수를 0055 꼴(부속 넷·같은 머리·같은 실행권)로 되돌리고 표를 지운다 — 다시 적용하면 같은 상태다', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(ROLLBACK)
      expect((await c.query<{ t: string | null }>(`select to_regclass('public.workspace_mail_settings')::text as t`)).rows[0].t).toBeNull()
      expect(await fnShape(c)).toEqual({ definer: true, path: true, anon: false, auth: false, svc: true, mail: false })
      await c.query(MIGRATION)
      expect((await c.query<{ t: string | null }>(`select to_regclass('public.workspace_mail_settings')::text as t`)).rows[0].t).toBe('workspace_mail_settings')
      expect(await fnShape(c)).toEqual({ definer: true, path: true, anon: false, auth: false, svc: true, mail: true })
    } finally {
      await c.query('rollback')
      c.release()
    }
  })
})
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

```bash
cd /Users/jerry/orca/D-Flow
npx vitest run -c vitest.config.rls.ts tests/rls/workspace-mail-settings.test.ts
```

기대 결과: FAIL. 파일을 불러오는 단계에서 멈춘다 — `Error: supabase/migrations 에서 *_workspace_mail_settings.sql 가 0개다`(아직 마이그레이션이 없다).

- [ ] **Step 4: 전수 교차 맵과 픽스처에 새 표를 더한다 — 셋을 함께 넣는다**

`tests/rls/isolation-map.ts` — `A_ROW_FILTER` 에 새 표의 A 행 판별식을 더한다. `workspace_members` 앞에 넣는다.

old:
```ts
  workspace_members: `t.workspace_id = ${A}`,
  workspace_settings: `t.workspace_id = ${A}`,
```
new:
```ts
  workspace_mail_settings: `t.workspace_id = ${A}`,
  workspace_members: `t.workspace_id = ${A}`,
  workspace_settings: `t.workspace_id = ${A}`,
```

같은 파일의 `UPDATE_DENIED_BY_GRANT` 주석에 새 개수를 적는다. 지금 집합은 51개이고 새 표를 더하면 52개다.

old:
```ts
 * authenticated 가 UPDATE 할 수 있는 열이 하나도 없는 표(0012 뒤 47개, *_weekly_areas 뒤 49개 — 영역·영역-팀, *_command_receipts 뒤 50개 — 영수증, *_workflow_policy 뒤 51개 — 승인 원장, 0039 뒤 52개 — teams, 0041 뒤 50개 — 옛 에이전트 등록 표·옛 PAT 저장소 삭제) — 전수 교차의 update 탐침이 정책을 태울 수 없다. 권한이 온전한
```
new:
```ts
 * authenticated 가 UPDATE 할 수 있는 열이 하나도 없는 표(0012 뒤 47개, *_weekly_areas 뒤 49개 — 영역·영역-팀, *_command_receipts 뒤 50개 — 영수증, *_workflow_policy 뒤 51개 — 승인 원장, 0039 뒤 52개 — teams, 0041 뒤 50개 — 옛 에이전트 등록 표·옛 PAT 저장소 삭제, *_workspace_mail_settings 직전 51개 → 뒤 52개 — 발송 메일 설정) — 전수 교차의 update 탐침이 정책을 태울 수 없다. 권한이 온전한
```

집합에는 `'workspace_settings'` 앞에 한 항목을 더한다. 비교는 정렬해서 하므로 위치는 가독성 때문이다.

old:
```ts
  'wiki_questions', 'wiki_topic_revisions', 'wiki_topics', 'workspace_settings', 'workspace_settings_history', 'workspaces',
])
```
new:
```ts
  'wiki_questions', 'wiki_topic_revisions', 'wiki_topics', 'workspace_mail_settings', 'workspace_settings', 'workspace_settings_history', 'workspaces',
])
```

`UNFILLED` 는 비워 둔 채로 둔다(`{}`).

`tests/rls/fixture-ws.sql` — 파일 끝, SP7 `integration_credentials` 블록 바로 뒤에 붙인다. 끝에 붙이므로 앞쪽 줄 번호를 가리키는 다른 테스트의 주석은 어긋나지 않는다.

old(파일의 마지막 다섯 줄):
```sql
-- SP7: 서비스 전용 자격증명도 전수 교차 탐침에서 실제 A 행을 검사한다.
insert into public.integration_credentials(id,workspace_id,kind,name,token_prefix,token_hash,expires_at)
values('00000000-0000-0000-7e57-00000000f701','00000000-0000-0000-7e57-00000000aa01',
'minutes_api','rls-minutes','RlsMinutesA1',repeat('a',64),'2099-01-01T00:00:00Z')
on conflict(id) do nothing;
```
new:
```sql
-- SP7: 서비스 전용 자격증명도 전수 교차 탐침에서 실제 A 행을 검사한다.
insert into public.integration_credentials(id,workspace_id,kind,name,token_prefix,token_hash,expires_at)
values('00000000-0000-0000-7e57-00000000f701','00000000-0000-0000-7e57-00000000aa01',
'minutes_api','rls-minutes','RlsMinutesA1',repeat('a',64),'2099-01-01T00:00:00Z')
on conflict(id) do nothing;

-- 워크스페이스 발송 메일 설정(*_workspace_mail_settings): 서비스 전용 표도 전수 교차 탐침이 실제 A 행을 검사한다 — 행이 없으면 빈 검사가 된다.
-- 검사 제약을 통과하는 값(직접 입력·2525·STARTTLS). workspace-mail-settings.test.ts 의 "A 행" 케이스가 이 값을 본다
insert into public.workspace_mail_settings(workspace_id,preset,host,port,secure,username,password)
values('00000000-0000-0000-7e57-00000000aa01','custom','smtp.rls.invalid',2525,false,'rls-user','rls-pass')
on conflict(workspace_id) do nothing;
```

- [ ] **Step 5: 전수 교차 테스트도 실패하는지 확인한다**

```bash
cd /Users/jerry/orca/D-Flow
npx vitest run -c vitest.config.rls.ts tests/rls/workspace-isolation.test.ts
```

기대 결과: FAIL. `beforeAll` 의 `loadFixture` 가 `relation "public.workspace_mail_settings" does not exist`(42P01)로 멈춘다.

- [ ] **Step 6: 마이그레이션을 쓴다 — `supabase/migrations/0059_workspace_mail_settings.sql`**

표와 제약은 설계 §1.1 그대로다. 권한은 §1.2, 함수 재정의는 §1.3 을 따른다.
함수 본문은 `supabase/migrations/0055_workspace_rename_delete.sql` 64–152행을 그대로 옮긴 것이고, 바뀐 곳은 두 군데뿐이다.
하나는 `create function` 을 `create or replace function` 으로 바꾼 것이고, 다른 하나는 `v_attached` 에 `'workspace_mail_settings'` 를 더하고 그 위 주석 두 줄을 고친 것이다.
머리(`returns jsonb language plpgsql security definer set search_path to ''`)와 `revoke`/`grant` 를 반드시 다시 적는다.

```sql
-- 0059_workspace_mail_settings.sql
-- 워크스페이스 발송 메일 설정 — 회의 안내·프로젝트 초대 메일을 워크스페이스 관리자가 화면에서 정한 계정으로 보낸다.
-- 왜:
--   · 두 메일(src/app/actions/meetingNotify.ts·projectInvites.ts)은 배포 환경변수(SMTP_*)만 읽는다. 운영에는 그 값이 없어 메일이 하나도
--     나가지 않고, 계정을 바꾸려면 Vercel 환경변수를 고쳐 다시 배포해야 한다.
--   · 설정은 워크스페이스마다 따로 두고 워크스페이스 관리자가 정한다. 우선순위는 워크스페이스 설정 → env(SMTP_*) → 미설정
--     (설계 docs/superpowers/specs/2026-10-15-workspace-mail-settings-design.md).
-- 무엇:
--   ① workspace_mail_settings — 워크스페이스당 한 행. 행이 없으면 미설정이고 "끄기"는 행 삭제다(enabled 열을 두지 않는다 — 꺼진 행과 없는 행이
--      같은 뜻이 된다). 계정 로그인만 받는다 — 무인증 릴레이는 발신 주소 위조의 통로라 env(SMTP_AUTH=none)로만 쓴다.
--      검사 제약: 공백뿐인 계정·비밀번호·보내는 주소 거부(앱이 trim 해서 읽으므로 행이 'unset' 으로 읽히는 일이 없게), 포트는 SMTP 표준 넷
--      (25·465·587·2525 — 임의 포트로 내부망을 두드리는 탐침을 막는다), 포트-보안 짝(465 는 SSL, 587·25 는 STARTTLS, 2525 는 어느 쪽이든),
--      Gmail 프리셋은 smtp.gmail.com:465 SSL 고정, 호스트는 정규형(소문자·끝 점 없음·1~253자 — IP 리터럴·단일 레이블은 앱이 거른다).
--      password 는 평문이다(암호화하지 않는다). 지키는 것은 권한(②)뿐이다.
--      password_set_by·password_set_at 은 새 비밀번호를 입력했을 때만 앱이 바꾼다. 계정이 지워지면 두 행위자 열은 set null —
--      설정은 그 사람의 것이 아니라 워크스페이스의 발송 설정이다(관리자가 빠져도 지우지 않는다. 화면이 경고한다).
--   ② 권한 — RLS 를 켜고 정책은 두지 않는다. anon·authenticated 의 표 권한을 전부 회수하고 service_role 에만 준다
--      (0035 integration_credentials 와 같은 꼴). 세션은 읽지도 쓰지도 못한다 — 서버 액션 가드(requireWorkspaceAdmin)가 유일한 관문이다.
--   ③ delete_empty_workspace(0055) 재정의 — 부속 표의 닫힌 목록(v_attached)에 'workspace_mail_settings' 하나를 더한다. 메일 설정은 자료가 아니라
--      설정이다 — 안 넣으면 메일 설정을 저장한 적 있는 워크스페이스는 비어 있어도 지울 수 없다. 본문은 0055 그대로다(0056 은 주석에서만 언급,
--      그 뒤 재정의 없음). 머리 전체(security definer·set search_path to '')와 실행권을 다시 적는다 — 둘은 본문이 아니라 함수 속성이라
--      create or replace 에서 빠뜨리면 INVOKER·빈 설정으로 바뀐다.
-- 데이터: 적용만으로 바뀌는 행은 없다(표 하나를 만들고 함수 하나를 다시 정의한다).
-- 롤백: supabase/rollbacks/*_workspace_mail_settings_rollback.sql — 함수를 0055 본문으로 되돌리고 표를 지운다(저장된 메일 설정은 사라진다).

begin;

-- ① 표 -------------------------------------------------------------------------------------------------------------
create table public.workspace_mail_settings (
  workspace_id     uuid primary key references public.workspaces(id) on delete cascade,
  preset           text not null check (preset in ('gmail', 'custom')),
  host             text not null,
  port             integer not null check (port in (25, 465, 587, 2525)),
  secure           boolean not null,
  username         text not null,
  password         text not null,
  from_address     text,
  password_set_by  uuid references auth.users(id) on delete set null,
  password_set_at  timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  -- resolveSmtpSettings 가 값을 trim 해서 본다 — DB 도 공백뿐인 값을 받지 않는다(행이 'unset' 으로 읽히는 일이 없게)
  constraint workspace_mail_settings_login check (length(btrim(username)) > 0 and length(btrim(password)) > 0),
  constraint workspace_mail_settings_from check (from_address is null or length(btrim(from_address)) > 0),
  -- 포트와 보안 연결의 짝: 465 는 SSL, 587·25 는 STARTTLS(secure=false). 2525 는 어느 쪽이든
  constraint workspace_mail_settings_tls check (not (port = 465 and not secure) and not (port in (587, 25) and secure)),
  -- Gmail 프리셋은 서버 값을 고정한다(화면이 넣는 값 그대로)
  constraint workspace_mail_settings_gmail check (preset <> 'gmail' or (host = 'smtp.gmail.com' and port = 465 and secure)),
  -- 호스트는 정규화된 DNS 이름(소문자·끝 점 없음) — IP 리터럴·단일 레이블은 앱이 거른다
  constraint workspace_mail_settings_host check (length(host) between 1 and 253 and host = lower(host) and host !~ '\.$')
);

-- ② 권한 — service_role 전용(정책 없음). 기본 권한(pg_default_acl)이 새 표에 anon·authenticated 권한을 주므로 명시적으로 회수한다
alter table public.workspace_mail_settings enable row level security;
revoke all on table public.workspace_mail_settings from public, anon, authenticated;
grant all on table public.workspace_mail_settings to service_role;

-- ③ 빈 워크스페이스 삭제 — 0055 본문에 부속 표 하나(workspace_mail_settings)를 더한다. 머리·실행권을 그대로 다시 적는다 -----------------
create or replace function public.delete_empty_workspace(p_actor uuid, p_workspace_id uuid, p_expected_slug text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  -- 함께 지워지는 부속 표(닫힌 목록) — 빈 워크스페이스에도 저절로 생기는 행과 워크스페이스의 설정. 여기 없는 표는 0행이어야 한다.
  -- workspace_mail_settings(0059)는 자료가 아니라 발송 설정이다 — 메일만 설정한 빈 워크스페이스도 지울 수 있게 부속으로 센다
  v_attached constant text[] := array['workspace_settings', 'workspace_settings_history', 'user_preferences', 'usage_events', 'workspace_mail_settings'];
  v_slug text;
  v_name text;
  v_key text;
  v_n bigint;
  v_remaining jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  r record;
begin
  if p_actor is null or p_workspace_id is null or p_expected_slug is null then
    raise exception using errcode = '22023', message = 'WORKSPACE_DELETE_INVALID';
  end if;
  -- 등급 재판정(액션 가드 requireSuperuser 와 두 관문) — 워크스페이스를 지우는 것은 플랫폼 관리자뿐이다
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  -- 격리 수준 규칙(0011 공통): 잠근 뒤 참조 행을 세므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  -- 잠금 — 이 행을 가리키는 새 행의 FK 검사(FOR KEY SHARE)가 여기서 기다린다. 아래에서 센 뒤 지울 때까지 새 참조가 끼어들지 못한다
  select w.slug, w.name into v_slug, v_name from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORKSPACE_NOT_FOUND';
  end if;
  if v_slug is distinct from p_expected_slug then
    raise exception using errcode = '22023', message = 'WORKSPACE_SLUG_MISMATCH';
  end if;

  -- workspaces 를 참조하는 FK 전부(카탈로그) — 표 이름을 손으로 적지 않는다. 새 참조 표가 생겨도 행이 있으면 여기서 걸린다
  for r in
    select c.conrelid::pg_catalog.regclass::text as ident, n.nspname, cl.relname,
           pg_catalog.cardinality(c.conkey) as ncols,
           (select a.attname from pg_catalog.pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cl on cl.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
     where c.contype = 'f' and c.confrelid = 'public.workspaces'::pg_catalog.regclass
     order by 1
  loop
    v_key := case when r.nspname = 'public' then r.relname else r.nspname || '.' || r.relname end;
    -- 여러 열짜리 FK 는 이 함수가 셀 줄 모른다 — 모르면 지우지 않는다
    if r.ncols <> 1 then
      raise exception using errcode = '0A000', message = 'WORKSPACE_DELETE_UNKNOWN_REFERENCE', detail = v_key;
    end if;
    if v_key in ('workspace_members', 'people') then
      -- 실행자 본인의 소속·인물 행만 부속이다. 다른 사람의 소속, 다른 인물(계정 없는 외부 인력 포함)은 남은 자료다
      execute pg_catalog.format('select count(*) from %s t where t.%I = $1 and t.user_id is distinct from $2', r.ident, r.col)
        into v_n using p_workspace_id, p_actor;
    else
      execute pg_catalog.format('select count(*) from %s t where t.%I = $1', r.ident, r.col) into v_n using p_workspace_id;
    end if;
    if v_n = 0 then
      continue;
    end if;
    if v_key = any (v_attached) then
      v_removed := v_removed || pg_catalog.jsonb_build_object(v_key, coalesce((v_removed ->> v_key)::bigint, 0) + v_n);
    else
      v_remaining := v_remaining || pg_catalog.jsonb_build_object(v_key, coalesce((v_remaining ->> v_key)::bigint, 0) + v_n);
    end if;
  end loop;

  -- FK 없는 간접 참조 — 저장소의 ws/<id>/ 아래 파일(로고 등). 행을 지워도 파일은 남으므로 먼저 치우게 한다
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects o where o.name like $1' into v_n using 'ws/' || p_workspace_id::text || '/%';
    if v_n > 0 then
      v_remaining := v_remaining || pg_catalog.jsonb_build_object('storage.objects', v_n);
    end if;
  end if;

  if v_remaining <> '{}'::jsonb then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'slug', v_slug, 'name', v_name, 'remaining', v_remaining);
  end if;

  -- 삭제 — 행 하나. 부속 행은 FK 캐스케이드가 지우고, 권한 이력은 삭제 트리거(workspaces_purge_authz_events)가 치운다.
  -- 부속 행(실행자의 인물 행 등)을 다른 곳이 붙들고 있으면(다른 워크스페이스의 명단 등) FK 가 막는다 — 전부 없던 일로 하고 사유만 알린다
  begin
    delete from public.workspaces w where w.id = p_workspace_id;
  exception when foreign_key_violation then
    raise exception using errcode = '23503', message = 'WORKSPACE_DELETE_REFERENCED';
  end;
  return pg_catalog.jsonb_build_object('status', 'deleted', 'slug', v_slug, 'name', v_name, 'removed', v_removed);
end $$;
revoke all on function public.delete_empty_workspace(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_empty_workspace(uuid, uuid, text) to service_role;

-- 사후검사 WORKSPACE_MAIL_SETTINGS_POSTCHECK — 공백 계정 탐침(서브트랜잭션 안에서 되돌린다) 말고는 읽기만 한다
do $$
declare
  v text;
begin
  -- 표: RLS 켜짐·정책 0
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.workspace_mail_settings'::regclass)
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'workspace_mail_settings') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: RLS 가 꺼졌거나 정책이 있다(정책 없는 service_role 전용이어야 한다)';
  end if;

  -- anon·authenticated 의 실효 권한 0(열 권한·PUBLIC·상속 포함)
  select string_agg(format('%s:%s', r.role, p.priv), ', ' order by r.role, p.priv) into v
    from unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
   where has_table_privilege(r.role, 'public.workspace_mail_settings'::regclass, p.priv)
      or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          and has_any_column_privilege(r.role, 'public.workspace_mail_settings'::regclass, p.priv));
  if v is not null then raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 세션 롤에 표 권한이 남았다: %', v; end if;

  -- service_role 은 읽고 쓴다
  select string_agg(p.priv, ', ') into v
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
   where not has_table_privilege('service_role', 'public.workspace_mail_settings'::regclass, p.priv);
  if v is not null then raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: service_role 에 표 권한이 없다: %', v; end if;

  -- workspaces 참조는 캐스케이드 — 워크스페이스 삭제가 이 행에 막히지 않는다(부속 표)
  if not exists (select 1 from pg_constraint c
                  where c.contype = 'f' and c.conrelid = 'public.workspace_mail_settings'::regclass
                    and c.confrelid = 'public.workspaces'::regclass and c.confdeltype = 'c') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: workspaces 를 캐스케이드로 참조하지 않는다';
  end if;

  -- 공백 계정 행은 23514(workspace_mail_settings_login)로 거부된다 — 검사 제약은 FK(문장 끝 트리거)보다 먼저 평가된다
  begin
    insert into public.workspace_mail_settings (workspace_id, preset, host, port, secure, username, password)
      values (pg_catalog.gen_random_uuid(), 'custom', 'smtp.postcheck.invalid', 587, false, '   ', 'x');
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 공백 계정 행이 들어갔다';
  exception when check_violation then
    get stacked diagnostics v = constraint_name;
    if v is distinct from 'workspace_mail_settings_login' then
      raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 공백 계정 행이 다른 제약에 걸렸다: %', v;
    end if;
  end;

  -- 재정의한 삭제 RPC — 머리(DEFINER·search_path 빈 값)와 실행권(service_role 전용)이 0055 그대로다
  if not exists (select 1 from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid, uuid, text)'::regprocedure
                    and p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false)) then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: delete_empty_workspace 가 SECURITY DEFINER·search_path 빈 값이 아니다';
  end if;
  if has_function_privilege('anon', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: delete_empty_workspace 실행권이 어긋났다(세션 불가·service_role 가능이어야 한다)';
  end if;
  -- 본문: 새 부속 표 + 0055 의 관문 토큰(등급 재판정·카탈로그 FK 순회·slug 대조·잠금)
  select string_agg(x.token, ', ') into v
    from (values ('workspace_mail_settings'), ('platform_admins'), ('AUTHZ_FORBIDDEN'), ('pg_catalog.pg_constraint'),
                 ('WORKSPACE_SLUG_MISMATCH'), ('for update')) as x(token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid, uuid, text)'::regprocedure)) = 0;
  if v is not null then raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 삭제 RPC 에 빠진 것이 있다: %', v; end if;
end $$;

commit;
```

- [ ] **Step 7: 롤백을 쓴다 — `supabase/rollbacks/0059_workspace_mail_settings_rollback.sql`**

함수를 0055 본문으로 되돌린다. 0055 64–152행에서 `create function` 만 `create or replace function` 으로 바꿨고 머리와 실행권은 같다. 그다음 표를 지운다.
되돌리지 않는 데이터는 저장된 메일 설정이다(설계 §1.4).

```sql
-- 0059 롤백 — 워크스페이스 발송 메일 설정 표를 지우고 delete_empty_workspace 를 0055 본문으로 되돌린다.
-- 앱을 먼저 되돌린다 — 앱이 이 표를 읽는 동안 지우면 메일 설정 화면과 회의 안내·초대 발송이 조회 실패(MAIL_SETTINGS_UNAVAILABLE)로 멈춘다.
-- 옛 앱은 배포 환경변수(SMTP_*)로 보낸다.
-- 되돌리지 않는 데이터: 저장된 메일 설정(계정·앱 비밀번호) — 표와 함께 사라진다. 다시 적용하면 빈 표다(관리자가 다시 넣는다).
-- 함수는 0055 본문·같은 머리(security definer·set search_path to '')·같은 실행권으로 되돌린다 — 머리를 빠뜨리면 INVOKER·빈 설정이 된다.
-- 순서: 함수 먼저(부속 목록에서 이 표를 뺀다) → 표.
begin;

create or replace function public.delete_empty_workspace(p_actor uuid, p_workspace_id uuid, p_expected_slug text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  -- 함께 지워지는 부속 표(닫힌 목록) — 빈 워크스페이스에도 저절로 생기는 행. 여기 없는 표는 0행이어야 한다
  v_attached constant text[] := array['workspace_settings', 'workspace_settings_history', 'user_preferences', 'usage_events'];
  v_slug text;
  v_name text;
  v_key text;
  v_n bigint;
  v_remaining jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  r record;
begin
  if p_actor is null or p_workspace_id is null or p_expected_slug is null then
    raise exception using errcode = '22023', message = 'WORKSPACE_DELETE_INVALID';
  end if;
  -- 등급 재판정(액션 가드 requireSuperuser 와 두 관문) — 워크스페이스를 지우는 것은 플랫폼 관리자뿐이다
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  -- 격리 수준 규칙(0011 공통): 잠근 뒤 참조 행을 세므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  -- 잠금 — 이 행을 가리키는 새 행의 FK 검사(FOR KEY SHARE)가 여기서 기다린다. 아래에서 센 뒤 지울 때까지 새 참조가 끼어들지 못한다
  select w.slug, w.name into v_slug, v_name from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORKSPACE_NOT_FOUND';
  end if;
  if v_slug is distinct from p_expected_slug then
    raise exception using errcode = '22023', message = 'WORKSPACE_SLUG_MISMATCH';
  end if;

  -- workspaces 를 참조하는 FK 전부(카탈로그) — 표 이름을 손으로 적지 않는다. 새 참조 표가 생겨도 행이 있으면 여기서 걸린다
  for r in
    select c.conrelid::pg_catalog.regclass::text as ident, n.nspname, cl.relname,
           pg_catalog.cardinality(c.conkey) as ncols,
           (select a.attname from pg_catalog.pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cl on cl.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
     where c.contype = 'f' and c.confrelid = 'public.workspaces'::pg_catalog.regclass
     order by 1
  loop
    v_key := case when r.nspname = 'public' then r.relname else r.nspname || '.' || r.relname end;
    -- 여러 열짜리 FK 는 이 함수가 셀 줄 모른다 — 모르면 지우지 않는다
    if r.ncols <> 1 then
      raise exception using errcode = '0A000', message = 'WORKSPACE_DELETE_UNKNOWN_REFERENCE', detail = v_key;
    end if;
    if v_key in ('workspace_members', 'people') then
      -- 실행자 본인의 소속·인물 행만 부속이다. 다른 사람의 소속, 다른 인물(계정 없는 외부 인력 포함)은 남은 자료다
      execute pg_catalog.format('select count(*) from %s t where t.%I = $1 and t.user_id is distinct from $2', r.ident, r.col)
        into v_n using p_workspace_id, p_actor;
    else
      execute pg_catalog.format('select count(*) from %s t where t.%I = $1', r.ident, r.col) into v_n using p_workspace_id;
    end if;
    if v_n = 0 then
      continue;
    end if;
    if v_key = any (v_attached) then
      v_removed := v_removed || pg_catalog.jsonb_build_object(v_key, coalesce((v_removed ->> v_key)::bigint, 0) + v_n);
    else
      v_remaining := v_remaining || pg_catalog.jsonb_build_object(v_key, coalesce((v_remaining ->> v_key)::bigint, 0) + v_n);
    end if;
  end loop;

  -- FK 없는 간접 참조 — 저장소의 ws/<id>/ 아래 파일(로고 등). 행을 지워도 파일은 남으므로 먼저 치우게 한다
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects o where o.name like $1' into v_n using 'ws/' || p_workspace_id::text || '/%';
    if v_n > 0 then
      v_remaining := v_remaining || pg_catalog.jsonb_build_object('storage.objects', v_n);
    end if;
  end if;

  if v_remaining <> '{}'::jsonb then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'slug', v_slug, 'name', v_name, 'remaining', v_remaining);
  end if;

  -- 삭제 — 행 하나. 부속 행은 FK 캐스케이드가 지우고, 권한 이력은 삭제 트리거(workspaces_purge_authz_events)가 치운다.
  -- 부속 행(실행자의 인물 행 등)을 다른 곳이 붙들고 있으면(다른 워크스페이스의 명단 등) FK 가 막는다 — 전부 없던 일로 하고 사유만 알린다
  begin
    delete from public.workspaces w where w.id = p_workspace_id;
  exception when foreign_key_violation then
    raise exception using errcode = '23503', message = 'WORKSPACE_DELETE_REFERENCED';
  end;
  return pg_catalog.jsonb_build_object('status', 'deleted', 'slug', v_slug, 'name', v_name, 'removed', v_removed);
end $$;
revoke all on function public.delete_empty_workspace(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_empty_workspace(uuid, uuid, text) to service_role;

drop table if exists public.workspace_mail_settings;

-- 사후검사 WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK — 읽기만 한다
do $$
begin
  if pg_catalog.to_regclass('public.workspace_mail_settings') is not null then
    raise exception 'WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK: workspace_mail_settings 가 남았다';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid, uuid, text)'::regprocedure
                    and p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false)
                    and position('workspace_mail_settings' in p.prosrc) = 0
                    and position('usage_events' in p.prosrc) > 0) then
    raise exception 'WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK: delete_empty_workspace 가 0055 꼴(DEFINER·search_path 빈 값·부속 넷)이 아니다';
  end if;
  if has_function_privilege('anon', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK: delete_empty_workspace 실행권이 어긋났다';
  end if;
end $$;

commit;
```

- [ ] **Step 8: 빈 Postgres 에 재적용해 검증한다(스테이징 리허설)**

```bash
cd /Users/jerry/orca/D-Flow
npm run db:reset
date '+%F %H:%M'      # 이 시각을 커밋 트레일러 Staging-verified 에 적는다
```

기대 결과: 마지막에 `Finished supabase db reset on branch …`가 나온다. 0059 의 `do $$ … $$`(WORKSPACE_MAIL_SETTINGS_POSTCHECK)가 예외 없이 지나간다.
실패하면 메시지의 `WORKSPACE_MAIL_SETTINGS_POSTCHECK: …` 사유를 보고 고친다. 사유는 권한 잔존, FK 캐스케이드, 공백 행 거부, 함수 머리, 본문 토큰 가운데 하나다.

이 작업의 검사(Step 9~10)에는 개발 계정이 필요 없다. RLS 하네스가 자체 픽스처를 넣는다. 그래서 `dev:bootstrap` 은 이 작업의 필수 단계가 아니다.
(선택) 리셋은 계정까지 지우므로, 이어서 `npm run dev` 로 화면을 볼 때만 프롬프트 없이 env 로 다시 만든다(비밀번호는 파일에 남기지 않는다).
```bash
BOOTSTRAP_EMAIL=… BOOTSTRAP_PASSWORD=… npm run dev:bootstrap   # 선택 — Task 1 검사와 무관
```

- [ ] **Step 9: RLS 테스트를 돌려 통과를 확인한다**

```bash
cd /Users/jerry/orca/D-Flow
npx vitest run -c vitest.config.rls.ts tests/rls/workspace-mail-settings.test.ts
```
기대 결과: PASS(①~④ 14건).

영향을 받는 기존 RLS 테스트도 돌린다.
```bash
npx vitest run -c vitest.config.rls.ts tests/rls/workspace-isolation.test.ts tests/rls/workspace-rename-delete.test.ts tests/rls/workspace-archive.test.ts tests/rls/h2-table-grants.test.ts tests/rls/schema-invariants.test.ts
```
기대 결과: PASS.
- `workspace-isolation` 의 "카탈로그의 표 = 판별 맵의 표", "B 계정 … = KNOWN_LEAKS"(grantDenied 가 52개 집합과 같다), "update 할 열이 하나도 없는 표 = UPDATE_DENIED_BY_GRANT" 가 초록이다.
- 이 셋 가운데 하나라도 빨갛다면 Step 4 의 세 변경 가운데 빠진 것이 있다.

마지막으로 RLS 전체를 돈다. 한 DB 를 공유하므로 파일은 직렬로 돈다.
```bash
npm run test:rls
```
기대 결과: 전부 PASS.

- [ ] **Step 10: 마이그레이션 원문을 읽는 단위 불변식을 돌린다**

```bash
cd /Users/jerry/orca/D-Flow
npx vitest run tests/invariants/migration-files.test.ts tests/gates/rpc-tables.test.ts tests/invariants/rpc-actor-source.test.ts tests/invariants/b3-excluded-features.test.ts
```
기대 결과: PASS.
- `migration-files`: 이름 규약·번호 유일·롤백 짝.
- `rpc-tables`: `delete_empty_workspace` 가 쓰는 표가 여전히 `['workspaces']` 다.
- `rpc-actor-source`: `p_actor` 함수 집합이 그대로다.
- `b3`: 금지 표 이름 0건.

`tests/rls/**` 의 타입은 CI 의 `npm run typecheck`(tsconfig 가 `**/*.ts` 를 포함한다)가 보므로 함께 돌린다.
```bash
npm run typecheck
```
기대 결과: 오류 0.

- [ ] **Step 11: 커밋한다 — 마이그레이션·롤백·tests/rls 만(`src/` 없음, G1)**

`<YYYY-MM-DD HH:MM>` 에는 Step 8 에서 `npm run db:reset` 이 초록으로 끝난 직후 출력한 시각을 그대로 적는다(G4).
```bash
cd /Users/jerry/orca/D-Flow
git add supabase/migrations/0059_workspace_mail_settings.sql supabase/rollbacks/0059_workspace_mail_settings_rollback.sql tests/rls/workspace-mail-settings.test.ts tests/rls/isolation-map.ts tests/rls/fixture-ws.sql
git status --short     # 위 다섯 파일만 staged 인지 확인한다(git add -A 금지)
git commit -m "워크스페이스 발송 메일 설정 표 — 관리자가 화면에서 정한 계정으로 회의 안내·초대 메일을 보내기 위한 저장소" -m "운영에는 SMTP_* 가 없어 메일이 나가지 않고, 계정을 바꾸려면 재배포해야 했다. 워크스페이스마다 한 행을 두고
service_role 만 읽고 쓴다(RLS 켜짐·정책 없음 — 연동 자격증명과 같은 꼴). 공백 계정·표준 밖 포트·포트-보안 짝 어긋남·
Gmail 고정값 위반·정규형 아닌 호스트는 DB 가 거부한다. 메일 설정은 자료가 아니라 설정이므로 delete_empty_workspace 의
부속 표에 더해, 메일만 설정한 빈 워크스페이스도 지울 수 있게 한다(머리·실행권은 0055 그대로 다시 적었다)." -m "Staging-verified: local db reset <YYYY-MM-DD HH:MM>
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
기대 결과: 커밋 1건, 파일 5개. push 는 하지 않는다. push 는 사람 확인 뒤에 한다.
`main` push 는 곧 운영 배포이므로, 운영 DB 적용(`db:apply … --target prod` + `schema_migrations` 행)이 먼저다. 이는 Task 9 와 설계 §7-2 의 몫이다.

- [ ] **Step 12: 작업 끝 — 다시 돌릴 기존 테스트 목록**

이 작업 뒤 다른 Task 로 넘어가기 전에 다음을 돌려 초록인지 확인한다(Step 9·10 과 같다).
- `npm run test:rls`: 특히 `workspace-mail-settings`, `workspace-isolation`, `workspace-rename-delete`, `workspace-archive`, `h2-table-grants`, `schema-invariants`.
- `npx vitest run tests/invariants/migration-files.test.ts tests/gates/rpc-tables.test.ts tests/invariants/rpc-actor-source.test.ts tests/invariants/b3-excluded-features.test.ts`
- `npm run typecheck`

로컬 Supabase 는 다음 Task(앱 코드)에서도 쓰므로 계속 띄워 둔다. 전체 작업이 끝나면 `npm run db:stop` 으로 내린다.

---

### Task 2: 발송 메일 설정 입력 정규화 — `src/lib/mail/settingsInput.ts`

설계 §3(입력 형상·비밀번호 재사용 규칙)·§2.4(호스트 정규화)·§4(사유 문구는 공용 `settingsUi.ts`)를 순수 모듈 하나로 만든다.
폼(Task 7 `MailSettingsEditor`, 클라이언트)과 서버 액션(Task 6 `mailSettings.ts`)이 이 모듈 한 벌을 쓴다.

확인한 사실(계획 작성 시 리포 실측):
- `toAsciiHostname`(`src/lib/domain/hostname.ts`)과 `isValidEmail`(`src/lib/mail/recipients.ts`)은 클라이언트에서 import 해도 된다 — 두 파일과
  그 값 import 사슬(`recipients.ts` → `domain/email.ts` → `domain/validate.ts`·`domain/hostname.ts`)에 `'server-only'` 가 없고,
  `recipients.ts` 는 이미 `'use client'` 인 `src/components/meetings/MeetingFormModal.tsx` 가 가져온다(`domain/types` 는 `import type`).
  `src/lib/mail/` 에서 `'server-only'` 는 `transport.ts`·`fromName.ts` 둘뿐이다 — 이 모듈은 그 둘을 값으로 가져오지 않는다(테스트가 사슬 전체를 걸어 확인한다).
- `src/lib/i18n/dict/settingsUi.ts`(`settingsUiKo`)는 `adminUi.ts` 가 펼쳐 `dict/ko.ts` 의 `KO` 에 들어간다 → 클라이언트 `DictKey` 에 포함된다(계약의 `settingsUi.ts` 가 맞다).
  서버 전용 `serverUi.ts` 와 키가 겹치면 `tests/invariants/i18n-server-messages.test.ts`('서버 키와 공용 키는 겹치지 않고…')가 실패한다 —
  그래서 `mailSettings.reason.*` 은 `settingsUi.ts` 에만 두고, Task 4·6 의 서버 문구는 `srv.mailSettings.*` 접두를 쓴다.
- `resolveSmtpSettings`(`transport.ts`)는 값을 trim 해서 읽고, 보내는 주소가 비면 `SMTP_USER` 가 이메일 형식이어야 ok 다 →
  정규화는 같은 조건을 미리 걸러(`from_invalid`) 저장한 행이 발송 때 'invalid' 로 읽히지 않게 한다. 테스트의 '…함께 통과한다' 묶음이 이 짝을 실측한다.
- `password_required` 는 `normalizeMailSettingsInput` 이 내지 않는다(저장 행을 알아야 판정한다). 호출자(Task 6 액션)가
  `value.password === null && !canReusePassword(value, stored)` 일 때 이 코드로 거부하고 `reasonKey('password_required')` 문구를 쓴다.
- 직접 입력의 `secure` 가 불리언이 아니면 포트로 정한다(465 → true, 나머지 → false). Gmail 주소의 도메인은 묻지 않는다(Google Workspace 도메인도 smtp.gmail.com).
- 이 코드와 테스트는 계획 작성 중 리포 사본에서 실행해 105건 통과·`tsc` 오류 0 을 확인했다.

**Files:**
- Create: `src/lib/mail/settingsInput.ts`
- Modify: `src/lib/i18n/dict/settingsUi.ts` (끝에 `mailSettings.reason.*` 8개)
- Test: `tests/mail/settings-input.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/mail/settings-input.test.ts` 를 새로 만든다:

```ts
// 발송 메일 설정 입력 정규화(src/lib/mail/settingsInput.ts) — 폼과 서버 액션이 같은 규칙을 쓴다(설계 2026-10-15 §3·§2.4).
// 여기를 통과한 값은 DB 제약(0059)과 발송 판정(resolveSmtpSettings)을 함께 통과해야 한다 — 가운데 묶음이 그 짝을 실측한다.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  normalizeMailSettingsInput, canReusePassword, reasonKey,
  MAIL_PORTS, GMAIL_HOST, type MailSettingsReason,
} from '@/lib/mail/settingsInput'
import { resolveSmtpSettings } from '@/lib/mail/transport'
import { KO } from '@/lib/i18n/dict/ko'

const custom = (over: Record<string, unknown> = {}) => ({
  preset: 'custom', host: 'smtp.example.com', port: 587, secure: false,
  username: 'sender@example.com', password: 'pw-1234', fromAddress: '', ...over,
})
const code = (input: unknown) => {
  const r = normalizeMailSettingsInput(input)
  return r.ok ? 'ok' : r.code
}

describe('normalizeMailSettingsInput — 방식', () => {
  it.each([null, undefined, 'gmail', 42, [], {}, { preset: 'smtp' }, { preset: 'GMAIL' }])('방식이 아니면 preset_invalid: %j', (v) => {
    expect(code(v)).toBe('preset_invalid')
  })
})

describe('normalizeMailSettingsInput — Gmail', () => {
  it('서버 값을 고정하고 계정 = 주소(trim·소문자), 보내는 주소는 비운다(→ 계정)', () => {
    const r = normalizeMailSettingsInput({ preset: 'gmail', address: '  Sender@Gmail.com ', password: 'abcdefghijklmnop' })
    expect(r).toEqual({
      ok: true,
      value: { preset: 'gmail', host: GMAIL_HOST, port: 465, secure: true, username: 'sender@gmail.com', password: 'abcdefghijklmnop', from_address: null },
    })
  })

  it('앱 비밀번호의 공백(4자씩 띄운 표시·탭·줄바꿈)을 모두 지운다', () => {
    const r = normalizeMailSettingsInput({ preset: 'gmail', address: 'a@gmail.com', password: ' abcd efgh\tijkl\nmnop ' })
    expect(r.ok && r.value.password).toBe('abcdefghijklmnop')
  })

  it('Gmail 이면 직접 입력 칸(host·port·secure·username·fromAddress)을 읽지 않는다', () => {
    const r = normalizeMailSettingsInput({
      preset: 'gmail', address: 'a@gmail.com', password: 'x',
      host: 'evil.example.com', port: 25, secure: false, username: 'other', fromAddress: 'boss@example.com',
    })
    expect(r.ok && r.value).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, username: 'a@gmail.com', from_address: null })
  })

  it('비밀번호가 비거나 공백뿐이거나 문자열이 아니면 null(저장값 재사용 후보)', () => {
    for (const password of [undefined, '', '   ', 1234]) {
      const r = normalizeMailSettingsInput({ preset: 'gmail', address: 'a@gmail.com', password })
      expect(r.ok && r.value.password, String(password)).toBeNull()
    }
  })

  it.each(['', '   ', 'not-an-email', 'a@b', 'a b@gmail.com', 'a@gmail.com, b@gmail.com'])('주소 형식이 아니면 address_invalid: %j', (address) => {
    expect(code({ preset: 'gmail', address, password: 'x' })).toBe('address_invalid')
  })

  it('주소가 문자열이 아니면 address_invalid', () => {
    expect(code({ preset: 'gmail', address: 42, password: 'x' })).toBe('address_invalid')
  })
})

describe('normalizeMailSettingsInput — 직접 입력', () => {
  it('정상 입력 — 호스트는 소문자·끝 점 제거, 포트 문자열은 숫자로, 계정·비밀번호는 trim, 빈 보내는 주소는 null', () => {
    const r = normalizeMailSettingsInput(custom({ host: ' SMTP.Example.COM. ', port: ' 587 ', username: '  sender@example.com ', password: '  pw-1234 ' }))
    expect(r).toEqual({
      ok: true,
      value: { preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'sender@example.com', password: 'pw-1234', from_address: null },
    })
  })

  it('계정은 대소문자를 그대로 둔다(가리는 서버가 있다), 보내는 주소는 trim 해서 둔다', () => {
    const r = normalizeMailSettingsInput(custom({ username: 'MailUser', fromAddress: ' noreply@example.com ' }))
    expect(r.ok && r.value).toMatchObject({ username: 'MailUser', from_address: 'noreply@example.com' })
  })

  it('비밀번호 안쪽 공백은 지우지 않는다(Gmail 만 지운다)', () => {
    const r = normalizeMailSettingsInput(custom({ password: 'pass word' }))
    expect(r.ok && r.value.password).toBe('pass word')
  })

  it('국제화 도메인은 퓨니코드로 저장한다', () => {
    const r = normalizeMailSettingsInput(custom({ host: 'smtp.한국.kr' }))
    expect(r.ok && r.value.host).toBe('smtp.xn--3e0b707e.kr')
  })

  it.each([
    '', '   ', 'localhost', 'localhost.', 'LOCALHOST', 'mail', 'intranet.',
    '127.0.0.1', '10.0.0.1', '192.168.0.10', '0x7f.1', '[::1]', '::1', 'fe80::1',
    'smtp.example.com:25', 'http://smtp.example.com', 'smtp.example.com/evil', 'smtp.example.com?x', 'user@smtp.example.com',
    'a..example.com', 'smtp.example.com..', '-smtp.example.com', 'smtp_relay.example.com', 'smtp.ex%61mple.com',
  ])('도메인 이름이 아니면 host_invalid: %j', (host) => {
    expect(code(custom({ host }))).toBe('host_invalid')
  })

  it('서버 주소가 문자열이 아니면 host_invalid', () => {
    expect(code(custom({ host: 42 }))).toBe('host_invalid')
    expect(code(custom({ host: undefined }))).toBe('host_invalid')
  })

  it('포트는 표준 넷만 — 숫자·숫자 문자열 모두', () => {
    expect(MAIL_PORTS).toEqual([25, 465, 587, 2525])
    for (const port of MAIL_PORTS) {
      const secure = port === 465
      expect(code(custom({ port, secure })), String(port)).toBe('ok')
      expect(code(custom({ port: String(port), secure })), `'${port}'`).toBe('ok')
    }
  })

  it.each([0, 1, 22, 80, 443, 3306, 8025, 65535, 587.5, -587, NaN, '', ' ', '587a', '0x24b', '5 87', '1e3', undefined, null, true])(
    '표준 넷 밖이면 port_invalid: %j', (port) => {
      expect(code(custom({ port }))).toBe('port_invalid')
    })

  it('포트-보안 짝 — 465 는 SSL, 587·25 는 STARTTLS, 2525 는 어느 쪽이든', () => {
    expect(code(custom({ port: 465, secure: false }))).toBe('tls_mismatch')
    expect(code(custom({ port: 587, secure: true }))).toBe('tls_mismatch')
    expect(code(custom({ port: 25, secure: true }))).toBe('tls_mismatch')
    expect(code(custom({ port: 465, secure: true }))).toBe('ok')
    expect(code(custom({ port: 587, secure: false }))).toBe('ok')
    expect(code(custom({ port: 25, secure: false }))).toBe('ok')
    expect(code(custom({ port: 2525, secure: true }))).toBe('ok')
    expect(code(custom({ port: 2525, secure: false }))).toBe('ok')
  })

  it('보안 연결이 불리언이 아니면 포트로 정한다(465 → SSL, 나머지 → STARTTLS)', () => {
    const at = (port: number, secure: unknown) => {
      const r = normalizeMailSettingsInput(custom({ port, secure }))
      return r.ok ? r.value.secure : r.code
    }
    expect(at(465, undefined)).toBe(true)
    expect(at(587, undefined)).toBe(false)
    expect(at(25, 'true')).toBe(false)
    expect(at(2525, undefined)).toBe(false)
  })

  it.each(['', '   ', undefined, 42])('계정이 비면 username_required: %j', (username) => {
    expect(code(custom({ username }))).toBe('username_required')
  })

  it('보내는 주소를 비우면 계정이 이메일이어야 한다 — 아니면 from_invalid', () => {
    expect(code(custom({ username: 'mailuser', fromAddress: '' }))).toBe('from_invalid')
    expect(code(custom({ username: 'mailuser', fromAddress: '   ' }))).toBe('from_invalid')
    expect(code(custom({ username: 'mailuser', fromAddress: 'noreply@example.com' }))).toBe('ok')
  })

  it.each(['not-an-email', 'a@b', 'Boss <boss@example.com>', 'a@example.com,b@example.com'])('보내는 주소가 형식이 아니면 from_invalid: %j', (fromAddress) => {
    expect(code(custom({ fromAddress }))).toBe('from_invalid')
  })

  it('검사 순서 — 서버 주소 → 포트 → 보안 짝 → 계정 → 보내는 주소', () => {
    expect(code(custom({ host: 'localhost', port: 1, username: '' }))).toBe('host_invalid')
    expect(code(custom({ port: 1, secure: 'x', username: '' }))).toBe('port_invalid')
    expect(code(custom({ port: 465, secure: false, username: '' }))).toBe('tls_mismatch')
    expect(code(custom({ username: '', fromAddress: 'bad' }))).toBe('username_required')
  })

  it('비밀번호가 비거나 공백뿐이면 null(저장값 재사용 후보) — 정규화는 password_required 를 내지 않는다', () => {
    for (const password of [undefined, '', '   ']) {
      const r = normalizeMailSettingsInput(custom({ password }))
      expect(r.ok && r.value.password, String(password)).toBeNull()
    }
  })
})

describe('정규화 결과는 발송 판정(resolveSmtpSettings)과 DB 제약(0059)을 함께 통과한다', () => {
  const asEnv = (v: { host: string; port: number; secure: boolean; username: string; from_address: string | null }) => ({
    SMTP_HOST: v.host, SMTP_PORT: String(v.port), SMTP_SECURE: String(v.secure),
    SMTP_USER: v.username, SMTP_PASS: 'pw', SMTP_FROM_ADDRESS: v.from_address ?? '',
  })
  it.each([
    ['gmail', { preset: 'gmail', address: 'A@gmail.com', password: 'abcd efgh ijkl mnop' }],
    ['custom 587', custom()],
    ['custom 465', custom({ port: 465, secure: true })],
    ['custom 2525 SSL', custom({ port: 2525, secure: true })],
    ['custom 계정 ≠ 이메일', custom({ username: 'mailuser', fromAddress: 'noreply@example.com' })],
    ['custom IDN', custom({ host: 'SMTP.한국.KR.' })],
  ])('%s', (_name, input) => {
    const r = normalizeMailSettingsInput(input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = r.value
    expect(resolveSmtpSettings(asEnv(v)).ok).toBe(true)
    // workspace_mail_settings_host·_login·_from·_tls·_gmail 과 같은 식
    expect(v.host.length).toBeGreaterThan(0)
    expect(v.host.length).toBeLessThanOrEqual(253)
    expect(v.host).toBe(v.host.toLowerCase())
    expect(v.host.endsWith('.')).toBe(false)
    expect(v.username.trim().length).toBeGreaterThan(0)
    expect(v.from_address === null || v.from_address.trim().length > 0).toBe(true)
    expect(MAIL_PORTS as readonly number[]).toContain(v.port)
    expect(v.port === 465 && !v.secure).toBe(false)
    expect((v.port === 587 || v.port === 25) && v.secure).toBe(false)
    if (v.preset === 'gmail') expect([v.host, v.port, v.secure]).toEqual(['smtp.gmail.com', 465, true])
  })
})

describe('canReusePassword — 빈 비밀번호로 저장값을 다시 써도 되는가', () => {
  const stored = { host: 'smtp.example.com', username: 'sender@example.com' }

  it('저장 행이 없으면 false', () => {
    expect(canReusePassword(stored, null)).toBe(false)
  })

  it('같은 서버·같은 계정이면 true — 서버 주소의 대소문자·끝 점, 계정의 대소문자·앞뒤 공백은 같은 것으로 본다', () => {
    expect(canReusePassword({ host: 'smtp.example.com', username: 'sender@example.com' }, stored)).toBe(true)
    expect(canReusePassword({ host: 'SMTP.Example.com.', username: '  Sender@Example.COM ' }, stored)).toBe(true)
  })

  it('국제화 도메인은 유니코드·퓨니코드 표기를 같은 서버로 본다', () => {
    expect(canReusePassword({ host: 'smtp.한국.kr', username: 'u@example.com' }, { host: 'smtp.xn--3e0b707e.kr', username: 'u@example.com' })).toBe(true)
  })

  it('서버나 계정이 다르면 false', () => {
    expect(canReusePassword({ host: 'smtp.other.com', username: 'sender@example.com' }, stored)).toBe(false)
    expect(canReusePassword({ host: 'smtp.example.com', username: 'other@example.com' }, stored)).toBe(false)
  })

  it('직접 입력 → Gmail(같은 주소)은 서버가 달라 false', () => {
    const g = normalizeMailSettingsInput({ preset: 'gmail', address: 'sender@example.com' })
    expect(g.ok).toBe(true)
    if (g.ok) expect(canReusePassword(g.value, stored)).toBe(false)
  })

  it('Gmail → 직접 입력(다른 서버)은 false, 같은 서버·같은 계정이면 true', () => {
    const gmailRow = { host: GMAIL_HOST, username: 'sender@gmail.com' }
    expect(canReusePassword({ host: 'smtp.example.com', username: 'sender@gmail.com' }, gmailRow)).toBe(false)
    expect(canReusePassword({ host: 'smtp.gmail.com', username: 'sender@gmail.com' }, gmailRow)).toBe(true)
  })

  it('어느 한쪽이 비면 false — 빈 값끼리 같다고 보지 않는다', () => {
    expect(canReusePassword({ host: '', username: '' }, { host: '', username: '' })).toBe(false)
    expect(canReusePassword({ host: 'smtp.example.com', username: ' ' }, { host: 'smtp.example.com', username: '' })).toBe(false)
  })
})

describe('reasonKey — 사유 코드 → 공용 사전 문구', () => {
  const CODES: MailSettingsReason[] = [
    'preset_invalid', 'address_invalid', 'host_invalid', 'port_invalid',
    'tls_mismatch', 'username_required', 'from_invalid', 'password_required',
  ]

  it.each(CODES)('%s → mailSettings.reason.<code>, 공용 사전(ko.ts)에 한국어 문구가 있다', (c) => {
    const key = reasonKey(c)
    expect(key).toBe(`mailSettings.reason.${c}`)
    expect((KO as Record<string, string>)[key]).toMatch(/[가-힣]/)
  })

  it('사전의 mailSettings.reason.* 는 사유 코드 여덟 개와 정확히 같다(남는 키·빠진 키 없음)', () => {
    const keys = Object.keys(KO).filter(k => k.startsWith('mailSettings.reason.')).sort()
    expect(keys).toEqual(CODES.map(c => `mailSettings.reason.${c}`).sort())
  })
})

describe('클라이언트 공용 — settingsInput 은 server-only 모듈을 값으로 끌어오지 않는다', () => {
  const ROOT = process.cwd()
  /** 값 import 의 대상 경로('@/…'·상대) — import type 은 번들에 남지 않으므로 뺀다 */
  const valueImports = (src: string): string[] => src.split('\n')
    .filter(l => /^\s*import\b/.test(l) && !/^\s*import type\b/.test(l))
    .map(l => /from\s+'([^']+)'|^\s*import\s+'([^']+)'/.exec(l))
    .flatMap(m => (m ? [m[1] ?? m[2]] : []))
  const resolve = (spec: string, from: string): string | null => {
    const base = spec.startsWith('@/') ? join(ROOT, 'src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null
    if (!base) return null
    return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(existsSync) ?? null
  }

  it('자기 자신과 값으로 닿는 모든 모듈에 server-only·transport·nodemailer 가 없다', () => {
    const seen = new Set<string>()
    const bad: string[] = []
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const spec of valueImports(readFileSync(file, 'utf8'))) {
        if (spec === 'server-only' || spec === 'nodemailer' || /mail\/transport$/.test(spec)) bad.push(`${relative(ROOT, file)} → ${spec}`)
        const next = resolve(spec, file)
        if (next) visit(next)
      }
    }
    visit(join(ROOT, 'src/lib/mail/settingsInput.ts'))
    expect(bad, bad.join('\n')).toEqual([])
    // 실제로 따라갔는지 — 쓰는 두 순수 모듈이 목록에 있다
    expect([...seen].map(f => relative(ROOT, f))).toEqual(expect.arrayContaining([
      'src/lib/mail/settingsInput.ts', 'src/lib/domain/hostname.ts', 'src/lib/mail/recipients.ts',
    ]))
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run tests/mail/settings-input.test.ts`
Expected: FAIL — `Error: Cannot find package '@/lib/mail/settingsInput' imported from …/tests/mail/settings-input.test.ts` (Test Files 1 failed).

- [ ] **Step 3: 공용 사전에 사유 문구 8개를 더한다**

`src/lib/i18n/dict/settingsUi.ts` 끝(`} as const` 바로 앞)에 블록을 더한다. Task 7 의 편집기 문구(`mailSettings.*`)는 이 블록 **아래**에 이어 붙인다.

old:
```ts
  // components/settings/IntegrationCredentialsManager.tsx
  'settings.cred.projectCount': '{n}개 프로젝트 ({v}{v2})',
} as const
```

new:
```ts
  // components/settings/IntegrationCredentialsManager.tsx
  'settings.cred.projectCount': '{n}개 프로젝트 ({v}{v2})',
  // lib/mail/settingsInput.ts — 발송 메일 설정 입력의 거부 사유(reasonKey). 폼(MailSettingsEditor)과 서버 액션(mailSettings.ts)이 같은 키를 쓴다
  'mailSettings.reason.preset_invalid': '발송 방식을 고르세요(Gmail 또는 직접 입력).',
  'mailSettings.reason.address_invalid': 'Gmail 주소가 이메일 형식이 아닙니다.',
  'mailSettings.reason.host_invalid': '서버 주소는 도메인 이름으로 입력하세요 — IP 주소·localhost 는 쓸 수 없습니다.',
  'mailSettings.reason.port_invalid': '포트는 25·465·587·2525 중 하나입니다.',
  'mailSettings.reason.tls_mismatch': '포트와 보안 연결이 맞지 않습니다 — 465 는 SSL, 587·25 는 STARTTLS 입니다.',
  'mailSettings.reason.username_required': '계정을 입력하세요.',
  'mailSettings.reason.from_invalid': '보내는 주소가 이메일 형식이 아닙니다 — 계정이 이메일 주소가 아니면 보내는 주소를 입력하세요.',
  'mailSettings.reason.password_required': '비밀번호를 입력하세요 — 서버 주소나 계정을 바꾸면 비밀번호도 다시 넣어야 합니다.',
} as const
```

같은 키가 다른 사전에 없는지 확인한다(`KO` 는 펼침이라 겹치면 조용히 덮인다):
Run: `grep -rn "mailSettings\.reason\." src/lib/i18n/dict/`
Expected: `src/lib/i18n/dict/settingsUi.ts` 의 8줄뿐.

- [ ] **Step 4: 정규화 모듈을 만든다**

`src/lib/mail/settingsInput.ts` 를 새로 만든다(`'server-only'` 금지 — 클라이언트 번들에도 실린다):

```ts
// 워크스페이스 발송 메일 설정의 입력 정규화 — 순수. 설정 화면(MailSettingsEditor, 클라이언트)과 서버 액션(actions/mailSettings.ts)이
// 같은 규칙 한 벌을 쓴다(설계 2026-10-15 §3). 클라이언트 번들에도 실리므로 'server-only' 를 두지 않고,
// transport.ts(server-only·nodemailer)를 값으로 가져오지 않는다 — 가져오는 것은 순수 모듈(domain/hostname·mail/recipients)뿐이다.
// 여기를 통과한 값은 저장 행의 DB 제약(0059 workspace_mail_settings 의 login·from·tls·gmail·host)과 발송 판정(resolveSmtpSettings)을
// 함께 통과한다 — 저장한 행이 발송 때 'invalid' 로 읽히지 않게 한다. 비밀번호 필요 판정은 저장값이 있어야 하므로 호출자 몫이다(canReusePassword).
import type { DictKey } from '@/lib/i18n/dict'
import { toAsciiHostname } from '@/lib/domain/hostname'
import { isValidEmail } from '@/lib/mail/recipients'

export type MailPreset = 'gmail' | 'custom'
/** SMTP 표준 포트 넷 — 임의 포트로 내부망을 두드리는 탐침을 막는다(DB check 와 같은 목록) */
export const MAIL_PORTS = [25, 465, 587, 2525] as const
/** Gmail 프리셋의 고정 서버(465·SSL) — DB 제약 workspace_mail_settings_gmail 과 같은 값 */
export const GMAIL_HOST = 'smtp.gmail.com'

export type MailSettingsReason =
  | 'preset_invalid' | 'address_invalid' | 'host_invalid' | 'port_invalid'
  | 'tls_mismatch' | 'username_required' | 'from_invalid' | 'password_required'

export interface MailSettingsInput {
  preset: MailPreset
  address?: string; password?: string            // gmail
  host?: string; port?: number | string; secure?: boolean; username?: string; fromAddress?: string // custom (+password)
}

/** 저장할 꼴. password null = 입력 빈칸(저장값 재사용 후보) */
export interface NormalizedMailSettings {
  preset: MailPreset; host: string; port: number; secure: boolean
  username: string; password: string | null; from_address: string | null
}

type NormalizeResult = { ok: true; value: NormalizedMailSettings } | { ok: false; code: MailSettingsReason }

const fail = (code: MailSettingsReason): NormalizeResult => ({ ok: false, code })
/** 문자열이 아니면 빈 문자열 — 폼 밖에서 온 값(숫자·객체)을 그대로 쓰지 않는다 */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 서버 주소 → 저장 꼴(소문자·끝 점 하나 제거·퓨니코드 — 설계 §2.4). IP 리터럴·단일 레이블(localhost)·IPv6·
 *  URL 구분자(: / ? #)가 섞인 값은 null. 단일 레이블은 toAsciiHostname 도 거르지만 규칙을 여기서 한 번 더 드러낸다 */
function normalizeHost(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/\.$/, '')
  if (!v || !v.includes('.')) return null
  return toAsciiHostname(v)
}

/** 숫자 또는 숫자만인 문자열 → 표준 포트 넷 중 하나. 아니면 null */
function normalizePort(raw: unknown): number | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  const n = typeof raw === 'number' ? raw : /^\d{1,5}$/.test(s) ? Number(s) : NaN
  return (MAIL_PORTS as readonly number[]).includes(n) ? n : null
}

/**
 * 폼·액션 입력 → 저장할 꼴. 검사 순서: 방식 → (Gmail) 주소 / (직접 입력) 서버 주소 → 포트 → 포트-보안 짝 → 계정 → 보내는 주소.
 * - Gmail: address·password 만 읽는다. host=smtp.gmail.com·port=465·secure=true·username=주소(trim·소문자)·from_address=null(→ 계정).
 *   비밀번호의 공백은 모두 지운다(구글이 앱 비밀번호를 4자씩 띄워 보여준다). 주소 도메인은 묻지 않는다(Google Workspace 도메인도 같은 서버다).
 * - 직접 입력: secure 가 불리언이 아니면 포트로 정한다(465 → SSL, 나머지 → STARTTLS). 465+평문·587/25+SSL 은 tls_mismatch.
 *   계정은 trim 만 한다(대소문자를 가리는 서버가 있다). 보내는 주소를 비우면 계정이 이메일 형식이어야 한다 — 아니면 발송 판정이 invalid 로 읽는다.
 *   비밀번호는 trim(발송 판정이 trim 해서 읽는다 — 앞뒤 공백은 어차피 쓰이지 않는다).
 * - 비밀번호가 비면 null — 저장값 재사용 후보다. 재사용 가부(password_required)는 canReusePassword 로 호출자가 정한다.
 */
export function normalizeMailSettingsInput(input: unknown): NormalizeResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('preset_invalid')
  const o = input as Record<string, unknown>

  if (o.preset === 'gmail') {
    const address = str(o.address).trim().toLowerCase()
    if (!isValidEmail(address)) return fail('address_invalid')
    const password = str(o.password).replace(/\s+/g, '')
    return {
      ok: true,
      value: { preset: 'gmail', host: GMAIL_HOST, port: 465, secure: true, username: address, password: password || null, from_address: null },
    }
  }
  if (o.preset !== 'custom') return fail('preset_invalid')

  const host = normalizeHost(str(o.host))
  if (!host) return fail('host_invalid')
  const port = normalizePort(o.port)
  if (port === null) return fail('port_invalid')
  const secure = typeof o.secure === 'boolean' ? o.secure : port === 465
  if ((port === 465 && !secure) || ((port === 587 || port === 25) && secure)) return fail('tls_mismatch')
  const username = str(o.username).trim()
  if (!username) return fail('username_required')
  const from = str(o.fromAddress).trim()
  if (from ? !isValidEmail(from) : !isValidEmail(username)) return fail('from_invalid')
  const password = str(o.password).trim()
  return {
    ok: true,
    value: { preset: 'custom', host, port, secure, username, password: password || null, from_address: from || null },
  }
}

/** 비교 키 — 저장값(이미 정규형)과 새 값(정규화 전일 수도 있다)을 같은 꼴로. 형태가 아닌 호스트는 trim·소문자·끝 점만 */
const hostKey = (h: string): string => {
  const v = h.trim().toLowerCase().replace(/\.$/, '')
  return toAsciiHostname(v) ?? v
}
const userKey = (u: string): string => u.trim().toLowerCase()

/** 빈 비밀번호일 때 저장값을 재사용해도 되는가 — host 동일(정규화 후) && username 동일(trim·소문자).
 *  저장 행이 없거나 어느 한쪽이 비면 false. Gmail 은 host·username 이 고정이라 이 한 규칙이 Gmail↔직접 입력 사이의 재사용도 막는다
 *  (다른 서버·다른 계정에 남의 비밀번호를 보내지 않는다). 저장과 테스트 발송이 같은 규칙을 쓴다(설계 §3) */
export function canReusePassword(
  next: { host: string; username: string },
  stored: { host: string; username: string } | null,
): boolean {
  if (!stored) return false
  const h = hostKey(next.host), u = userKey(next.username)
  if (!h || !u) return false
  return h === hostKey(stored.host) && u === userKey(stored.username)
}

/** 사유 코드 → 공용 사전 키(settingsUi.ts — 폼과 서버가 같은 문구). 표가 Record 라 코드를 더하면 여기서 타입이 깨진다 */
const REASON_KEY = {
  preset_invalid: 'mailSettings.reason.preset_invalid',
  address_invalid: 'mailSettings.reason.address_invalid',
  host_invalid: 'mailSettings.reason.host_invalid',
  port_invalid: 'mailSettings.reason.port_invalid',
  tls_mismatch: 'mailSettings.reason.tls_mismatch',
  username_required: 'mailSettings.reason.username_required',
  from_invalid: 'mailSettings.reason.from_invalid',
  password_required: 'mailSettings.reason.password_required',
} as const satisfies Record<MailSettingsReason, DictKey>

/** 사유 코드 → 공용 사전 키 'mailSettings.reason.<code>' */
export function reasonKey(code: MailSettingsReason): DictKey {
  return REASON_KEY[code]
}
```

`REASON_KEY` 는 `as const satisfies Record<MailSettingsReason, DictKey>` 라 Step 3 의 키가 빠지거나 사유 코드가 늘면 타입 검사가 깨진다(캐스트 없음).

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/mail/settings-input.test.ts`
Expected: PASS — Test Files 1 passed, Tests 105 passed.

- [ ] **Step 6: 불변식·타입·린트를 확인한다**

Run: `npx vitest run tests/invariants/i18n-server-messages.test.ts tests/invariants/i18n-no-korean-literals.test.ts tests/mail/`
Expected: PASS.
- `i18n-server-messages`: 새 키는 공용 사전(`KO`)에만 있고 `SERVER_KO` 와 겹치지 않는다. 이 모듈은 서버 사전을 import 하지 않는다.
- `i18n-no-korean-literals`: 검사 대상은 `src/components`·`src/app` 의 `.tsx` 뿐이라 이 `.ts` 는 대상 밖이다. 그래도 모듈에 한국어 문구 리터럴을 두지 않았다(주석만).
- `tests/mail/*`(transport·recipients 등): `recipients.ts`·`transport.ts` 를 바꾸지 않았으므로 그대로 초록.

Run: `npm run typecheck`
Expected: 오류 0 — 특히 `satisfies Record<MailSettingsReason, DictKey>` 가 Step 3 의 키로 통과한다.

Run: `npx eslint src/lib/mail/settingsInput.ts tests/mail/settings-input.test.ts src/lib/i18n/dict/settingsUi.ts`
Expected: 출력 없음.

이 작업이 건드리지 않는 불변식(확인만): `tests/gates/manifest.ts`(액션·라우트 없음), `tests/invariants/admin-scope.test.ts`·`docs/sp2-admin-client-audit.md`(service_role 없음),
`tests/settings/operational-env.test.ts`(`process.env` 를 읽지 않는다), `tests/invariants/domain-layering.test.ts`(`src/lib/domain` 을 바꾸지 않는다).

- [ ] **Step 7: 커밋한다**

```bash
git add src/lib/mail/settingsInput.ts src/lib/i18n/dict/settingsUi.ts tests/mail/settings-input.test.ts
git commit -m "$(cat <<'EOF'
발송 메일 설정 입력 정규화 — 폼과 서버 액션이 한 규칙으로 거르게

워크스페이스 관리자가 화면에서 넣는 Gmail·직접 입력 값을 저장 꼴로 바꾸는 순수 모듈을 둔다.
화면(클라이언트)과 액션(서버)이 따로 검사하면 한쪽만 느슨해지므로 한 벌을 같이 쓴다.
서버 주소는 초대·허용 도메인과 같은 toAsciiHostname 규칙으로 정규화해 IP·localhost·단일 레이블을 막고(내부망 탐침 차단),
포트는 SMTP 표준 넷·포트-보안 짝만 받는다. 통과한 값은 발송 판정(resolveSmtpSettings)과 0059 의 DB 제약을 함께 통과한다 —
저장한 설정이 발송 때 '올바르지 않음'으로 읽히지 않게.
빈 비밀번호의 저장값 재사용은 서버·계정이 같을 때만 허용한다(canReusePassword) — 다른 서버로 저장된 비밀번호가 새지 않게.
사유 문구는 공용 사전(settingsUi)에 두어 폼과 서버가 같은 글자를 낸다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

끝으로 다시 돌릴 기존 테스트: `npx vitest run tests/mail/ tests/invariants/i18n-server-messages.test.ts tests/invariants/i18n-no-korean-literals.test.ts`.

---

### Task 3: 워크스페이스 메일 행 모듈 — `src/lib/mail/workspaceSmtp.ts`

행 형(`WorkspaceMailRow`)·select 열(`WORKSPACE_MAIL_COLUMNS`)·env 꼴 매핑(`rowToSmtpEnv`)·조회(`loadWorkspaceMailRow`, `workspaces!inner(archived_at)` 임베드로 보관 판정)·발송 직전 서버 주소 검사(`vetMailHost`·`isForbiddenAddress`)를 한 파일에 둔다(설계 §2.1·§2.4, 계약 "src/lib/mail/workspaceSmtp.ts").
판정 함수(`MailStatus`·`resolveMailStatus`·발송 설정 고르기)는 **이 작업이 아니다** — 계약대로 Task 4 의 `transport.ts` 에 둔다. 이 파일은 `transport.ts` 를 import 하지 않는다(순환 방지). 설계 §6 이 이 테스트 파일에 적은 "판정 규칙·`resolveMailStatus` 다섯 갈래·env 경로 검사 면제" 사례는 Task 4 가 `tests/mail/transport.test.ts` 쪽에 쓴다.

선행: Task 2(`src/lib/mail/settingsInput.ts` 의 `MailPreset`) — 여기서는 `import type` 으로만 쓴다(런타임 의존 없음. vitest 는 Task 2 없이도 돌지만 `npm run typecheck` 는 Task 2 가 있어야 초록).

**Files:**
- Create: `src/lib/mail/workspaceSmtp.ts`
- Test: `tests/mail/workspace-smtp.test.ts` (Create)
- 사전: 없음 — 이 파일은 사용자 문구를 내지 않는다(던지는 오류·`console.error` 는 개발자용이고, 사용자 문구 `MAIL_SETTINGS_UNAVAILABLE`·`MAIL_HOST_NOT_ALLOWED` 는 Task 4 가 `transport.ts`/`serverUi.ts` 에서 만든다).

지킬 불변식(이 작업이 깰 수 있는 것):
- `tests/invariants/admin-scope.test.ts` — `createAdminClient` 를 **언급만 해도**(주석 포함, `/\bcreateAdminClient\b/` 로 파일 원문을 본다) 감사표 행이 필요해진다. 이 파일은 그 이름을 쓰지 않는다: 클라이언트는 매개변수 `admin: Pick<AdminClient, 'from'>`(`import type { AdminClient } from '@/lib/supabase/adminFor'`)로만 받는다. 주석에도 그 함수 이름을 적지 않는다.
- `tests/invariants/i18n-no-korean-literals.test.ts`·`i18n-server-messages.test.ts` — 대상이 `src/components`·`src/app` 의 `.tsx` 와 `src/app/actions/**` 뿐이라 `src/lib/mail/*.ts` 의 `throw`·`console.error` 한국어는 걸리지 않는다. 사용자에게 가는 문구를 이 파일에 만들지 않는 것으로 그 경계를 지킨다.
- `tests/invariants/settings-writes.test.ts` — 설정 4표 이름(`workspace_settings` 등)을 원문에서 찾는다. `workspace_mail_settings` 는 `workspace_settings` 를 부분 문자열로 품지 않으므로 걸리지 않는다(이 파일에 설정 4표 이름을 쓰지 않는다).
- 비밀번호: 반환 오류 메시지·로그에 `password` 를 싣지 않는다(설계 §3 마지막 줄) — 테스트가 throw 메시지에 비밀번호가 없음을 단언한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/mail/workspace-smtp.test.ts` 를 만든다. DNS 는 `vi.mock('node:dns')` 로 막는다(구현이 `import { promises as dns } from 'node:dns'` 이고 호출 시점에 `dns.lookup` 을 읽으므로 목이 먹는다). 가짜 service_role 클라이언트는 `tests/workspace/resolve.test.ts` 의 `db()` 와 같은 꼴(`from().select().eq().maybeSingle()`)이다. `rowToSmtpEnv` 의 결과는 실제 `resolveSmtpSettings`(`src/lib/mail/transport.ts`, 테스트에서만 import)로 통과·실패를 확인한다.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// DNS 는 목으로 — 실제 해석을 하지 않는다(테스트가 네트워크·리졸버에 기대지 않게)
const h = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns', () => ({ promises: { lookup: h.lookup }, default: { promises: { lookup: h.lookup } } }))

import {
  WORKSPACE_MAIL_COLUMNS, isForbiddenAddress, loadWorkspaceMailRow, rowToSmtpEnv, vetMailHost,
  type WorkspaceMailRow,
} from '@/lib/mail/workspaceSmtp'
import { resolveSmtpSettings } from '@/lib/mail/transport'

const WID = '00000000-0000-0000-7e57-00000000aa01'

const GMAIL: WorkspaceMailRow = {
  workspace_id: WID, preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true,
  username: 'sender@gmail.com', password: 'abcdabcdabcdabcd', from_address: null,
  password_set_by: '00000000-0000-0000-7e57-0000000000a1', password_set_at: '2026-10-15T00:00:00Z',
  updated_by: '00000000-0000-0000-7e57-0000000000a1', updated_at: '2026-10-15T00:00:00Z',
}
const CUSTOM: WorkspaceMailRow = {
  ...GMAIL, preset: 'custom', host: 'mail.acme.test', port: 587, secure: false,
  username: 'relay-user', password: 'pw', from_address: 'noreply@acme.test',
}

type Result = { data: unknown; error: { message: string } | null }
/** from().select().eq().maybeSingle() 만 있는 가짜 service_role 클라이언트 — 부른 인자를 calls 에 남긴다 */
function fakeAdmin(result: Result) {
  const calls: unknown[][] = []
  const admin = {
    from: (t: string) => ({
      select: (c: string) => ({
        eq: (k: string, v: string) => {
          calls.push([t, c, k, v])
          return { maybeSingle: async () => result }
        },
      }),
    }),
  }
  return { admin: admin as unknown as Parameters<typeof loadWorkspaceMailRow>[0], calls }
}

describe('rowToSmtpEnv — 행을 env 꼴로(검증은 resolveSmtpSettings 한 벌)', () => {
  it('Gmail 행: 465·SSL·계정 로그인, 보내는 주소는 비워 계정을 쓴다', () => {
    expect(rowToSmtpEnv(GMAIL)).toEqual({
      SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_AUTH: '',
      SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'abcdabcdabcdabcd', SMTP_FROM_ADDRESS: '',
    })
    const r = resolveSmtpSettings(rowToSmtpEnv(GMAIL))
    expect(r).toEqual({ ok: true, settings: {
      host: 'smtp.gmail.com', port: 465, secure: true, requireTLS: false,
      auth: { user: 'sender@gmail.com', pass: 'abcdabcdabcdabcd' }, fromAddress: 'sender@gmail.com',
    } })
  })

  it('직접 입력 행: 587 STARTTLS·보내는 주소 그대로 — 계정이 이메일이 아니어도 보내는 주소가 있으면 통과', () => {
    expect(rowToSmtpEnv(CUSTOM)).toEqual({
      SMTP_HOST: 'mail.acme.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_AUTH: '',
      SMTP_USER: 'relay-user', SMTP_PASS: 'pw', SMTP_FROM_ADDRESS: 'noreply@acme.test',
    })
    const r = resolveSmtpSettings(rowToSmtpEnv(CUSTOM))
    expect(r.ok && r.settings).toMatchObject({ port: 587, secure: false, requireTLS: true, fromAddress: 'noreply@acme.test' })
  })

  it('SMTP_AUTH 는 언제나 빈 값 — 워크스페이스 행에는 무인증 릴레이가 없다', () => {
    expect(rowToSmtpEnv(CUSTOM).SMTP_AUTH).toBe('')
  })

  it('공백뿐인 계정·비밀번호 행(손상)은 ok 가 아니다 — 판정이 workspace·invalid 로 읽을 근거', () => {
    expect(resolveSmtpSettings(rowToSmtpEnv({ ...CUSTOM, username: '  ', password: '  ' })).ok).toBe(false)
    expect(resolveSmtpSettings(rowToSmtpEnv({ ...CUSTOM, password: '   ' })).ok).toBe(false)
  })

  it('결과에 행 밖의 키(MAIL_FROM_NAME 등)를 싣지 않는다', () => {
    expect(Object.keys(rowToSmtpEnv(GMAIL)).sort()).toEqual(
      ['SMTP_AUTH', 'SMTP_FROM_ADDRESS', 'SMTP_HOST', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER'])
  })
})

describe('WORKSPACE_MAIL_COLUMNS', () => {
  it('행 형의 필드 전부 — 비밀번호 설정자·시각과 갱신자·시각 포함', () => {
    expect(WORKSPACE_MAIL_COLUMNS.split(', ').sort()).toEqual(Object.keys(GMAIL).sort())
  })
})

describe('loadWorkspaceMailRow — 행 · 없음 · 보관 · 판독 불가', () => {
  it('그 워크스페이스 한 행을 보관 시각 임베드와 함께 읽고, 임베드는 행 밖으로 내지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ data: { ...GMAIL, workspaces: { archived_at: null } }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'row', row: GMAIL })
    expect(calls).toEqual([[
      'workspace_mail_settings', `${WORKSPACE_MAIL_COLUMNS}, workspaces!inner(archived_at)`, 'workspace_id', WID,
    ]])
  })

  it('임베드가 배열로 와도 첫 원소로 본다', async () => {
    const { admin } = fakeAdmin({ data: { ...CUSTOM, workspaces: [{ archived_at: null }] }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'row', row: CUSTOM })
  })

  it('행이 없으면 none', async () => {
    const { admin } = fakeAdmin({ data: null, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'none' })
  })

  it('보관된 워크스페이스의 행은 archived — 행을 돌려주지 않는다', async () => {
    const { admin } = fakeAdmin({ data: { ...GMAIL, workspaces: { archived_at: '2026-10-01T00:00:00Z' } }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'archived' })
  })

  it('조회 오류는 throw — 미설정(none)으로 위장하지 않는다', async () => {
    const { admin } = fakeAdmin({ data: null, error: { message: 'db down' } })
    await expect(loadWorkspaceMailRow(admin, WID)).rejects.toThrow('db down')
  })

  it.each([
    ['임베드 키 없음', {}],
    ['임베드 null', { workspaces: null }],
    ['빈 배열', { workspaces: [] }],
    ['archived_at 키 없음', { workspaces: {} }],
    ['archived_at 형이 다름', { workspaces: { archived_at: 0 } }],
    ['임베드가 문자열', { workspaces: 'x' }],
  ])('보관 여부를 못 읽으면(%s) throw — 모르면 닫는다', async (_name, embed) => {
    const { admin } = fakeAdmin({ data: { ...GMAIL, ...embed }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).rejects.toThrow()
  })

  it('던지는 오류에 비밀번호가 실리지 않는다', async () => {
    const { admin } = fakeAdmin({ data: { ...GMAIL, workspaces: {} }, error: null })
    const err = await loadWorkspaceMailRow(admin, WID).catch((e: unknown) => e)
    expect(String((err as Error).message)).not.toContain(GMAIL.password)
  })
})

describe('isForbiddenAddress — 사설·예약 대역(순수)', () => {
  it.each([
    '0.0.0.0', '0.1.2.3', '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'ff02::1',
    '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a00:1', '::ffff:7f00:1',
    '::10.0.0.1', '0:0:0:0:0:ffff:192.168.1.1',
  ])('%s 는 거부', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8', '1.1.1.1', '74.125.140.108', '172.15.255.255', '172.32.0.1', '192.167.255.255', '192.169.0.1',
    '100.63.255.255', '100.128.0.1', '169.253.255.255', '11.0.0.1', '126.255.255.255', '128.0.0.1', '223.255.255.255',
    '2001:4860:4860::8888', '2a00:1450:400c:c06::6c', 'fbff::1', '::ffff:8.8.8.8', '::ffff:808:808',
  ])('%s 는 통과(공인)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false)
  })

  it.each(['', 'smtp.gmail.com', '1.2.3', '256.0.0.1', '::ffff:999.0.0.1', 'gggg::1', '1:2:3:4:5:6:7:8:9'])(
    '형태가 아닌 값(%j)은 거부 — fail-closed', (ip) => {
      expect(isForbiddenAddress(ip)).toBe(true)
    })
})

describe('vetMailHost — 발송 직전 DNS 검사', () => {
  beforeEach(() => { h.lookup.mockReset() })

  it('공인 주소로만 풀리면 통과하고 첫 주소를 연결 대상으로 돌려준다 — all·verbatim 으로 묻는다', async () => {
    h.lookup.mockResolvedValue([{ address: '142.250.4.108', family: 4 }, { address: '2404:6800:4008:c00::6c', family: 6 }])
    await expect(vetMailHost('smtp.gmail.com')).resolves.toEqual({ ok: true, address: '142.250.4.108' })
    expect(h.lookup).toHaveBeenCalledWith('smtp.gmail.com', { all: true, verbatim: true })
  })

  it('IPv6 가 먼저 와도 IPv4 를 연결 대상으로 고른다(Vercel 함수는 IPv6 로 나가지 못하는 경우가 많고, 고정 IP 접속은 nodemailer 의 대체 시도를 건너뛴다)', async () => {
    h.lookup.mockResolvedValue([{ address: '2404:6800:4008:c00::6c', family: 6 }, { address: '142.250.4.108', family: 4 }])
    await expect(vetMailHost('smtp.gmail.com')).resolves.toEqual({ ok: true, address: '142.250.4.108' })
  })

  it('하나라도 사설 대역이면 거부(공인 주소가 섞여 있어도)', async () => {
    h.lookup.mockResolvedValue([{ address: '142.250.4.108', family: 4 }, { address: '10.0.0.5', family: 4 }])
    await expect(vetMailHost('mixed.acme.test')).resolves.toEqual({ ok: false })
  })

  it.each([
    ['루프백', [{ address: '127.0.0.1', family: 4 }]],
    ['메타데이터(링크 로컬)', [{ address: '169.254.169.254', family: 4 }]],
    ['IPv6 루프백', [{ address: '::1', family: 6 }]],
    ['매핑된 사설 IPv4', [{ address: '::ffff:192.168.0.10', family: 6 }]],
  ])('%s 로 풀리면 거부', async (_name, found) => {
    h.lookup.mockResolvedValue(found)
    await expect(vetMailHost('internal.acme.test')).resolves.toEqual({ ok: false })
  })

  it('결과가 비면 거부', async () => {
    h.lookup.mockResolvedValue([])
    await expect(vetMailHost('empty.acme.test')).resolves.toEqual({ ok: false })
  })

  it('해석 오류는 거부 — 결과에 원문을 싣지 않고 로그엔 코드만', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND nope.acme.test'), { code: 'ENOTFOUND' }))
    const r = await vetMailHost('nope.acme.test')
    expect(r).toEqual({ ok: false })
    expect(err).toHaveBeenCalledWith(expect.any(String), 'ENOTFOUND')
    err.mockRestore()
  })

  it('빈 호스트는 해석하지 않고 거부', async () => {
    await expect(vetMailHost('')).resolves.toEqual({ ok: false })
    expect(h.lookup).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run tests/mail/workspace-smtp.test.ts`
Expected: FAIL — `Test Files 1 failed (1)`, 스위트 오류가 `@/lib/mail/workspaceSmtp` 를 찾지 못한다고 말한다(모듈이 아직 없다 — "Failed to resolve import"/"Cannot find module" 꼴)

- [ ] **Step 3: 구현한다**

`src/lib/mail/workspaceSmtp.ts` 를 만든다(전문).

구현 메모:
- `loadWorkspaceMailRow` 의 보관 판정은 `src/app/actions/inviteRedeem.ts` `loadInvite` 와 같은 읽기(`data.workspaces` 가 배열이면 첫 원소)지만, 계약대로 **판독 불가는 throw** 다(`loadInvite` 는 "없음" 문구로 닫는다 — 여기는 호출자 Task 4 가 throw 를 잡아 `MAIL_SETTINGS_UNAVAILABLE` 로 바꾼다). `archived_at` 이 문자열이면 `archived`, `null` 이면 행, 그 밖(키 없음·숫자 등)은 throw.
- 돌려주는 행은 `WORKSPACE_MAIL_COLUMNS` 의 키만 옮긴다 — `workspaces` 임베드가 행 밖으로 새지 않는다(테스트가 `toEqual(GMAIL)` 로 고정).
- `rowToSmtpEnv` 는 검증하지 않는다 — trim·포트-보안 짝·발신 주소 판정은 `resolveSmtpSettings` 한 벌이 env 와 같은 규칙으로 한다. `SMTP_AUTH` 는 늘 `''`(계정 로그인만), `from_address` 가 null 이면 `SMTP_FROM_ADDRESS: ''`(→ 계정이 발신 주소).
- `isForbiddenAddress` 는 계약 목록(0.0.0.0/8·127/8·10/8·172.16/12·192.168/16·169.254/16·100.64/10·`::`·`::1`·fc00::/7·fe80::/10·::ffff: 매핑 사설 IPv4)에 더해, 같은 fail-closed 방향으로 224/4·240/4(멀티캐스트·예약)·ff00::/8·IPv4 호환 꼴(`::a.b.c.d`)을 거부하고, 형태를 모르는 값은 거부한다. `node:net` 의 `BlockList` 는 매핑 주소 처리가 버전마다 달라 쓰지 않고 직접 푼다.
- `vetMailHost` 는 `dns.lookup(host, { all: true, verbatim: true })`(설계 §2.4 그대로 — `@types/node` 의 `LookupOptions.verbatim` 이 있다). 해석 오류는 로그에 `code` 만 남기고 결과에는 싣지 않는다. 모든 결과가 금지 검사를 통과한 뒤에 연결 대상을 고른다 — IPv4 가 있으면 그것(`found.find((a) => a.family === 4) ?? found[0]`), 없으면 첫 주소(Task 4 의 `connectTo`). verbatim 순서라 IPv6 가 먼저 올 수 있는데, Vercel 함수는 IPv6 로 나가지 못하는 경우가 많고 IP 를 고정해 접속하면 nodemailer 의 주소 대체 시도도 건너뛰기 때문이다.

```ts
import 'server-only'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import type { AdminClient } from '@/lib/supabase/adminFor'
import type { MailPreset } from './settingsInput'

// 워크스페이스 발송 메일 설정(0059 workspace_mail_settings)의 행 형·env 꼴 매핑·조회·발송 직전 서버 주소 검사.
// 판정(MailStatus·resolveMailStatus·발송 설정 고르기)은 transport.ts 에 있다 — 이 파일은 transport.ts 를 import 하지 않는다(순환 방지).
// 클라이언트는 호출자가 adminFor({ workspaceId }) 로 만들어 넘긴다 — 이 파일은 service_role 클라이언트를 직접 만들지 않는다
// (그래서 감사표 docs/sp2-admin-client-audit.md 에 행이 생기지 않는다 — tests/invariants/admin-scope.test.ts).

/** workspace_mail_settings 한 행(설계 §1.1). password 는 평문이다 — 응답·로그·오류 어디에도 싣지 않는다 */
export interface WorkspaceMailRow {
  workspace_id: string
  preset: MailPreset
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  from_address: string | null
  password_set_by: string | null
  password_set_at: string
  updated_by: string | null
  updated_at: string
}

/** select 열 목록 — WorkspaceMailRow 의 필드 전부(순서 같음) */
export const WORKSPACE_MAIL_COLUMNS =
  'workspace_id, preset, host, port, secure, username, password, from_address, password_set_by, password_set_at, updated_by, updated_at'

const ROW_KEYS = WORKSPACE_MAIL_COLUMNS.split(', ') as ReadonlyArray<keyof WorkspaceMailRow>

/**
 * 행 → env 꼴 레코드(순수). 검증은 하지 않는다 — 기존 resolveSmtpSettings 한 벌이 env 와 같은 규칙으로 본다.
 * SMTP_AUTH 는 비운다(계정 로그인만 — 워크스페이스 행에는 무인증 릴레이가 없다, 설계 §1.1). 보내는 주소가 없으면 빈 값 → 계정이 발신 주소.
 */
export function rowToSmtpEnv(
  row: Pick<WorkspaceMailRow, 'host' | 'port' | 'secure' | 'username' | 'password' | 'from_address'>,
): Record<string, string> {
  return {
    SMTP_HOST: row.host,
    SMTP_PORT: String(row.port),
    SMTP_SECURE: row.secure ? 'true' : 'false',
    SMTP_AUTH: '',
    SMTP_USER: row.username,
    SMTP_PASS: row.password,
    SMTP_FROM_ADDRESS: row.from_address ?? '',
  }
}

export type WorkspaceMailLoad = { kind: 'row'; row: WorkspaceMailRow } | { kind: 'none' } | { kind: 'archived' }

/**
 * 그 워크스페이스의 메일 설정 행 — 워크스페이스의 보관 시각(0056)을 workspaces!inner 임베드로 함께 읽는다.
 * 조회 실패는 throw(미설정으로 위장하지 않는다 — 3원칙 ①). 임베드를 못 읽으면(키 없음·null·archived_at 없음·형이 다름) throw —
 * 모르면 닫는다(inviteRedeem.ts loadInvite 와 같은 규칙). 행이 없는 보관 워크스페이스는 조인할 행이 없어 'none' 이다 —
 * 발송 호출자는 가드(buildActor, 0056)가 먼저 닫는다. 캐시하지 않는다(저장한 다음 발송부터 바로 쓰인다).
 */
export async function loadWorkspaceMailRow(admin: Pick<AdminClient, 'from'>, workspaceId: string): Promise<WorkspaceMailLoad> {
  const { data, error } = await admin
    .from('workspace_mail_settings')
    .select(`${WORKSPACE_MAIL_COLUMNS}, workspaces!inner(archived_at)`)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  // 오류 원문은 호출자(transport.ts)가 서버 로그에만 남긴다 — 사용자 문구는 MAIL_SETTINGS_UNAVAILABLE
  if (error) throw new Error(`메일 설정 조회 실패: ${error.message}`)
  if (!data) return { kind: 'none' }
  const rec = data as unknown as Record<string, unknown>
  const e = rec.workspaces
  const w = Array.isArray(e) ? e[0] : e
  if (!w || typeof w !== 'object' || !('archived_at' in w)) throw new Error('메일 설정 조회: 워크스페이스 보관 여부를 읽지 못했다')
  const archivedAt = (w as { archived_at: unknown }).archived_at
  if (typeof archivedAt === 'string') return { kind: 'archived' }
  if (archivedAt !== null) throw new Error('메일 설정 조회: 워크스페이스 보관 시각의 형이 다르다')
  // 임베드(workspaces)는 행 밖으로 내보내지 않는다 — 행 형의 필드만 옮긴다
  const row = Object.fromEntries(ROW_KEYS.map((k) => [k, rec[k]])) as unknown as WorkspaceMailRow
  return { kind: 'row', row }
}

// ── 발송 직전 서버 주소 검사(설계 §2.4) ──
// 관리자가 넣은 호스트로 서버가 직접 접속한다 — 내부망 탐침 통로가 되지 않게 사설·예약 대역으로 풀리는 이름을 거부한다.

/** 거부하는 IPv4 대역 [기준 주소, 접두 길이] — 이 망(0/8)·루프백·사설 셋·링크 로컬·CGNAT, 그리고 멀티캐스트·예약(224/4·240/4) */
const V4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['169.254.0.0', 16], ['100.64.0.0', 10], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function v4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const o = m.slice(1).map(Number)
  if (o.some((x) => x > 255)) return null
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
}

function v4Forbidden(n: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0
    return ((n & mask) >>> 0) === ((v4ToInt(base)! & mask) >>> 0)
  })
}

/** IPv6 → 16비트 묶음 8개. 영역 표시(%eth0)는 떼고, 끝의 점 표기 IPv4 는 묶음 둘로 바꾼다. 형태가 아니면 null */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const n = v4ToInt(tail)
    if (n === null) return null
    s = `${s.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - rest.length
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null
  const parts = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...rest]
  if (parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null
  return parts.map((p) => parseInt(p, 16))
}

/**
 * 연결하면 안 되는 주소인가(순수). 형태를 모르는 값은 거부한다(fail-closed).
 * IPv6: ::(미지정)·::1·fc00::/7(고유 로컬)·fe80::/10(링크 로컬)·ff00::/8(멀티캐스트), 그리고 IPv4 를 품은 꼴 —
 * ::ffff:a.b.c.d(매핑)·::a.b.c.d(호환, :: 와 ::1 도 여기 든다) — 은 품은 IPv4 를 위 대역으로 본다.
 */
export function isForbiddenAddress(ip: string): boolean {
  const kind = isIP(ip.split('%')[0])
  if (kind === 4) {
    const n = v4ToInt(ip)
    return n === null || v4Forbidden(n)
  }
  if (kind !== 6) return true
  const g = v6Groups(ip)
  if (!g) return true
  if (g.every((x) => x === 0)) return true                       // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true                    // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true                    // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true                    // ff00::/8
  const embedsV4 = g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)
  if (embedsV4) return v4Forbidden(((g[6] << 16) | g[7]) >>> 0)
  return false
}

/**
 * 발송 직전 DNS 검사 — 결과가 비었거나 하나라도 금지 대역이면 거부. 통과하면 연결할 IP(IPv4 우선, 없으면 첫 결과)를 돌려준다 —
 * verbatim 순서라 IPv6 가 먼저 올 수 있지만 Vercel 함수는 IPv6 로 나가지 못하는 경우가 많고, IP 고정 접속은 nodemailer 의 대체 시도를 건너뛴다.
 * 호출자가 그 IP 로 접속해(재해석·DNS 리바인딩 차단) 인증서는 원래 이름으로 검사한다(transport.ts connectTo).
 * 해석 오류 원문은 결과에 싣지 않는다(서버 로그에 오류 코드만). 로컬 개발 예외는 두지 않는다 — 로컬 시험은 env(inbucket)로 한다.
 */
export async function vetMailHost(host: string): Promise<{ ok: true; address: string } | { ok: false }> {
  if (typeof host !== 'string' || !host) return { ok: false }
  let found: Array<{ address: string; family: number }>
  try {
    found = await dns.lookup(host, { all: true, verbatim: true })
  } catch (e) {
    console.error('[mail] 메일 서버 주소 해석 실패:', (e as { code?: unknown } | null)?.code ?? 'unknown')
    return { ok: false }
  }
  if (!Array.isArray(found) || found.length === 0) return { ok: false }
  if (found.some((a) => typeof a?.address !== 'string' || isForbiddenAddress(a.address))) return { ok: false }
  const pick = found.find((a) => a.family === 4) ?? found[0]
  return { ok: true, address: pick.address }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/mail/workspace-smtp.test.ts`
Expected: PASS — `Test Files 1 passed (1)`, `Tests 84 passed (84)`.

이어서 이 작업이 건드릴 수 있는 기존 검사를 다시 돌린다:

Run: `npx vitest run tests/mail/transport.test.ts tests/invariants/admin-scope.test.ts tests/invariants/settings-writes.test.ts tests/invariants/i18n-no-korean-literals.test.ts tests/invariants/i18n-server-messages.test.ts`
Expected: PASS(변경 전과 같은 개수). `admin-scope` 가 실패하면 `workspaceSmtp.ts` 원문 어딘가(주석 포함)에 `createAdminClient` 가 들어간 것이다 — 지운다(감사표에 행을 더하지 않는다, 설계 §2.1).

Run: `npm run typecheck`
Expected: 오류 0(Task 2 의 `settingsInput.ts` 가 있어야 `import type { MailPreset }` 이 풀린다).

Run: `npx eslint src/lib/mail/workspaceSmtp.ts tests/mail/workspace-smtp.test.ts`
Expected: 출력 없음.

- [ ] **Step 5: 커밋한다**

```bash
git add src/lib/mail/workspaceSmtp.ts tests/mail/workspace-smtp.test.ts
git commit -m "$(cat <<'MSG'
워크스페이스 메일 설정 행을 읽고 서버 주소를 검사하는 모듈 — 관리자가 넣은 계정으로 보내되 내부망으로는 붙지 않게

행을 env 꼴로 바꿔 기존 resolveSmtpSettings 한 벌로 검증하게 하고(SMTP_AUTH 는 비운다 — 계정 로그인만),
조회 실패·보관 임베드 판독 불가는 미설정으로 위장하지 않고 던진다. 발송 직전 DNS 결과가 사설·예약 대역이면
거부하고 통과한 IP 를 돌려줘 재해석 없이 그 주소로 붙게 한다. 판정(MailStatus)은 순환을 피해 transport.ts 에 둔다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

(마이그레이션 파일이 없으므로 G1·G4 와 무관하다. UI 위험 파일도 건드리지 않는다 — G2 무관.)

---

### Task 4: 발송 판정·트랜스포트(transport.ts)와 SMTP 오류 문구 한 곳(errors.ts)

설계 §2.1 판정 규칙 1–4, §2.2, §2.5. 판정(`MailStatus`·`resolveMailStatus`·설정 선택)은 계약대로 `transport.ts` 에 둔다 —
`workspaceSmtp.ts`(Task 3)는 transport.ts 를 import 하지 않으므로 순환이 없다. 이 작업은 Task 3 의 `loadWorkspaceMailRow`·`rowToSmtpEnv`·`vetMailHost`·`WorkspaceMailRow` 에 기댄다.

**Files:**
- Create: `src/lib/mail/errors.ts`
- Modify: `src/lib/mail/transport.ts`
- Modify: `src/lib/i18n/dict/serverUi.ts` (키 1개: `srv.mailSettings.testAuthFailed`)
- Create (test): `tests/mail/errors.test.ts`
- Modify (test): `tests/mail/transport.test.ts` (전체 교체 — 기존 env 사례는 모두 남기고 비동기로)

**이 작업이 정하는 것(뒤 작업이 따른다):**
- `MAIL_SETTINGS_UNAVAILABLE`·`MAIL_HOST_NOT_ALLOWED` 는 기존 `SMTP_NOT_CONFIGURED`·`SMTP_MISCONFIGURED` 와 같은 **lib 리터럴 상수**다(계약의 "기존 두 상수가 리터럴이면 같은 방식").
  설계 §4 는 이 둘을 `srv.mailSettings.*` 로 적었지만, `src/lib/**` 는 서버 사전을 값으로 가져올 수 없다 —
  `tests/invariants/i18n-server-messages.test.ts` 의 "서버 사전을 값으로 가져오는 곳은 서버 전용 모듈뿐이다(src 전체 — 닫힌 목록)"가
  importer 를 `server.ts`·`serverDict.ts` 둘로 고정하고, `src/lib/i18n/serverText.ts` 머리 주석도 "lib·가드의 문구는 한국어 그대로 싣는다"이다.
  액션(Task 6)은 `error: MAIL_SETTINGS_UNAVAILABLE` 처럼 **상수 식별자**로 돌려준다 — 같은 불변식이 "상수는 잡지 않는다".
  그래서 이 두 문구에는 사전 키를 만들지 않는다(같은 글자를 두 곳에 두지 않는다).
- `srv.mailSettings.testAuthFailed` 는 이 작업이 serverUi.ts 의 새 블록 `// src/app/actions/mailSettings.ts·src/lib/mail/errors.ts` 에 더한다.
  Task 6 은 자기 `srv.mailSettings.*` 키를 **이 블록 안에 이어 붙이고 이 키를 다시 적지 않는다**(객체 리터럴 중복 키는 `npm run typecheck` 의 TS1117).
- `smtpErrorMessage` 의 변환은 회의·초대 액션의 `toUserMessage`·`toMailMessage` 와 글자 하나 다르지 않다(코드 셋·문구 셋 그대로) — Task 5 가 두 함수를 지우고 이것으로 바꿔도 기존 회의·초대 테스트의 기대 문구가 그대로다.
- 호출처 `src/app/actions/meetingNotify.ts:105`·`src/app/actions/projectInvites.ts:369` 는 **이 작업에서 고치지 않는다(Task 5)**.
  그래서 이 커밋 뒤 `npm run typecheck` 는 그 두 자리(옛 동기 시그니처 `getTransport(fromName)`)에서만 실패한다 — Step 9 가 그 밖의 오류가 없음을 확인한다.
  두 액션의 vitest 는 `getTransport` 를 통째로 목하므로 초록이다. **Task 4 커밋과 Task 5 커밋 사이에 push 하지 않는다**(Actions 의 build 가 깨진다 — 어차피 push 는 Task 9).
- connectTo 로 접속할 때 nodemailer 의 `name` 은 **달지 않는다** — 설계 §2.2 의 "name" 문구와 일부러 다르다: `name` 은 클라이언트 자신의 EHLO 호스트명이라 서버 이름을 대면 많은 MTA 가 거절한다. 원래 호스트 이름은 `tls.servername`(SNI·인증서 검사)에만 싣는다.

**지키는 불변식:**
- `tests/invariants/admin-scope.test.ts` — `createAdminClient` 를 **언급만 해도**(주석 포함) 감사표 행이 필요하다. transport.ts·errors.ts 는 `adminFor` 만 쓰고 그 낱말을 주석에도 적지 않는다.
- `tests/settings/operational-env.test.ts` — `process.env` 를 통째로 넘기는 파일의 닫힌 목록에 `src/lib/mail/transport.ts` 가 이미 있다. SMTP_* 의 소유 파일도 transport.ts 하나(`src/lib/settings/operational.ts:16-17`) — 그대로다.
  errors.ts 는 env 를 읽지 않는다. 워크스페이스 메일 표는 운영 설정 목록(`editor: '운영자' | '플랫폼 관리자'`)에 넣지 않는다 — 워크스페이스 관리자가 고치는 워크스페이스 설정이지 배포 운영 설정이 아니다.
- `tests/auth/password-reset-mail.test.ts` — `mailConfigured()` 는 동기·env 판정 그대로 둔다. transport.ts 가 새로 가져오는 `@/lib/supabase/adminFor`(→ `./admin`·`./env`)·`./workspaceSmtp` 는 import 시점 부작용이 없다.
- `tests/invariants/i18n-server-messages.test.ts` — 새 서버 키가 공용 사전(KO)과 겹치지 않는다(`srv.` 접두), errors.ts 는 `import type { ServerTranslate }` 만(값 import 아님).
- `tests/invariants/i18n-no-korean-literals.test.ts` 는 `src/components`·`src/app` 의 `.tsx` 만 본다 — 이 작업의 파일은 대상이 아니다.

- [ ] **Step 1: 서버 사전에 테스트 발송 인증 실패 문구를 더한다**

`src/lib/i18n/dict/serverUi.ts` — `srv.llmConfig.*` 블록과 `// src/app/actions/meetingNotify.ts` 블록 사이(파일별 알파벳 순서):

old:
```ts
  'srv.llmConfig.settingsNotValid': '유효하지 않은 설정입니다',
  // src/app/actions/meetingNotify.ts
```
new:
```ts
  'srv.llmConfig.settingsNotValid': '유효하지 않은 설정입니다',
  // src/app/actions/mailSettings.ts·src/lib/mail/errors.ts — 워크스페이스 메일 설정(테스트 발송 결과·SMTP 오류)
  'srv.mailSettings.testAuthFailed': '메일 계정 인증에 실패했습니다. Gmail 이면 계정 비밀번호가 아니라 앱 비밀번호(16자리)를 넣었는지 확인하세요.',
  // src/app/actions/meetingNotify.ts
```

- [ ] **Step 2: errors.ts 의 실패 테스트를 쓴다**

Create `tests/mail/errors.test.ts`:
```ts
// SMTP 발송 오류 → 사용자 문구(설계 §2.5). 회의 안내·프로젝트 초대·테스트 발송이 같은 변환을 쓴다 — SMTP 원문은 싣지 않는다.
import { describe, it, expect } from 'vitest'
import { smtpErrorMessage } from '@/lib/mail/errors'
import { serverKoTranslate } from '@/lib/i18n/serverDict'

const RAW = '535-5.7.8 Username and Password not accepted bot@example.org secret-pw smtp.example.org'
const smtpError = (code: string) => Object.assign(new Error(RAW), { code, response: RAW })

const AUTH = '메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.'
const CONNECT = '메일 서버에 연결하지 못했습니다.'
const OTHER = '메일 발송 중 오류가 발생했습니다.'

describe('smtpErrorMessage', () => {
  it('EAUTH 는 계정 인증 실패 — 회의·초대 액션의 옛 문구 그대로', () => {
    expect(smtpErrorMessage(serverKoTranslate, smtpError('EAUTH'))).toBe(AUTH)
    expect(smtpErrorMessage(serverKoTranslate, smtpError('EAUTH'), { test: false })).toBe(AUTH)
  })

  it('테스트 발송의 EAUTH 는 앱 비밀번호 안내를 더한다', () => {
    const msg = smtpErrorMessage(serverKoTranslate, smtpError('EAUTH'), { test: true })
    expect(msg).toBe(serverKoTranslate('srv.mailSettings.testAuthFailed'))
    expect(msg).toContain('앱 비밀번호')
    expect(msg).not.toBe(AUTH)
  })

  it.each(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION'])('%s 는 서버 연결 실패 — 테스트 발송이어도 같다', (code) => {
    expect(smtpErrorMessage(serverKoTranslate, smtpError(code))).toBe(CONNECT)
    expect(smtpErrorMessage(serverKoTranslate, smtpError(code), { test: true })).toBe(CONNECT)
  })

  it.each([
    ['다른 코드', smtpError('EENVELOPE')],
    ['코드 없는 Error', new Error(RAW)],
    ['문자열', RAW],
    ['null', null],
    ['undefined', undefined],
    ['숫자 코드', { code: 535 }],
  ] as const)('그 밖(%s)은 일반 발송 실패', (_label, e) => {
    expect(smtpErrorMessage(serverKoTranslate, e)).toBe(OTHER)
    expect(smtpErrorMessage(serverKoTranslate, e, { test: true })).toBe(OTHER)
  })

  it('원문(계정·비밀번호·호스트·응답 코드)을 문구에 싣지 않는다', () => {
    for (const code of ['EAUTH', 'ETIMEDOUT', 'EENVELOPE']) {
      for (const test of [false, true]) {
        const msg = smtpErrorMessage(serverKoTranslate, smtpError(code), { test })
        for (const leak of ['bot@example.org', 'secret-pw', 'smtp.example.org', '535']) expect(msg).not.toContain(leak)
      }
    }
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run tests/mail/errors.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/mail/errors"`(파일이 아직 없다).

- [ ] **Step 4: errors.ts 를 만든다**

Create `src/lib/mail/errors.ts`:
```ts
// SMTP 발송 오류 → 사용자 문구(설계 §2.5). 회의 안내·프로젝트 초대·테스트 발송(워크스페이스 메일 설정) 셋이 같은 변환을 쓴다.
// 순수 — env·DB 를 읽지 않는다. 서버 사전은 타입만 가져온다(값 import 는 server.ts·serverDict.ts 만 — i18n-server-messages 불변식).
import type { ServerTranslate } from '@/lib/i18n/serverDict'

/**
 * SMTP 원문 오류(message·response)에는 계정·호스트가 섞인다. 사용자에게는 nodemailer 의 사유 코드만 보고 고른 문구를 전한다.
 * test 면(설정 화면의 테스트 발송) 인증 실패에 "Gmail 이면 앱 비밀번호인지" 안내를 더한다.
 */
export function smtpErrorMessage(tr: ServerTranslate, e: unknown, opts: { test?: boolean } = {}): string {
  const code = (e as { code?: unknown } | null | undefined)?.code
  if (code === 'EAUTH') return tr(opts.test ? 'srv.mailSettings.testAuthFailed' : 'err.mailAccountAuthenticationFailed')
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') return tr('err.couldNotConnectMailServer')
  return tr('err.errorOccurredWhileSendingMail')
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/mail/errors.test.ts`
Expected: PASS (5 describe 항목, it.each 포함 전부 초록).

- [ ] **Step 6: transport 테스트를 비동기 시그니처·워크스페이스 판정으로 바꾼다(실패 테스트)**

기존 사례(`getTransport` env 경로 12개·`resolveSmtpSettings` 3개)는 모두 남기고, getTransport 호출만 `await getTransport({ workspaceId: null })` 로 바꾼다(콜백은 async).
`adminFor` 는 진짜를 쓴다(uuid 가 아니면 throw — 그 경로를 실제로 시험한다). 그 안의 service_role 생성만 `@/lib/supabase/admin` 목으로 바꾸고,
`workspaceSmtp` 는 `rowToSmtpEnv` 를 진짜로 둔 채 `loadWorkspaceMailRow`·`vetMailHost`(DB·DNS)만 목으로 바꾼다.

Replace `tests/mail/transport.test.ts` 전체:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WorkspaceMailRow } from '@/lib/mail/workspaceSmtp'

const { createTransport, sendMail, ADMIN, createAdminClient, loadWorkspaceMailRow, vetMailHost } = vi.hoisted(() => {
  const sendMail = vi.fn()
  const ADMIN = { from: vi.fn() }
  return {
    sendMail,
    createTransport: vi.fn<(opts: Record<string, unknown>) => { sendMail: typeof sendMail }>(() => ({ sendMail })),
    ADMIN,
    createAdminClient: vi.fn(() => ADMIN),
    loadWorkspaceMailRow: vi.fn(),
    vetMailHost: vi.fn(),
  }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))
// adminFor 는 진짜(uuid 가 아니면 throw) — 그 안에서 만드는 service_role 클라이언트만 바꾼다
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
// 행 → env 꼴 매핑(rowToSmtpEnv)은 진짜, DB 조회와 DNS 검사만 목
vi.mock('@/lib/mail/workspaceSmtp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mail/workspaceSmtp')>()),
  loadWorkspaceMailRow,
  vetMailHost,
}))

import {
  getTransport, resolveMailStatus, resolveSmtpSettings, transportFromSettings,
  MAIL_SETTINGS_UNAVAILABLE, type SmtpSettings,
} from '@/lib/mail/transport'
import { BRAND } from '@/lib/branding'

// 새 키를 모두 '' 로 스텁한다 — 개발자 셸·.env.local 의 값이 테스트로 새지 않게.
const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_AUTH', 'SMTP_FROM_ADDRESS', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM_NAME']
const env = (over: Record<string, string>) => { for (const k of KEYS) vi.stubEnv(k, over[k] ?? '') }

const NOT_CONFIGURED = '메일 발송이 설정되지 않았습니다.'
const MISCONFIGURED = '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.'
const HOST_NOT_ALLOWED = '이 메일 서버 주소는 쓸 수 없습니다.'

const WID = '11111111-1111-4111-8111-111111111111'
const IP = '203.0.113.10'
const ENV_OK = { SMTP_HOST: 'smtp.env.example', SMTP_USER: 'env@example.com', SMTP_PASS: 'env-pw' }
const MSG = { to: ['a@b.com'], replyTo: null, subject: 'S', html: 'H', text: 'T' }
const row = (over: Partial<WorkspaceMailRow> = {}): WorkspaceMailRow => ({
  workspace_id: WID, preset: 'custom', host: 'smtp.example.org', port: 587, secure: false,
  username: 'bot@example.org', password: 'ws-secret', from_address: null,
  password_set_by: null, password_set_at: '2026-10-15T00:00:00Z', updated_by: null, updated_at: '2026-10-15T00:00:00Z',
  ...over,
})

beforeEach(() => {
  createTransport.mockClear(); sendMail.mockReset(); createAdminClient.mockClear()
  loadWorkspaceMailRow.mockReset(); loadWorkspaceMailRow.mockResolvedValue({ kind: 'none' })
  vetMailHost.mockReset(); vetMailHost.mockResolvedValue({ ok: true, address: IP })
  env({})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('getTransport — env 경로(workspaceId: null)', () => {
  it('워크스페이스가 없으면 DB 를 보지 않는다', async () => {
    env(ENV_OK)
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
    expect(vetMailHost).not.toHaveBeenCalled()
  })

  it('SMTP_HOST 가 없으면 설정되지 않음 — Gmail 로 가지 않는다', async () => {
    env({ SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect(await getTransport({ workspaceId: null })).toEqual({ ok: false, error: NOT_CONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('SMTP_HOST 만 있고 USER·PASS 가 둘 다 없으면 설정되지 않음 — 오류 로그도 남기지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env({ SMTP_HOST: 'smtp.example.com' })
    expect(await getTransport({ workspaceId: null })).toEqual({ ok: false, error: NOT_CONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
  })

  it('명시한 호스트·포트·보안으로 만들고 10초 타임아웃을 건다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '2525', SMTP_SECURE: 'false', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com', port: 2525, secure: false, requireTLS: true,
      auth: { user: 'a@example.com', pass: 'pw' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }))
  })

  it('포트·보안이 없으면 587 STARTTLS 이고 인증이 있으면 requireTLS — env 경로는 이름을 바꿔 달지 않는다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, auth: { user: 'a@example.com', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
    expect(opts).not.toHaveProperty('name')
  })

  it('465 는 secure — 이미 TLS 라 requireTLS 는 없다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ port: 465, secure: true, requireTLS: false, auth: { user: 'a@example.com', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
  })

  it.each([
    ['true', 465, true],
    ['false', 587, false],
  ] as const)('SMTP_SECURE=%s 만 있으면 포트는 %i', async (secure, port, expected) => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_SECURE: secure, SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    expect(createTransport.mock.calls[0][0]).toMatchObject({ port, secure: expected })
  })

  it('SMTP_AUTH=none + 1025 평문(로컬 inbucket 127.0.0.1) — auth 키가 없고, 주소 검사를 받지 않는다', async () => {
    env({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: 'noreply@example.com' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).not.toHaveProperty('auth')
    expect(opts).toMatchObject({ host: '127.0.0.1', port: 1025, secure: false, requireTLS: false })
    expect(vetMailHost).not.toHaveBeenCalled()
  })

  it.each([
    [{ SMTP_PORT: '0' }], [{ SMTP_PORT: '70000' }], [{ SMTP_PORT: 'abc' }], [{ SMTP_SECURE: 'yes' }],
    [{ SMTP_PORT: '465', SMTP_SECURE: 'false' }], [{ SMTP_PORT: '587', SMTP_SECURE: 'true' }], [{ SMTP_AUTH: 'login' }],
    [{ SMTP_PASS: '' }],                                    // 부분 인증
    [{ SMTP_USER: 'apikey', SMTP_FROM_ADDRESS: '' }],      // 이메일이 아닌 USER + 발신 주소 없음
    [{ SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: '', SMTP_USER: '', SMTP_PASS: '' }],
    [{ SMTP_PORT: '25', SMTP_SECURE: 'true' }],
    [{ SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: 'noreply@example.com' }], // 무인증이라면서 USER·PASS 가 남아 있다
    [{ SMTP_FROM_ADDRESS: 'not-an-email' }],
  ])('잘못된 설정 %o 은 invalid — 문구에 키 이름이 없고, 키 이름은 로그에만', async (over) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', ...over })
    const tx = await getTransport({ workspaceId: null })
    expect(tx).toEqual({ ok: false, error: MISCONFIGURED })
    expect(JSON.stringify(tx)).not.toContain('SMTP_')
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).toMatch(/SMTP_/)
    expect(logged).not.toContain('pw')                      // 비밀번호는 로그에도 넣지 않는다
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('SMTP_FROM_ADDRESS 가 발신 주소를 정한다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'apikey', SMTP_PASS: 'pw', SMTP_FROM_ADDRESS: 'noreply@example.com' })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: `${BRAND.productName} 알림`, address: 'noreply@example.com' },
    }))
  })

  it('send 는 발신 표시명을 붙이고 rejected 를 문자열 배열로 돌려준다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', MAIL_FROM_NAME: '테스트 발신' })
    sendMail.mockResolvedValue({ rejected: ['bad@x.com'] })
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    const out = await tx.send({ to: ['a@example.com'], replyTo: 'me@example.com', subject: 'S', html: '<b>H</b>', text: 'T' })
    expect(out).toEqual({ rejected: ['bad@x.com'] })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: '테스트 발신', address: 'a@example.com' },
      to: ['a@example.com'], replyTo: 'me@example.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    }))
  })

  it('워크스페이스 발신 표시명(fromName)이 MAIL_FROM_NAME 보다 앞선다', async () => {
    env({ ...ENV_OK, MAIL_FROM_NAME: '배포 발신' })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: null, fromName: '한빛 발신' })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛 발신', address: 'env@example.com' } }))
  })

  it('MAIL_FROM_NAME 이 비면 발신 표시명은 "<제품명> 알림" 이다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: `${BRAND.productName} 알림`, address: 'a@example.com' },
    }))
  })

  it('rejected 가 없으면 빈 배열을 낸다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    sendMail.mockResolvedValue({})
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(await tx.send(MSG)).toEqual({ rejected: [] })
  })
})

describe('getTransport — 워크스페이스 설정(설계 §2.1 규칙 1–4·§2.2)', () => {
  it('행이 유효하면 그 계정으로 — env 가 있어도 쓰지 않는다. 검사한 IP 로 접속하고 인사·인증서는 원래 호스트', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row() })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: WID, fromName: '한빛 발신' })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(loadWorkspaceMailRow).toHaveBeenCalledWith(ADMIN, WID)
    expect(vetMailHost).toHaveBeenCalledWith('smtp.example.org')
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: IP, port: 587, secure: false, requireTLS: true,
      auth: { user: 'bot@example.org', pass: 'ws-secret' },
      tls: { servername: 'smtp.example.org' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }))
    expect(createTransport.mock.calls[0][0]).not.toHaveProperty('name')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛 발신', address: 'bot@example.org' } }))
  })

  it('Gmail 행 — 465 SSL, 보내는 주소가 비면 계정 주소', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'team@gmail.com' }) })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: WID })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(createTransport.mock.calls[0][0]).toMatchObject({
      host: IP, port: 465, secure: true, requireTLS: false,
      auth: { user: 'team@gmail.com', pass: 'ws-secret' }, tls: { servername: 'smtp.gmail.com' },
    })
    expect(createTransport.mock.calls[0][0]).not.toHaveProperty('name')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: `${BRAND.productName} 알림`, address: 'team@gmail.com' } }))
  })

  it('행의 보내는 주소(from_address)가 발신 주소를 정한다', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ username: 'apikey', from_address: 'noreply@example.org' }) })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: WID, fromName: '한빛' })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛', address: 'noreply@example.org' } }))
  })

  it.each([
    ['계정이 공백', { username: '   ' }],
    ['계정·비밀번호 모두 공백(unset 꼴이어도)', { username: ' ', password: ' ' }],
    ['이메일이 아닌 계정 + 보내는 주소 없음', { username: 'apikey' }],
  ] as const)('규칙을 어긴 행(%s)은 env 가 있어도 SMTP_MISCONFIGURED — env 로 내려가지 않는다', async (_label, over) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row(over) })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MISCONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
    expect(vetMailHost).not.toHaveBeenCalled()
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).not.toContain('ws-secret')
    expect(logged).not.toContain('env-pw')
  })

  it('보관된 워크스페이스의 행 — 보내지 않고 env 로도 내려가지 않는다(보관 사실은 드러내지 않는 문구)', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'archived' })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('행 조회가 실패하면 MAIL_SETTINGS_UNAVAILABLE — 미설정으로 위장하지도, env 로 내려가지도 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    loadWorkspaceMailRow.mockRejectedValue(new Error('workspace_mail_settings 조회 실패'))
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(createTransport).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
  })

  it('uuid 가 아닌 워크스페이스 id — adminFor 가 throw 하면 MAIL_SETTINGS_UNAVAILABLE, 클라이언트도 만들지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    expect(await getTransport({ workspaceId: 'ws-1' })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('행이 없으면 env — 주소 검사를 받지 않고 원래 호스트로 접속한다', async () => {
    env(ENV_OK)
    expect((await getTransport({ workspaceId: WID })).ok).toBe(true)
    expect(loadWorkspaceMailRow).toHaveBeenCalledWith(ADMIN, WID)
    expect(vetMailHost).not.toHaveBeenCalled()
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ host: 'smtp.env.example', auth: { user: 'env@example.com', pass: 'env-pw' } })
    expect(opts).not.toHaveProperty('tls')
    expect(opts).not.toHaveProperty('name')
  })

  it('행이 없고 env 도 없으면 SMTP_NOT_CONFIGURED, env 가 잘못이면 SMTP_MISCONFIGURED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: NOT_CONFIGURED })
    env({ ...ENV_OK, SMTP_PORT: '465', SMTP_SECURE: 'false' })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MISCONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('서버 주소가 검사에서 거부되면 MAIL_HOST_NOT_ALLOWED — 접속하지 않는다', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row() })
    vetMailHost.mockResolvedValue({ ok: false })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: HOST_NOT_ALLOWED })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('주소 검사 자체가 던져도 거부로 닫는다', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row() })
    vetMailHost.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND smtp.example.org'), { code: 'ENOTFOUND' }))
    const tx = await getTransport({ workspaceId: WID })
    expect(tx).toEqual({ ok: false, error: HOST_NOT_ALLOWED })
    expect(JSON.stringify(tx)).not.toContain('ENOTFOUND')
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('캐시하지 않는다 — 저장한 다음 발송부터 새 행을 쓴다', async () => {
    loadWorkspaceMailRow.mockResolvedValueOnce({ kind: 'row', row: row() })
    loadWorkspaceMailRow.mockResolvedValueOnce({ kind: 'row', row: row({ username: 'next@example.org', password: 'next-pw' }) })
    await getTransport({ workspaceId: WID })
    await getTransport({ workspaceId: WID })
    expect(loadWorkspaceMailRow).toHaveBeenCalledTimes(2)
    expect(createTransport.mock.calls[1][0]).toMatchObject({ auth: { user: 'next@example.org', pass: 'next-pw' } })
  })
})

describe('resolveMailStatus — 화면 상태 줄과 발송이 같은 규칙', () => {
  it('워크스페이스 없음: env 가 없으면 none, 유효하면 env·valid, 잘못이면 env·invalid', async () => {
    expect(await resolveMailStatus(null)).toEqual({ source: 'none' })
    env(ENV_OK)
    expect(await resolveMailStatus(null)).toEqual({ source: 'env', valid: true, fromAddress: 'env@example.com' })
    env({ ...ENV_OK, SMTP_PORT: '587', SMTP_SECURE: 'true' })
    expect(await resolveMailStatus(null)).toEqual({ source: 'env', valid: false })
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
  })

  it('행이 유효하면 workspace·valid(발신 주소 포함) — 상태 판정은 DNS 를 보지 않고 연결하지도 않는다', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ from_address: 'noreply@example.org' }) })
    expect(await resolveMailStatus(WID)).toEqual({ source: 'workspace', valid: true, fromAddress: 'noreply@example.org' })
    expect(vetMailHost).not.toHaveBeenCalled()
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('규칙을 어긴 행은 env 가 유효해도 workspace·invalid', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ username: ' ', password: ' ' }) })
    expect(await resolveMailStatus(WID)).toEqual({ source: 'workspace', valid: false })
  })

  it('행이 없으면 env 판정(env 가 없으면 none)', async () => {
    expect(await resolveMailStatus(WID)).toEqual({ source: 'none' })
    env(ENV_OK)
    expect(await resolveMailStatus(WID)).toEqual({ source: 'env', valid: true, fromAddress: 'env@example.com' })
  })

  it('보관·조회 실패·uuid 아닌 id 는 { error } — 미설정으로 위장하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValueOnce({ kind: 'archived' })
    expect(await resolveMailStatus(WID)).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
    loadWorkspaceMailRow.mockRejectedValueOnce(new Error('조회 실패'))
    expect(await resolveMailStatus(WID)).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await resolveMailStatus('ws-1')).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
  })
})

describe('transportFromSettings — 검증이 끝난 설정으로 만든다(테스트 발송도 이것을 쓴다)', () => {
  const S: SmtpSettings = {
    host: 'smtp.example.org', port: 465, secure: true, requireTLS: false,
    auth: { user: 'bot@example.org', pass: 'pw' }, fromAddress: 'noreply@example.org',
  }

  it('connectTo 가 없으면 host 그대로, name·tls 를 달지 않는다 — DB·DNS 를 보지 않는다', () => {
    expect(transportFromSettings(S).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ host: 'smtp.example.org', port: 465, secure: true, requireTLS: false, auth: { user: 'bot@example.org', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
    expect(opts).not.toHaveProperty('name')
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
    expect(vetMailHost).not.toHaveBeenCalled()
  })

  it('connectTo 면 host 는 그 IP, tls.servername 은 원래 호스트(재해석·DNS 리바인딩 차단, 인증서는 원래 이름) — name(EHLO)은 달지 않는다', () => {
    transportFromSettings(S, { connectTo: IP })
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({
      host: IP, tls: { servername: 'smtp.example.org' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    })
    expect(opts).not.toHaveProperty('name')
  })

  it('from 은 { name, address: settings.fromAddress } 로 고정한다', async () => {
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = transportFromSettings(S, { fromName: '한빛 발신', connectTo: IP })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛 발신', address: 'noreply@example.org' } }))
  })
})

describe('resolveSmtpSettings', () => {
  it('넘긴 env 만 읽고 값의 앞뒤 공백을 걷는다', () => {
    expect(resolveSmtpSettings({ SMTP_HOST: ' smtp.example.com ', SMTP_PORT: ' 587 ', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' }))
      .toEqual({
        ok: true,
        settings: {
          host: 'smtp.example.com', port: 587, secure: false, requireTLS: true,
          auth: { user: 'a@example.com', pass: 'pw' }, fromAddress: 'a@example.com',
        },
      })
  })

  it('invalid 사유는 키 이름만 — env 로 받은 포트 값을 사유에 보간하지 않는다', () => {
    const reason = (port: string) => {
      const r = resolveSmtpSettings({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', SMTP_PORT: port, SMTP_SECURE: 'true' })
      if (r.ok) throw new Error('invalid 여야 한다')
      return r.reason
    }
    expect(reason('25')).toBe(reason('587'))
    expect(reason('25')).toContain('SMTP_PORT')
  })

  it('빈 env 는 unset — 사유에 키 이름을 담는다', () => {
    const r = resolveSmtpSettings({})
    expect(r).toMatchObject({ ok: false, kind: 'unset' })
    if (r.ok) throw new Error('unset 이어야 한다')
    expect(r.reason).toContain('SMTP_HOST')
  })
})
```

- [ ] **Step 7: 실패를 확인한다**

Run: `npx vitest run tests/mail/transport.test.ts`
Expected: FAIL — `transportFromSettings`·`resolveMailStatus`·`MAIL_SETTINGS_UNAVAILABLE` 가 export 되지 않아 `TypeError: transportFromSettings is not a function` 등.
워크스페이스 사례는 지금의 동기 `getTransport(opts)` 가 env 만 읽으므로 `loadWorkspaceMailRow` 미호출로 실패한다.

- [ ] **Step 8: transport.ts 를 바꾼다**

Replace `src/lib/mail/transport.ts` 전체(`resolveSmtpSettings`·`mailConfigured` 본문과 기존 형·상수는 한 글자도 바꾸지 않는다 — 바뀌는 것은 import 셋·새 상수 둘·`MailStatus`·판정 도우미·`transportFromSettings`·`getTransport`):
```ts
import 'server-only'
import nodemailer from 'nodemailer'
import { adminFor } from '@/lib/supabase/adminFor'
import { mailFromName } from './fromName'
import { isValidEmail } from './recipients'
import { loadWorkspaceMailRow, rowToSmtpEnv, vetMailHost, type WorkspaceMailLoad } from './workspaceSmtp'

export interface MailMessage {
  to: string[]
  replyTo: string | null
  subject: string
  html: string
  text: string
}

export type Transport =
  | { ok: true; send: (msg: MailMessage) => Promise<{ rejected: string[] }> }
  | { ok: false; error: string }

export type SmtpSettings = {
  host: string; port: number; secure: boolean; requireTLS: boolean
  auth: { user: string; pass: string } | null
  fromAddress: string
}

export const SMTP_NOT_CONFIGURED = '메일 발송이 설정되지 않았습니다.'
export const SMTP_MISCONFIGURED = '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.'
/** 워크스페이스 메일 설정을 확정하지 못했다(조회 실패·잘못된 id·보관된 워크스페이스) — 미설정으로 위장하지 않고, 보관 사실도 드러내지 않는다 */
export const MAIL_SETTINGS_UNAVAILABLE = '메일 발송 설정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
/** 워크스페이스 행의 서버 주소가 사설·예약 대역으로 풀리거나 풀리지 않았다(설계 §2.4) */
export const MAIL_HOST_NOT_ALLOWED = '이 메일 서버 주소는 쓸 수 없습니다.'

/** 발송 설정의 출처와 유효성 — 설정 화면의 상태 줄과 발송(getTransport)이 같은 규칙으로 낸다 */
export type MailStatus =
  | { source: 'workspace'; valid: true; fromAddress: string } | { source: 'workspace'; valid: false }
  | { source: 'env'; valid: true; fromAddress: string } | { source: 'env'; valid: false }
  | { source: 'none' }

// nodemailer 기본 타임아웃은 훨씬 길다. 사용자가 저장 버튼 앞에서 기다리는 동기 경로이므로 짧게 묶는다.
const TIMEOUT_MS = 10_000

/**
 * env → SMTP 설정(순수, 호출 시점에 읽는다). 실패 사유(reason)는 키 이름을 담는 서버 로그 전용이다.
 * 명시값을 엄격히 읽는다 — 공급자 기본값은 없고, 모호한 조합(465+평문, 587+SSL)은 추측하지 않고 invalid 로 낸다.
 */
export function resolveSmtpSettings(env: Record<string, string | undefined>):
  | { ok: true; settings: SmtpSettings }
  | { ok: false; kind: 'unset' | 'invalid'; reason: string } {
  const v = (k: string) => env[k]?.trim() ?? ''
  const invalid = (reason: string) => ({ ok: false as const, kind: 'invalid' as const, reason })
  const host = v('SMTP_HOST')
  if (!host) return { ok: false, kind: 'unset', reason: 'SMTP_HOST 없음' }
  const portRaw = v('SMTP_PORT'), secureRaw = v('SMTP_SECURE'), authRaw = v('SMTP_AUTH')
  const user = v('SMTP_USER'), pass = v('SMTP_PASS'), fromRaw = v('SMTP_FROM_ADDRESS')

  if (secureRaw && secureRaw !== 'true' && secureRaw !== 'false') return invalid('SMTP_SECURE 는 true|false 만')
  if (portRaw && !/^\d+$/.test(portRaw)) return invalid('SMTP_PORT 가 숫자가 아님')
  const portNum = portRaw ? Number(portRaw) : null
  if (portNum !== null && (portNum < 1 || portNum > 65535)) return invalid('SMTP_PORT 범위(1-65535) 밖')
  const secure = secureRaw ? secureRaw === 'true' : portNum === 465
  const port = portNum ?? (secure ? 465 : 587)
  if (port === 465 && !secure) return invalid('SMTP_PORT 465 는 SMTP_SECURE=true')
  if ((port === 587 || port === 25) && secure) return invalid('SMTP_PORT 587·25 는 SMTP_SECURE=false(STARTTLS)')
  if (authRaw && authRaw !== 'none') return invalid('SMTP_AUTH 는 비우거나 none')

  let auth: SmtpSettings['auth'] = null
  if (authRaw === 'none') {
    if (user || pass) return invalid('SMTP_AUTH=none 이면 SMTP_USER·SMTP_PASS 를 비운다')
    if (!fromRaw) return invalid('SMTP_AUTH=none 이면 SMTP_FROM_ADDRESS 필수')
  } else {
    if (!user && !pass) return { ok: false, kind: 'unset', reason: 'SMTP_USER·SMTP_PASS 없음(무인증 릴레이는 SMTP_AUTH=none)' }
    if (!user || !pass) return invalid('SMTP_USER·SMTP_PASS 는 둘 다 필요')
    auth = { user, pass }
  }
  const fromAddress = fromRaw || (isValidEmail(user) ? user : '')
  if (!fromAddress || !isValidEmail(fromAddress)) return invalid('발신 주소 없음(SMTP_FROM_ADDRESS 또는 이메일 형식 SMTP_USER)')
  // 인증이 있는데 처음부터 TLS 가 아니면 STARTTLS 를 강제한다 — 서버가 STARTTLS 를 안 주면 평문 로그인 대신 실패한다.
  return { ok: true, settings: { host, port, secure, requireTLS: auth !== null && !secure, auth, fromAddress } }
}

/**
 * 이 배포가 메일을 보내도록 구성됐는가 — 보내기 전에 화면이 길을 열지 닫을지 정할 때 쓴다(비밀번호 재설정 링크 등).
 * 잘못된 설정(invalid)은 구성되지 않은 것으로 본다: 보내면 실패할 길을 열어 두지 않는다. 사유는 getTransport 가 보낼 때 로그에 남긴다.
 * env 만 본다(동기) — 비밀번호 재설정 메일은 Supabase Auth 가 보내므로 워크스페이스 메일 설정과 무관하다(설계 범위 밖).
 */
export function mailConfigured(): boolean {
  return resolveSmtpSettings(process.env).ok
}

type SmtpSelection = { source: 'workspace' | 'env'; r: ReturnType<typeof resolveSmtpSettings> } | { error: string }

/**
 * 발송 설정 고르기 — 설계 §2.1 판정 규칙 한 벌(resolveMailStatus·getTransport 가 같이 쓴다). 캐시하지 않는다(저장한 다음 발송부터 바로 쓰인다).
 *  1. 행이 있으면 그 행만 본다 — unset 이든 invalid 든 env 로 내려가지 않는다(관리자가 정한 계정을 조용히 다른 계정으로 바꾸지 않는다).
 *  2. 보관된 워크스페이스의 행 → 보내지 않는다(env 로도 내려가지 않는다).
 *  3. 행이 없으면 배포 env(SMTP_*).
 *  4. 조회 실패(uuid 가 아닌 id 로 adminFor 가 throw 한 것 포함) → MAIL_SETTINGS_UNAVAILABLE — 미설정으로 위장하지 않는다.
 */
async function selectSmtp(workspaceId: string | null): Promise<SmtpSelection> {
  if (workspaceId !== null) {
    let load: WorkspaceMailLoad
    try {
      const { admin } = adminFor({ workspaceId })
      load = await loadWorkspaceMailRow(admin, workspaceId)
    } catch (e) {
      console.error('[mail] 워크스페이스 메일 설정 조회 실패:', e instanceof Error ? e.message : 'unknown')
      return { error: MAIL_SETTINGS_UNAVAILABLE }
    }
    if (load.kind === 'archived') return { error: MAIL_SETTINGS_UNAVAILABLE }
    if (load.kind === 'row') return { source: 'workspace', r: resolveSmtpSettings(rowToSmtpEnv(load.row)) }
  }
  return { source: 'env', r: resolveSmtpSettings(process.env) }
}

/** 설정 화면의 상태 줄. DNS 검사·연결은 하지 않는다(발송 때만) */
export async function resolveMailStatus(workspaceId: string | null): Promise<MailStatus | { error: string }> {
  const s = await selectSmtp(workspaceId)
  if ('error' in s) return { error: s.error }
  if (s.r.ok) {
    return s.source === 'workspace'
      ? { source: 'workspace', valid: true, fromAddress: s.r.settings.fromAddress }
      : { source: 'env', valid: true, fromAddress: s.r.settings.fromAddress }
  }
  if (s.source === 'workspace') return { source: 'workspace', valid: false }
  return s.r.kind === 'unset' ? { source: 'none' } : { source: 'env', valid: false }
}

/** DNS 검사 — 검사 자체가 던져도 거부로 닫는다(해석 오류 원문은 싣지 않는다) */
async function vetOrDeny(host: string): Promise<{ ok: true; address: string } | { ok: false }> {
  try { return await vetMailHost(host) } catch { return { ok: false } }
}

/**
 * 검증이 끝난 설정으로 트랜스포트를 만든다 — 순수 구성(nodemailer·타임아웃·from 은 이 파일만 안다). 테스트 발송도 이것을 쓴다.
 * connectTo(vetMailHost 가 통과시킨 IP)가 있으면 그 IP 로 접속한다 — nodemailer 가 이름을 다시 풀지 않아 검사와 접속 사이에
 * DNS 리바인딩이 끼어들 틈이 없다. 인증서 검사·SNI(tls.servername)는 원래 호스트 이름으로 한다.
 * `name` 은 달지 않는다 — 클라이언트 자신의 EHLO 이름이라 서버 이름을 대면 MTA 가 거절한다(설계 §2.2 문구와 일부러 다르다).
 * `from` 은 이 모듈이 소유한다(호출자가 바꿀 수 없다).
 */
export function transportFromSettings(settings: SmtpSettings, opts: { fromName?: string; connectTo?: string } = {}): Transport {
  const s = settings
  const fromName = mailFromName(opts.fromName)
  const tx = nodemailer.createTransport({
    host: opts.connectTo ?? s.host,
    port: s.port,
    secure: s.secure,
    requireTLS: s.requireTLS,
    ...(s.auth ? { auth: s.auth } : {}),
    ...(opts.connectTo ? { tls: { servername: s.host } } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })

  return {
    ok: true,
    send: async (msg) => {
      const info = await tx.sendMail({
        from: { name: fromName, address: s.fromAddress },
        to: msg.to,
        replyTo: msg.replyTo ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      })
      // nodemailer 의 rejected 는 문자열 또는 주소 객체가 섞여 올 수 있다.
      const rejected = (info.rejected ?? []) as unknown[]
      return {
        rejected: rejected.map(r =>
          typeof r === 'string' ? r : String((r as { address?: string })?.address ?? r)),
      }
    },
  }
}

/**
 * SMTP 트랜스포트 — 워크스페이스 메일 설정 → 배포 env(SMTP_*) → 미설정(설계 §2.1). 설정이 없거나 잘못되면 **throw 하지 않고**
 * ok:false 를 낸다 — 로컬·Preview 에서 화면을 죽이지 않기 위해서다. 오류의 키 이름은 서버 로그에만 — 반환 문구는 사용자에게 그대로 뜬다.
 * 'unset → SMTP_NOT_CONFIGURED' 는 env 경로에만 해당한다(행이 있으면 무엇이 비었든 SMTP_MISCONFIGURED).
 * 워크스페이스 행만 연결 전에 서버 주소 검사(vetMailHost)를 지난다 — env 는 운영자가 정한 값이라(로컬 inbucket 127.0.0.1 포함) 면제한다.
 */
export async function getTransport(opts: { workspaceId: string | null; fromName?: string }): Promise<Transport> {
  const s = await selectSmtp(opts.workspaceId)
  if ('error' in s) return { ok: false, error: s.error }
  if (!s.r.ok) {
    if (s.source === 'workspace') console.error('[mail] 워크스페이스 메일 설정 오류:', s.r.reason)
    else if (s.r.kind === 'invalid') console.error('[mail] SMTP 설정 오류:', s.r.reason)
    return { ok: false, error: s.source === 'env' && s.r.kind === 'unset' ? SMTP_NOT_CONFIGURED : SMTP_MISCONFIGURED }
  }
  if (s.source === 'env') return transportFromSettings(s.r.settings, { fromName: opts.fromName })
  const vet = await vetOrDeny(s.r.settings.host)
  if (!vet.ok) return { ok: false, error: MAIL_HOST_NOT_ALLOWED }
  return transportFromSettings(s.r.settings, { fromName: opts.fromName, connectTo: vet.address })
}
```

주의(구현자): 이 파일의 주석에도 service_role 생성 함수 이름을 적지 않는다 — `tests/invariants/admin-scope.test.ts` 는 그 낱말이 **나오기만 해도** 감사표 행을 요구한다.
`resolveSmtpSettings` 의 사유(reason)는 키 이름만 담으므로 워크스페이스 행의 오류 로그에도 계정·비밀번호가 실리지 않는다(Step 6 의 '규칙을 어긴 행' 사례가 단언한다).

- [ ] **Step 9: 통과를 확인한다**

Run: `npx vitest run tests/mail/transport.test.ts tests/mail/errors.test.ts`
Expected: PASS (transport: env 경로 14·워크스페이스 12·상태 5·transportFromSettings 3·resolveSmtpSettings 3 — it.each 펼친 수 제외. errors 전부).

- [ ] **Step 10: 불변식·인접 테스트를 다시 돌린다**

Run:
```bash
npx vitest run tests/auth/password-reset-mail.test.ts tests/settings/operational-env.test.ts \
  tests/invariants/admin-scope.test.ts tests/invariants/i18n-server-messages.test.ts tests/invariants/i18n-no-korean-literals.test.ts \
  tests/actions/meeting-notify-gate.test.ts tests/actions/project-invites-gate.test.ts tests/gates/deny.test.ts tests/mail
```
Expected: PASS 전부.
- `password-reset-mail` — `mailConfigured()` 동기 그대로(transport.ts 가 새로 가져오는 모듈들은 import 시점 부작용이 없다).
- `operational-env` — transport.ts 는 여전히 `process.env` 를 통째로 넘기는 허용 파일이고, SMTP_* 의 소유 파일 목록은 그대로다. errors.ts 는 env 를 읽지 않는다.
- `admin-scope` — transport.ts·errors.ts 는 `adminFor` 만 쓰므로 감사표(`docs/sp2-admin-client-audit.md`)에 행이 생기지 않는다.
- `i18n-server-messages` — 새 키 `srv.mailSettings.testAuthFailed` 가 KO 와 겹치지 않고, errors.ts 의 서버 사전 import 가 타입뿐이다.
- 회의·초대 액션 테스트는 `getTransport` 를 통째로 목하므로 이 작업에서 초록이다(목을 비동기·`{ workspaceId }` 인자로 바꾸는 것은 Task 5).

Run: `npm run typecheck 2>&1 | grep -E "error TS" | grep -v -E "src/app/actions/(meetingNotify|projectInvites)\.ts"`
Expected: 출력 없음(빈 줄). 남는 오류는 옛 동기 호출 두 자리뿐이다 —
`src/app/actions/meetingNotify.ts(105…)`·`(106…)`, `src/app/actions/projectInvites.ts(369…)`·`(370…)`(TS2345 인자 형, TS2339 `Promise<Transport>` 에 `ok`·`error` 없음). Task 5 가 고친다.
`tests/` 쪽 형 오류도 없어야 한다(위 grep 이 tests 를 거르지 않으므로 함께 확인된다).

Run: `npx eslint src/lib/mail/transport.ts src/lib/mail/errors.ts tests/mail/transport.test.ts tests/mail/errors.test.ts`
Expected: 오류 0.

- [ ] **Step 11: 커밋한다**

```bash
git add src/lib/mail/transport.ts src/lib/mail/errors.ts src/lib/i18n/dict/serverUi.ts tests/mail/transport.test.ts tests/mail/errors.test.ts
git commit -m "$(cat <<'MSG'
메일 발송이 워크스페이스 설정을 먼저 보게 — 재배포 없이 관리자가 정한 계정으로 보내기 위해

getTransport 를 비동기 { workspaceId, fromName } 로 바꾸고 판정을 한 벌(selectSmtp)로 모았다:
행이 있으면 그 행만(잘못돼도 env 로 내려가지 않는다), 보관·조회 실패는 MAIL_SETTINGS_UNAVAILABLE,
행이 없을 때만 SMTP_* env. 워크스페이스 행은 연결 전에 서버 주소를 검사하고 통과한 IP 로 접속한다
(이름은 tls.servername 으로만 — 검사와 접속 사이의 DNS 리바인딩을 막는다. EHLO 의 name 은
서버 이름을 대면 MTA 가 거절하므로 달지 않는다).
설정 화면의 상태 줄(resolveMailStatus)도 같은 규칙을 쓴다. mailConfigured 는 env 판정 그대로.

회의·초대 액션에 두 벌 있던 SMTP 오류 → 문구 변환을 errors.ts 의 smtpErrorMessage 로 모았다
(테스트 발송의 인증 실패는 앱 비밀번호 안내를 더한다). 호출처 교체는 다음 커밋(Task 5) —
그 사이 typecheck 는 두 호출 자리에서만 실패하므로 두 커밋을 함께 push 한다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

**이 작업 뒤 다시 돌릴 기존 테스트:** `tests/mail/**`, `tests/auth/password-reset-mail.test.ts`, `tests/settings/operational-env.test.ts`,
`tests/invariants/admin-scope.test.ts`, `tests/invariants/i18n-server-messages.test.ts`, `tests/actions/meeting-notify-gate.test.ts`,
`tests/actions/project-invites-gate.test.ts`, `tests/gates/deny.test.ts` (Step 10 의 한 줄 명령). 전체 `npm run test` 는 Task 5 뒤(typecheck 가 초록이 된 뒤)에 돈다.

---

### Task 5: 호출처 — 회의 안내·프로젝트 초대가 워크스페이스 메일 설정으로 보낸다

**선행:** Task 4(`getTransport({ workspaceId, fromName })` 비동기 시그니처, `src/lib/mail/errors.ts` 의 `smtpErrorMessage`).
Task 4 가 끝난 시점에는 두 호출처가 옛 시그니처(`getTransport(fromName)`)로 불러 `npm run typecheck` 가 깨져 있다 — 이 작업이 되살린다.

**Task 4 에 기대는 전제(이 작업의 테스트가 그대로 단언한다):**
- `smtpErrorMessage(tr, e)`(test 옵션 없음)는 지금의 두 지역 함수(`toUserMessage`·`toMailMessage`)와 같은 키를 낸다 —
  `EAUTH` → `err.mailAccountAuthenticationFailed`('메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.'),
  `ETIMEDOUT`·`ESOCKET`·`ECONNECTION` → `err.couldNotConnectMailServer`('메일 서버에 연결하지 못했습니다.'), 그 밖 → `err.errorOccurredWhileSendingMail`('메일 발송 중 오류가 발생했습니다.').
- `src/lib/mail/errors.ts` 는 `@/lib/mail/transport` 를 import 하지 않는다. 두 액션 테스트가 `@/lib/mail/transport` 를 `{ getTransport }` 하나로 목하므로,
  errors.ts 가 transport 에서 무엇이든 가져오면 "No export is defined on the mock" 으로 터진다.

**Files:**
- Modify: `src/app/actions/meetingNotify.ts`
- Modify: `src/app/actions/projectInvites.ts`
- Test: `tests/actions/meeting-notify-gate.test.ts`
- Test: `tests/actions/project-invites-gate.test.ts`

**사전(i18n):** 이 작업은 새 사용자 문구를 만들지 않는다. 두 액션이 쓰던 SMTP 오류 키 셋(`err.mailAccountAuthenticationFailed`·`err.couldNotConnectMailServer`·
`err.errorOccurredWhileSendingMail`, `src/lib/i18n/dict/serverUi.ts`)은 이제 `smtpErrorMessage`(Task 4)가 읽는다. 설정 조회 실패·호스트 거부 문구
(`MAIL_SETTINGS_UNAVAILABLE`·`MAIL_HOST_NOT_ALLOWED`)는 `getTransport` 가 `{ ok: false, error }` 로 내고 두 액션은 그 문구를 그대로 올린다 — 사전 추가 없음.
`tests/invariants/i18n-server-messages.test.ts`(액션의 `error` 속성에 한국어 리터럴 금지)는 이 변경으로 새 적중이 생기지 않는다(새 `error:` 값은 전부 변수다).

- [ ] **Step 1: 회의 안내 테스트를 새 계약으로 고친다(실패해야 한다)**

`tests/actions/meeting-notify-gate.test.ts` 의 머리(1–14행)를 바꾼다.

old:
```ts
// 게이트를 통과하기 전에는 트랜스포트를 만들면 안 된다.
const { getTransport, send } = vi.hoisted(() => {
  const send = vi.fn()
  return { send, getTransport: vi.fn(() => ({ ok: true, send })) }
})
const { requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/data/meetings', () => ({ getMeetingDetail: vi.fn() }))
vi.mock('@/lib/mail/transport', () => ({ getTransport }))
```

new:
```ts
// 게이트를 통과하기 전에는 트랜스포트를 만들면 안 된다.
// getTransport 는 비동기다 — 회의가 속한 워크스페이스의 메일 설정(없으면 배포 env)을 읽어 계정을 고른다.
const { getTransport, send } = vi.hoisted(() => {
  const send = vi.fn()
  return {
    send,
    getTransport: vi.fn<(opts: { workspaceId: string | null; fromName?: string }) => Promise<unknown>>(async () => ({ ok: true, send })),
  }
})
// 프로젝트와 워크스페이스를 한 번에 확정한다(resolveScope) — 관리자 판정의 기준은 프로젝트, 발송 계정의 기준은 워크스페이스다.
const { requireProjectAdmin, resolveScope, getActor } = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), resolveScope: vi.fn(), getActor: vi.fn(),
}))
// 발신 표시명은 그 워크스페이스의 브랜딩 — 값을 고정해 getTransport 인자를 끝까지 단언한다.
const { loadDisplayBranding } = vi.hoisted(() => ({
  loadDisplayBranding: vi.fn<(workspaceId: string) => Promise<{ productName: string; mailFromName: string }>>(
    async () => ({ productName: 'D-Flow', mailFromName: '한빛 회의' })),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveScope, getActor }))
vi.mock('@/lib/data/meetings', () => ({ getMeetingDetail: vi.fn() }))
vi.mock('@/lib/mail/transport', () => ({ getTransport }))
vi.mock('@/lib/settings/displayBranding', () => ({ loadDisplayBranding }))
```

`beforeEach`(39–47행):

old:
```ts
beforeEach(() => {
  getTransport.mockClear(); send.mockReset()
  requireProjectAdmin.mockReset(); getActor.mockReset(); resolveProjectId.mockReset()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
```

new:
```ts
beforeEach(() => {
  getTransport.mockClear(); send.mockReset(); loadDisplayBranding.mockClear()
  requireProjectAdmin.mockReset(); getActor.mockReset(); resolveScope.mockReset()
  resolveScope.mockResolvedValue({ ok: true, projectId: 'p1', workspaceId: 'w1' })
```

확정 실패 두 사례(75–89행)를 `resolveScope` 실패로 옮기고, 가드·트랜스포트 미호출을 단언한다. 범위는 읽었지만 프로젝트가 빈 경우도 하나 더한다.

old:
```ts
  // 권한 판정의 기준(회의가 속한 프로젝트)을 못 읽으면 발송으로 나아가지 않는다 — fail-closed.
  it('대상 회의의 프로젝트를 확정하지 못하면 회의를 조회하지도 않는다', async () => {
    resolveProjectId.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('없는 회의는 거부한다', async () => {
    resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(getTransport).not.toHaveBeenCalled()
  })
```

new:
```ts
  // 권한 판정의 기준(회의가 속한 프로젝트)과 발송 계정의 기준(그 워크스페이스)을 못 읽으면 가드에도 가지 않는다 — fail-closed(3원칙 ②).
  it('대상 회의의 프로젝트·워크스페이스를 확정하지 못하면 가드도 회의 조회도 하지 않는다', async () => {
    resolveScope.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(resolveScope).toHaveBeenCalledWith('meetings', 'm1')
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('없는 회의는 거부한다 — 가드에도 트랜스포트에도 닿지 않는다', async () => {
    resolveScope.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('범위는 읽었지만 프로젝트가 비어 있으면 가드 전에 판정 불가로 멈춘다', async () => {
    resolveScope.mockResolvedValue({ ok: true, projectId: null, workspaceId: 'w1' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })
```

성공 사례 '프로젝트 관리자는 남의 회의도 보낼 수 있다'(114–121행)에 워크스페이스 단언을 더하고, 기존 `describe('notifyMeetingSaved 발송', () => {` 줄(124행)
**바로 다음에** 새 사례 둘('트랜스포트는 회의가 속한…'·'워크스페이스 메일 설정을 쓸 수 없으면…')을 끼운다. 아래 new 블록의 `describe('notifyMeetingSaved 발송', () => {`
줄은 old 블록에 있던 **그 기존 줄 그대로**다 — describe 머리를 하나 더 만들지 않는다. 새 두 사례 뒤에는 그 describe 의 기존 첫 사례(125행부터)가 그대로 이어진다.

old:
```ts
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: true, sentTo: ['박영희'] })
  })
})

describe('notifyMeetingSaved 발송', () => {
```

new:
```ts
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: true, sentTo: ['박영희'] })
    expect(getTransport).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1' }))
  })
})

describe('notifyMeetingSaved 발송', () => {
  // 프로젝트 설정(getProjectConfig)은 이 파일에서 목하지 않아 실패한다 — 범주는 code 로 내려가도
  // 발신 표시명·발송 계정은 resolveScope 의 워크스페이스로 정해진다(프로젝트 설정 조회에 묶이지 않는다).
  it('트랜스포트는 회의가 속한 워크스페이스의 메일 설정과 발신 표시명으로 고른다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@example.com' }]) as never)
    send.mockResolvedValue({ rejected: [] })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: true, sentTo: ['박영희'] })
    expect(loadDisplayBranding).toHaveBeenCalledWith('w1')
    expect(getTransport).toHaveBeenCalledTimes(1)
    expect(getTransport).toHaveBeenCalledWith({ workspaceId: 'w1', fromName: '한빛 회의' })
  })

  it('워크스페이스 메일 설정을 쓸 수 없으면(트랜스포트 ok:false) 그 문구를 올리고 보내지 않는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@example.com' }]) as never)
    getTransport.mockResolvedValueOnce({ ok: false, error: '메일 설정을 불러오지 못했습니다(목).' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toEqual({ ok: false, error: '메일 설정을 불러오지 못했습니다(목).', sentTo: [], skipped: [] })
    expect(send).not.toHaveBeenCalled()
  })
```

'트랜스포트 미설정이면 그 사유를 그대로 올린다'(168–174행) — 목이 비동기가 됐으므로 `mockReturnValueOnce` 를 `mockResolvedValueOnce` 로.

old:
```ts
    getTransport.mockReturnValueOnce({ ok: false, error: '메일 발송이 설정되지 않았습니다.' } as never)
```

new:
```ts
    getTransport.mockResolvedValueOnce({ ok: false, error: '메일 발송이 설정되지 않았습니다.' })
```

나머지 사례(EAUTH·ETIMEDOUT 문구, 추가 이메일, 변경 안내)는 그대로 둔다 — 같은 문구가 이제 `smtpErrorMessage` 를 거쳐 나오는지를 그 사례들이 지킨다.

- [ ] **Step 2: 회의 안내 테스트가 실패하는지 본다**

Run: `npx vitest run tests/actions/meeting-notify-gate.test.ts`
Expected: FAIL — 액션이 아직 `resolveProjectId` 를 부르므로 거의 모든 사례가
`[vitest] No "resolveProjectId" export is defined on the "@/lib/authz" mock` 로 깨진다(가드 전 확정 실패 사례 포함).

- [ ] **Step 3: 초대 테스트를 새 계약으로 고친다(실패해야 한다)**

`tests/actions/project-invites-gate.test.ts` 의 `vi.hoisted` 안 `getTransport`(17행):

old:
```ts
    getTransport: vi.fn(() => ({ ok: true, send })),
```

new:
```ts
    // 비동기 — 초대의 워크스페이스 메일 설정(없으면 배포 env)으로 계정을 고른다
    getTransport: vi.fn<(opts: { workspaceId: string | null; fromName?: string }) => Promise<unknown>>(async () => ({ ok: true, send })),
```

'초대 제목과 발신 표시명에 워크스페이스 브랜딩을 쓴다'(507행):

old:
```ts
    expect(getTransport).toHaveBeenCalledWith('한빛 초대팀')
```

new:
```ts
    expect(getTransport).toHaveBeenCalledWith({ workspaceId: 'ws-1', fromName: '한빛 초대팀' })
```

'메일 발송이 실패해도 초대는 살아 있다' 사례 바로 뒤(`describe('createProjectInvite 성공 경로 …')` 의 마지막 `it` 다음, 그 describe 를 닫는 `})` 앞)에 두 사례를 더한다.

old:
```ts
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(res.row.id).toBe(INSERTED_ID)
    expect(res.url).toContain('/invite/')
  })
})
```

new:
```ts
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(res.row.id).toBe(INSERTED_ID)
    expect(res.url).toContain('/invite/')
  })

  // 워크스페이스 메일 설정 조회 실패·잘못된 설정·호스트 거부는 getTransport 가 ok:false 로 낸다 — 초대는 이미 유효하므로 살리고 문구만 올린다.
  it('트랜스포트를 쓸 수 없으면 초대는 살리고 그 문구를 mailError 로 — 발송은 시도하지 않는다', async () => {
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)
    getTransport.mockResolvedValueOnce({ ok: false, error: '메일 설정을 불러오지 못했습니다(목).' })
    const res = await createProjectInvite(P1, VALID)
    expect(res).toMatchObject({ ok: true, mailed: false, mailError: '메일 설정을 불러오지 못했습니다(목).' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(getTransport).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1' }))
    expect(send).not.toHaveBeenCalled()
  })

  it('EAUTH 는 자격증명을 싣지 않는 공용 문구로 바꾼다(smtpErrorMessage)', async () => {
    const { client } = createClient()
    createAdminClient.mockReturnValue(client as never)
    send.mockRejectedValue(Object.assign(new Error('535-5.7.8 Username and Password not accepted'), { code: 'EAUTH' }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createProjectInvite(P1, VALID)
    spy.mockRestore()
    expect(res).toMatchObject({ ok: true, mailed: false, mailError: '메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.' })
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(res.mailError).not.toContain('Password')
  })
})
```

(`beforeEach` 의 `getTransport.mockClear()` 는 그대로 둔다 — 구현(`async () => ({ ok: true, send })`)을 유지해야 다른 성공 사례가 산다. 위 `mockResolvedValueOnce` 는 그 사례 안에서 소비된다.)

- [ ] **Step 4: 초대 테스트가 실패하는지 본다**

Run: `npx vitest run tests/actions/project-invites-gate.test.ts`
Expected: FAIL — '초대 제목과 발신 표시명에 워크스페이스 브랜딩을 쓴다'(`getTransport` 가 `'한빛 초대팀'` 문자열로 불림),
그리고 목이 Promise 를 돌려주는데 액션이 `transport.ok` 를 동기로 읽어 `mailed: false, mailError: undefined` 가 되므로 `mailed: true` 를 기대하는 성공 경로 사례 전부와 새 두 사례.

- [ ] **Step 5: `meetingNotify.ts` — 범위를 함께 확정하고, 워크스페이스로 트랜스포트를 고른다**

`src/app/actions/meetingNotify.ts` import(3행·9행·19–20행):

old:
```ts
import { getActor, requireProjectAdmin, resolveProjectId } from '@/lib/authz'
```

new:
```ts
import { getActor, requireProjectAdmin, resolveScope } from '@/lib/authz'
```

old:
```ts
import { getTransport } from '@/lib/mail/transport'
```

new:
```ts
import { getTransport } from '@/lib/mail/transport'
import { smtpErrorMessage } from '@/lib/mail/errors'
```

old:
```ts
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'
```

new:
```ts
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'
```
(`ServerTranslate` 는 지울 `toUserMessage` 만 썼다 — 남기면 `@typescript-eslint/no-unused-vars` 경고.)

지역 오류 변환(33–41행)을 지운다 — 같은 변환이 `src/lib/mail/errors.ts` 의 `smtpErrorMessage` 한 곳에 있다(설계 §2.5).

old:
```ts
/** SMTP 원문 에러에는 계정·호스트 정보가 섞인다. 사용자에게는 사유만 전한다. */
function toUserMessage(tr: ServerTranslate, e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  if (code === 'EAUTH') return tr('err.mailAccountAuthenticationFailed')
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return tr('err.couldNotConnectMailServer')
  }
  return tr('err.errorOccurredWhileSendingMail')
}

/**
```

new:
```ts
/**
```

함수 머리(57–67행) — `resolveProjectId` → `resolveScope`, 프로젝트가 비면 가드 전에 멈춘다:

old:
```ts
  const tr = await serverTranslator()
  // 발송 대상 회의의 프로젝트를 먼저 확정한다 — 관리자 판정의 기준이 그 프로젝트다.
  const found = await resolveProjectId('meetings', meetingId)
  if (!found.ok) return { ok: false, error: found.error, ...NONE }
  const g = await requireProjectAdmin(found.projectId)
  let actor: Awaited<ReturnType<typeof getActor>> = null
  try { actor = g.ok ? g.actor : await getActor() } catch { actor = null }
  if (!g.ok && !actor) return { ok: false, error: g.error, ...NONE }
  if (!found.projectId) return { ok: false, error: ERR_LOOKUP, ...NONE }
  const mod = await requireModule({ projectId: found.projectId }, 'meetings')   // 스펙 §4.2 — 가드 뒤·입력 검증·발송 앞(P17)
  if (!mod.ok) return { ok: false, error: mod.error, ...NONE }
```

new:
```ts
  const tr = await serverTranslator()
  // 발송 대상 회의의 프로젝트·워크스페이스를 먼저 함께 확정한다 — 관리자 판정의 기준은 그 프로젝트, 발송 계정의 기준은
  // 그 워크스페이스의 메일 설정이다. 못 읽으면 가드 전에 멈춘다(3원칙 ② — 워크스페이스를 모른 채 env 계정으로 보내지 않는다).
  const scope = await resolveScope('meetings', meetingId)
  if (!scope.ok) return { ok: false, error: scope.error, ...NONE }
  if (!scope.projectId) return { ok: false, error: ERR_LOOKUP, ...NONE }
  const projectId = scope.projectId
  const g = await requireProjectAdmin(projectId)
  let actor: Awaited<ReturnType<typeof getActor>> = null
  try { actor = g.ok ? g.actor : await getActor() } catch { actor = null }
  if (!g.ok && !actor) return { ok: false, error: g.error, ...NONE }
  const mod = await requireModule({ projectId }, 'meetings')   // 스펙 §4.2 — 가드 뒤·입력 검증·발송 앞(P17)
  if (!mod.ok) return { ok: false, error: mod.error, ...NONE }
```

범주·발신 표시명·트랜스포트(95–106행) — 발신 표시명을 프로젝트 설정 조회에서 떼어 범위의 워크스페이스로 읽는다
(`loadDisplayBranding` 은 throw 하지 않고 실패하면 기본 이름으로 내리며 로그를 남긴다):

old:
```ts
  let fromName: string | undefined
  // 메일의 '구분' = 그 프로젝트의 회의 범주 라벨(설정, B4). 못 읽으면 code 를 쓴다(메일 발송을 막지 않는다 — 로그만)
  let categories: VocabValues['meetings.categories'] = []
  try {
    const project = await getProjectConfig(found.projectId)
    const cats = pick(project, 'meetings.categories')
    if (cats.ok) categories = cats.value
    else console.error('[notifyMeetingSaved] 회의 범주 설정 손상 — 메일 구분은 code:', cats.error)
    fromName = (await loadDisplayBranding(project.workspaceId)).mailFromName
  } catch (error) { console.error('[notifyMeetingSaved] 브랜딩·범주 조회 실패:', error) }
  const transport = getTransport(fromName)
  if (!transport.ok) return { ok: false, error: transport.error, sentTo: [], skipped }
```

new:
```ts
  // 메일의 '구분' = 그 프로젝트의 회의 범주 라벨(설정, B4). 못 읽으면 code 를 쓴다(메일 발송을 막지 않는다 — 로그만)
  let categories: VocabValues['meetings.categories'] = []
  try {
    const cats = pick(await getProjectConfig(projectId), 'meetings.categories')
    if (cats.ok) categories = cats.value
    else console.error('[notifyMeetingSaved] 회의 범주 설정 손상 — 메일 구분은 code:', cats.error)
  } catch (error) { console.error('[notifyMeetingSaved] 범주 조회 실패:', error) }
  // 발신 표시명은 회의가 속한 워크스페이스의 브랜딩 — 못 읽으면 loadDisplayBranding 이 기본 이름으로 내린다(로그는 그쪽)
  const fromName = (await loadDisplayBranding(scope.workspaceId)).mailFromName
  // 발송 계정: 그 워크스페이스의 메일 설정 → 배포 env → 미설정. 조회 실패·보관·잘못된 설정은 ok:false 문구로 온다(transport.ts)
  const transport = await getTransport({ workspaceId: scope.workspaceId, fromName })
  if (!transport.ok) return { ok: false, error: transport.error, sentTo: [], skipped }
```

발송 실패 문구(139–142행):

old:
```ts
    console.error(`[notifyMeetingSaved:${kind}] 발송 실패:`, e)
    return { ok: false, error: toUserMessage(tr, e), sentTo: [], skipped }
```

new:
```ts
    console.error(`[notifyMeetingSaved:${kind}] 발송 실패:`, e)
    return { ok: false, error: smtpErrorMessage(tr, e), sentTo: [], skipped }
```

남는 `found` 참조가 없어야 한다: `grep -n "found\b\|resolveProjectId\|toUserMessage" src/app/actions/meetingNotify.ts` → 출력 없음.

- [ ] **Step 6: 회의 안내 테스트 통과 확인**

Run: `npx vitest run tests/actions/meeting-notify-gate.test.ts`
Expected: PASS(기존 24건 + 새 3건 = 27건 — 확정 실패 둘은 바뀐 이름, '범위는 읽었지만…'·'트랜스포트는 회의가 속한…'·'워크스페이스 메일 설정을 쓸 수 없으면…' 이 새 사례).
EAUTH·ETIMEDOUT 사례가 초록이면 `smtpErrorMessage`(test 옵션 없음)가 옛 문구를 그대로 낸다는 뜻이다.

- [ ] **Step 7: `projectInvites.ts` `sendInviteMail` — 초대의 워크스페이스로 트랜스포트를 고른다**

`src/app/actions/projectInvites.ts` import(11행):

old:
```ts
import { getTransport } from '@/lib/mail/transport'
```

new:
```ts
import { getTransport } from '@/lib/mail/transport'
import { smtpErrorMessage } from '@/lib/mail/errors'
```

(`ServerTranslate` import 는 그대로 둔다 — `domainError` 가 쓴다.)

지역 오류 변환(110–118행)을 지운다:

old:
```ts
/** SMTP 원문 에러에는 계정·호스트 정보가 섞인다(meetingNotify 와 같은 이유). */
function toMailMessage(tr: ServerTranslate, e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  if (code === 'EAUTH') return tr('err.mailAccountAuthenticationFailed')
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return tr('err.couldNotConnectMailServer')
  }
  return tr('err.errorOccurredWhileSendingMail')
}

type RawInvite = {
```

new:
```ts
type RawInvite = {
```

`sendInviteMail` 의 트랜스포트(368–370행):

old:
```ts
  const branding = await loadDisplayBranding(i.workspaceId, admin)
  const transport = getTransport(branding.mailFromName)
  if (!transport.ok) return { mailed: false, mailError: transport.error }
```

new:
```ts
  const branding = await loadDisplayBranding(i.workspaceId, admin)
  // 발송 계정: 초대의 워크스페이스 메일 설정 → 배포 env → 미설정. 조회 실패·잘못된 설정·호스트 거부도 ok:false 문구로 온다 —
  // 초대는 이미 저장돼 유효하므로 발급을 되돌리지 않고 mailError 로만 올린다.
  const transport = await getTransport({ workspaceId: i.workspaceId, fromName: branding.mailFromName })
  if (!transport.ok) return { mailed: false, mailError: transport.error }
```

발송 실패 문구(401–404행):

old:
```ts
    console.error('[createProjectInvite] 메일 발송 실패:', e)
    return { mailed: false, mailError: toMailMessage(tr, e) }
```

new:
```ts
    console.error('[createProjectInvite] 메일 발송 실패:', e)
    return { mailed: false, mailError: smtpErrorMessage(tr, e) }
```

확인: `grep -n "toMailMessage\|getTransport(" src/app/actions/projectInvites.ts` → `getTransport({ workspaceId: i.workspaceId, …` 한 줄만.

- [ ] **Step 8: 초대 테스트 통과 확인**

Run: `npx vitest run tests/actions/project-invites-gate.test.ts`
Expected: PASS(기존 55건 + 새 2건 = 57건). '메일 발송이 실패해도 초대는 살아 있다'('메일 발송 중 오류가 발생했습니다.')와 새 EAUTH 사례가
`smtpErrorMessage` 의 기본·인증 갈래를 지킨다.

- [ ] **Step 9: 불변식·게이트가 그대로 초록인지 확인한다**

이 변경이 닿을 수 있는 검사와 그 이유:
- `tests/gates/manifest.ts` — 두 액션의 항목은 **바꾸지 않는다.** `notifyMeetingSaved` 는
  `{ guard: 'projectAdmin', module: 'meetings', note: '관리자 또는 주최자', sample: [U, 'created', []], ownerBranch: … }`(162행),
  `createProjectInvite` 는 `nul('projectAdmin')`(228행) 그대로 맞다 — 가드·모듈 관문·인자 모양이 같다. 하네스 목(`tests/gates/_harness.ts` 70행)이
  이미 `resolveScope: vi.fn(async () => ({ ok: true, projectId: P, workspaceId: W }))` 를 내므로 가드 호출 수(`guardCalls() > 0`)도 유지된다.
  `ownerBranch` 경로는 모듈을 끄면 `requireModule` 에서 돌아가므로 `getTransport` 에 닿지 않는다(실제 SMTP 연결 없음).
- `tests/gates/deny.test.ts`·`tests/gates/enumerate.test.ts` — 위 두 항목의 가드 거부·관문·표 열거. 새 `.from()`·`.rpc()` 가 없으므로
  `tests/gates/_rpc-tables.ts` 갱신도 없다.
- `tests/invariants/no-raw-db-errors.test.ts` — 33행의 허용 이름 목록에 `resolveScope` 가 이미 있다.
- `tests/invariants/i18n-server-messages.test.ts` — 새 `error:`·`mailError:` 값이 모두 변수(`scope.error`·`transport.error`·`smtpErrorMessage(…)`)다.
- `tests/invariants/use-server-exports.test.ts` — 두 `'use server'` 파일의 export 는 그대로다(지운 두 함수는 export 가 아니었다).
- `tests/invariants/admin-scope.test.ts`·`docs/sp2-admin-client-audit.md` — `createAdminClient` 호출 자리가 바뀌지 않는다(트랜스포트의 설정 조회는 Task 4 가 `adminFor` 로 한다).
- `tests/settings/operational-env.test.ts` — 두 파일이 읽는 env(`NEXT_PUBLIC_APP_URL`·`VERCEL_PROJECT_PRODUCTION_URL`)는 그대로, `SMTP_*` 를 새로 읽지 않는다.
- `tests/ui/meeting-form-announce.test.tsx`·`tests/components/project-invite-manager.test.tsx` — 액션을 통째로 목하므로 영향 없음(아래 재실행 목록에 넣어 확인).

Run:
```bash
npx vitest run tests/actions/meeting-notify-gate.test.ts tests/actions/project-invites-gate.test.ts \
  tests/gates/deny.test.ts tests/gates/enumerate.test.ts tests/gates/rpc-tables.test.ts \
  tests/invariants/no-raw-db-errors.test.ts tests/invariants/i18n-server-messages.test.ts \
  tests/invariants/use-server-exports.test.ts tests/invariants/admin-scope.test.ts \
  tests/settings/operational-env.test.ts tests/mail/transport.test.ts \
  tests/ui/meeting-form-announce.test.tsx tests/components/project-invite-manager.test.tsx
```
Expected: 모두 PASS.

Run: `npm run typecheck`
Expected: 오류 0 — Task 4 뒤로 남아 있던 두 호출처의 `getTransport(string)` 형 오류(`TS2559`/`TS2345`)와 `Promise` 에 `.ok` 를 읽는 오류가 사라진다.

Run: `npx eslint src/app/actions/meetingNotify.ts src/app/actions/projectInvites.ts tests/actions/meeting-notify-gate.test.ts tests/actions/project-invites-gate.test.ts`
Expected: 오류·경고 0(특히 `ServerTranslate` 미사용 import 가 meetingNotify 에 남지 않았는지).

- [ ] **Step 10: 커밋**

UI 위험 파일·마이그레이션이 없으므로 `main` 직행 커밋이며 G1·G2·G4 트레일러가 필요 없다.

```bash
git add src/app/actions/meetingNotify.ts src/app/actions/projectInvites.ts \
  tests/actions/meeting-notify-gate.test.ts tests/actions/project-invites-gate.test.ts
git commit -m "$(cat <<'MSG'
회의 안내·초대 메일이 워크스페이스 메일 설정으로 나가게 — 발송 계정의 기준을 그 워크스페이스로 못박는다

회의 안내는 워크스페이스를 프로젝트 설정 조회에서 얻어, 그 조회가 실패하면 어느 계정으로 보낼지 몰랐다.
맨 앞의 범위 확정을 resolveScope 로 바꿔 프로젝트·워크스페이스를 함께 읽고, 못 읽으면 가드 전에 멈춘다(3원칙 ②).
초대는 이미 아는 workspaceId 를 넘긴다. 두 곳에 같은 꼴로 있던 SMTP 오류 문구 변환은 smtpErrorMessage 한 곳을 쓴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

**끝에 다시 돌릴 기존 테스트:** `tests/actions/meeting-notify-gate.test.ts`, `tests/actions/project-invites-gate.test.ts`, `tests/gates/deny.test.ts`,
`tests/gates/enumerate.test.ts`, `tests/gates/rpc-tables.test.ts`, `tests/invariants/no-raw-db-errors.test.ts`, `tests/invariants/i18n-server-messages.test.ts`,
`tests/invariants/use-server-exports.test.ts`, `tests/invariants/admin-scope.test.ts`, `tests/settings/operational-env.test.ts`, `tests/mail/transport.test.ts`,
`tests/ui/meeting-form-announce.test.tsx`, `tests/components/project-invite-manager.test.tsx` — 그리고 `npm run typecheck`.

---

### Task 6: 메일 설정 서버 액션 · 열거 게이트 매니페스트

설계 §3. 네 액션(`getWorkspaceMailSettings`·`saveWorkspaceMailSettings`·`deleteWorkspaceMailSettings`·`sendWorkspaceTestMail`)을 `src/app/actions/mailSettings.ts` 에 만든다.
선행 작업: Task 2(`src/lib/mail/settingsInput.ts`)·Task 3(`src/lib/mail/workspaceSmtp.ts`)·Task 4(`transport.ts` 의 `resolveMailStatus`·`transportFromSettings`·`MAIL_SETTINGS_UNAVAILABLE`·`MAIL_HOST_NOT_ALLOWED`, `src/lib/mail/errors.ts` 의 `smtpErrorMessage`).

**Files:**
- Create: `src/app/actions/mailSettings.ts`
- Create: `tests/actions/mail-settings-gate.test.ts`
- Modify: `src/lib/i18n/dict/serverUi.ts` (`// src/app/actions/mailSettings.ts` 묶음 — `srv.mailSettings.*` 키 열한 개)
- Modify: `tests/gates/manifest.ts` (네 항목)
- Test(다시 돌림): `tests/gates/enumerate.test.ts`, `tests/gates/deny.test.ts`, `tests/invariants/admin-scope.test.ts`, `tests/invariants/use-server-exports.test.ts`,
  `tests/invariants/i18n-server-messages.test.ts`, `tests/invariants/settings-writes.test.ts`, `tests/invariants/rpc-actor-source.test.ts`,
  `tests/authz/guard-signatures.test.ts`, `tests/settings/operational-env.test.ts`

이 작업이 지키는 불변식(코드를 쓸 때 확인한 것):
- `tests/invariants/admin-scope.test.ts` — `createAdminClient` 라는 **낱말이 파일 원문에 있으면**(주석 포함) 감사표 행이 필요하다. 이 액션은 `adminFor({ workspaceId })` 만 쓰고
  형은 `import type { AdminClient } from '@/lib/supabase/adminFor'` 로 적는다 — 파일·주석 어디에도 그 낱말을 쓰지 않는다. 그래서 `docs/sp2-admin-client-audit.md` 는 손대지 않는다.
- `tests/invariants/use-server-exports.test.ts` — `'use server'` 파일은 `export async function` 과 `export type`/`export interface` 만. 상수·도우미는 export 하지 않는다.
- `tests/invariants/i18n-server-messages.test.ts` — `error:` 값에 한국어 리터럴 금지. 모든 문구는 `tr('…')`(serverUi·공용 사전 키) 또는 `transport.ts` 의 상수(식별자라 검사 대상 아님).
  같은 검사가 "서버 키와 공용 키는 겹치지 않는다"를 본다 — 서버 키는 `srv.mailSettings.*`, 공용 키(Task 2·7)는 `mailSettings.*` 라 겹치지 않는다.
- `tests/invariants/settings-writes.test.ts` — 설정 4표의 이름을 이 파일에 쓰지 않는다(브랜딩은 `loadDisplayBranding` 이 읽는다).
- `tests/settings/operational-env.test.ts` — 이 파일은 `process.env` 를 읽지 않는다(env 판정은 `resolveMailStatus` 안).
- `tests/invariants/rpc-actor-source.test.ts`·`tests/gates/_rpc-tables.ts` — RPC 를 부르지 않으므로 대상 아님.
- `tests/authz/guard-signatures.test.ts` — 가드 시그니처를 바꾸지 않는다(`requireWorkspaceAdmin(wid)` 호출만).
- CLAUDE.md "액션에 `role === '...'` 을 직접 적지 않는다" — 설정자 관리자 판정은 `isWorkspaceAdminRole`(`src/lib/domain/authz.ts`)로.
- `tests/gates/deny.test.ts` — 가드 거부 응답에 `ERR_DENIED` 가 실려야 한다(`{ ok: false, error: g.error }` 그대로). 가드 앞 검증은 `SAFE_ID_RE` 뿐이라 하네스의 `W`='ws-1' 이 가드에 닿는다.
  가드 통과 실행(null 항목)에서 `[W, {}]` 는 `normalizeMailSettingsInput` 에서 멈춰 SMTP 연결을 시도하지 않는다. 만지는 표(`workspace_mail_settings`·`profiles`·`workspace_members`)는
  `tests/gates/_tables.ts` 의 `MODULE_TABLE_OWNER` 에 없다(토글 모듈 소유가 아니다) — `NULL_TABLE_ALLOW` 추가 불필요.
- 비밀번호는 응답·로그·오류 어디에도 싣지 않는다. DB 오류는 `code`·`message` 만 로그한다(`details` 에는 23514 때 행 값 — 비밀번호 포함 — 이 실린다). SMTP 오류는 `code`·`responseCode` 만.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — `tests/actions/mail-settings-gate.test.ts`**

`tests/actions/project-invites-gate.test.ts` 의 모킹 관례(vi.hoisted 스파이 → vi.mock → 가드를 순수 판정 `workspaceAdminVerdict` 에 위임)를 따른다.
`adminFor` 는 **함정(throw) 대신 호출 여부로** 본다 — 이 액션은 `adminFor` 의 throw 를 오류 결과로 바꾸므로 함정 throw 는 삼켜져 단언이 무력해진다.
`settingsInput`·`rowToSmtpEnv`·`resolveSmtpSettings`·`smtpErrorMessage` 는 진짜를 쓰고(판정 한 벌을 그대로 지나는지 본다), DB·DNS·SMTP·세션·브랜딩만 목으로 바꾼다.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 가드 · adminFor · 세션 · 메일 설정 행/DNS · 트랜스포트 · 브랜딩 모킹(tests/actions/project-invites-gate.test.ts 관례).
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const h = vi.hoisted(() => {
  const send = vi.fn()
  return {
    requireWorkspaceAdmin: vi.fn(),
    adminFor: vi.fn(),
    getSession: vi.fn(),
    loadWorkspaceMailRow: vi.fn(),
    vetMailHost: vi.fn(),
    resolveMailStatus: vi.fn(),
    transportFromSettings: vi.fn((..._a: unknown[]) => ({ ok: true as const, send })),
    send,
    loadDisplayBranding: vi.fn(async (..._a: unknown[]) => ({ productName: 'D-Flow', mailFromName: '우리 팀 메일' })),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.requireWorkspaceAdmin }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
// 행 매핑(rowToSmtpEnv)은 진짜 — 행 조회·DNS 만 목
vi.mock('@/lib/mail/workspaceSmtp', async (orig) => ({
  ...(await orig<typeof import('@/lib/mail/workspaceSmtp')>()),
  loadWorkspaceMailRow: h.loadWorkspaceMailRow,
  vetMailHost: h.vetMailHost,
}))
// 검증(resolveSmtpSettings)·문구 상수는 진짜 — 상태 판정과 nodemailer 구성만 목
vi.mock('@/lib/mail/transport', async (orig) => ({
  ...(await orig<typeof import('@/lib/mail/transport')>()),
  resolveMailStatus: h.resolveMailStatus,
  transportFromSettings: h.transportFromSettings,
}))
vi.mock('@/lib/settings/displayBranding', () => ({ loadDisplayBranding: h.loadDisplayBranding }))

import { revalidatePath } from 'next/cache'
import {
  getWorkspaceMailSettings, saveWorkspaceMailSettings, deleteWorkspaceMailSettings, sendWorkspaceTestMail,
} from '@/app/actions/mailSettings'
import { reasonKey, type MailSettingsInput } from '@/lib/mail/settingsInput'
import type { WorkspaceMailRow } from '@/lib/mail/workspaceSmtp'
import { MAIL_HOST_NOT_ALLOWED, MAIL_SETTINGS_UNAVAILABLE } from '@/lib/mail/transport'
import { smtpErrorMessage } from '@/lib/mail/errors'
import { serverKoTranslate } from '@/lib/i18n/serverDict'
import { workspaceAdminVerdict, type Actor } from '@/lib/domain/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, WS } from '../fixtures/actor'

const ADMIN = makeActor({ userId: 'u-admin', workspaceRoles: new Map([[WS, 'admin']]) })
const MEMBER = makeActor({ userId: 'u-member' })   // WS 의 member — 워크스페이스 관리자 아님
const PASSWORD_REQUIRED = serverKoTranslate(reasonKey('password_required'))
const ME = 'me@acme.com'

/** 가드를 이 액터의 순수 판정(workspaceAdminVerdict)에 위임한다 — 실제 가드와 같은 404/403 구분 */
function signedInAs(a: Actor) {
  h.requireWorkspaceAdmin.mockImplementation(async (wid: string | null) => {
    const v = workspaceAdminVerdict(a, wid)
    return v === 'ok' ? { ok: true, actor: a } : { ok: false, error: v === 'missing' ? ERR_MISSING : ERR_DENIED }
  })
}

type QueryResult = { data: unknown; error: { code?: string; message: string } | null }
interface Chain {
  select: (...a: unknown[]) => Chain
  eq: (...a: unknown[]) => Chain
  maybeSingle: () => Promise<QueryResult>
  then: (res: (v: QueryResult) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>
}
/** PostgREST 빌더 흉내 — 체이닝은 자신을, await 는 결과를. 부른 메서드·인자를 calls 에 쌓는다 */
function chainOf(result: QueryResult, calls: unknown[][]): Chain {
  const chain: Chain = {
    select: (...a) => { calls.push(['select', ...a]); return chain },
    eq: (...a) => { calls.push(['eq', ...a]); return chain },
    maybeSingle: async () => result,
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  }
  return chain
}

/** 액션이 만지는 세 표만 아는 가짜 service_role 클라이언트 */
function makeAdmin(o: { profile?: QueryResult; member?: QueryResult; write?: QueryResult; upsert?: QueryResult } = {}) {
  const calls = { upsert: [] as unknown[][], update: [] as unknown[][], delete: [] as unknown[][], profiles: [] as unknown[][], members: [] as unknown[][] }
  const upsert = vi.fn((..._a: unknown[]) => chainOf(o.upsert ?? { data: null, error: null }, calls.upsert))
  const update = vi.fn((..._a: unknown[]) => chainOf(o.write ?? { data: [{ workspace_id: WS }], error: null }, calls.update))
  const del = vi.fn(() => chainOf(o.write ?? { data: [{ workspace_id: WS }], error: null }, calls.delete))
  const from = vi.fn((table: string) => {
    if (table === 'workspace_mail_settings') return { upsert, update, delete: del }
    if (table === 'profiles') return chainOf(o.profile ?? { data: { display_name: '김설정' }, error: null }, calls.profiles)
    if (table === 'workspace_members') return chainOf(o.member ?? { data: { role: 'admin' }, error: null }, calls.members)
    throw new Error('예상치 못한 표 접근: ' + table)
  })
  const client = { from }
  h.adminFor.mockImplementation((s: { workspaceId: string }) => ({ ...s, admin: client }))
  return { client, from, upsert, update, del, calls }
}

const storedRow = (over: Partial<WorkspaceMailRow> = {}): WorkspaceMailRow => ({
  workspace_id: WS, preset: 'custom', host: 'smtp.acme.com', port: 587, secure: false,
  username: 'mailer@acme.com', password: 'stored-secret', from_address: null,
  password_set_by: 'u-setter', password_set_at: '2026-10-01T00:00:00.000Z',
  updated_by: 'u-setter', updated_at: '2026-10-01T00:00:00.000Z', ...over,
})
const CUSTOM: MailSettingsInput = { preset: 'custom', host: 'smtp.acme.com', port: 587, secure: false, username: 'mailer@acme.com', password: 'new-secret' }
const GMAIL: MailSettingsInput = { preset: 'gmail', address: 'sender@gmail.com', password: 'abcd efgh ijkl mnop' }

beforeEach(() => {
  for (const f of [h.requireWorkspaceAdmin, h.adminFor, h.getSession, h.loadWorkspaceMailRow, h.vetMailHost, h.resolveMailStatus, h.send]) f.mockReset()
  h.transportFromSettings.mockClear()
  h.loadDisplayBranding.mockClear()
  vi.mocked(revalidatePath).mockClear()
  signedInAs(ADMIN)
  h.getSession.mockResolvedValue({ id: 'u-admin', email: ME, user_metadata: {} })
  h.vetMailHost.mockResolvedValue({ ok: true, address: '203.0.113.10' })
  h.resolveMailStatus.mockResolvedValue({ source: 'workspace', valid: true, fromAddress: 'mailer@acme.com' })
  h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'none' })
  h.send.mockResolvedValue({ rejected: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('메일 설정 액션 — 가드와 범위', () => {
  it('워크스페이스 관리자가 아니면 네 액션 모두 거부 — adminFor·세션·DNS·트랜스포트 미도달', async () => {
    signedInAs(MEMBER)
    const results = await Promise.all([
      getWorkspaceMailSettings(WS), saveWorkspaceMailSettings(WS, CUSTOM),
      deleteWorkspaceMailSettings(WS), sendWorkspaceTestMail(WS, CUSTOM),
    ])
    for (const r of results) expect(r).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.adminFor).not.toHaveBeenCalled()
    expect(h.getSession).not.toHaveBeenCalled()
    expect(h.vetMailHost).not.toHaveBeenCalled()
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('워크스페이스 id 형식이 아니면 가드 앞에서 거부한다(SAFE_ID_RE)', async () => {
    const bad = serverKoTranslate('err.invalidWorkspace')
    expect(await getWorkspaceMailSettings('a/b')).toEqual({ ok: false, error: bad })
    expect(await deleteWorkspaceMailSettings(42 as unknown as string)).toEqual({ ok: false, error: bad })
    expect(h.requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(h.adminFor).not.toHaveBeenCalled()
  })

  it('adminFor 가 throw 하면(uuid 아님) 던지지 않고 조회 실패 문구로 돌려준다', async () => {
    h.adminFor.mockImplementation(() => { throw new Error('adminFor: 스코프 id 가 올바르지 않다') })
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await saveWorkspaceMailSettings(WS, CUSTOM)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await sendWorkspaceTestMail(WS, CUSTOM)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
  })

  it('입력이 형식부터 틀리면 adminFor 를 만들지 않는다(가드 → 검증 → 범위 클라이언트)', async () => {
    expect((await saveWorkspaceMailSettings(WS, {} as MailSettingsInput)).ok).toBe(false)
    expect((await sendWorkspaceTestMail(WS, {} as MailSettingsInput)).ok).toBe(false)
    expect(h.adminFor).not.toHaveBeenCalled()
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })
})
```
```ts
describe('getWorkspaceMailSettings — 보기·상태·비밀번호 설정자', () => {
  it('저장된 행이 없으면 settings null · 설정자 세 칸 null, 상태는 resolveMailStatus 그대로', async () => {
    makeAdmin()
    h.resolveMailStatus.mockResolvedValue({ source: 'none' })
    expect(await getWorkspaceMailSettings(WS)).toEqual({
      ok: true, settings: null, status: { source: 'none' }, passwordSetBy: null, passwordSetAt: null, passwordSetterIsAdmin: null,
    })
    expect(h.resolveMailStatus).toHaveBeenCalledWith(WS)
    expect(h.adminFor).toHaveBeenCalledWith({ workspaceId: WS })
  })

  it('행이 있으면 비밀번호를 뺀 보기 + 설정자 이름·시각·관리자 여부 — 응답 어디에도 비밀번호가 없다', async () => {
    const a = makeAdmin()
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ from_address: 'noreply@acme.com' }) })
    const r = await getWorkspaceMailSettings(WS)
    expect(r).toEqual({
      ok: true,
      settings: { preset: 'custom', host: 'smtp.acme.com', port: 587, secure: false, username: 'mailer@acme.com', fromAddress: 'noreply@acme.com', hasPassword: true },
      status: { source: 'workspace', valid: true, fromAddress: 'mailer@acme.com' },
      passwordSetBy: '김설정', passwordSetAt: '2026-10-01T00:00:00.000Z', passwordSetterIsAdmin: true,
    })
    expect(JSON.stringify(r)).not.toContain('stored-secret')
    expect(h.loadWorkspaceMailRow).toHaveBeenCalledWith(a.client, WS)
    // 관리자 여부는 이 워크스페이스의 그 사람 소속 행으로
    expect(a.calls.members).toContainEqual(['eq', 'workspace_id', WS])
    expect(a.calls.members).toContainEqual(['eq', 'user_id', 'u-setter'])
  })

  it('설정자가 더 이상 관리자가 아니면 false, 소속이 없어도 false, 조회 실패면 unknown', async () => {
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    makeAdmin({ member: { data: { role: 'member' }, error: null } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetterIsAdmin: false })
    makeAdmin({ member: { data: null, error: null } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetterIsAdmin: false })
    makeAdmin({ member: { data: null, error: { message: 'boom' } } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetterIsAdmin: 'unknown' })
  })

  it('설정자 계정이 지워졌으면(password_set_by null) 삭제된 계정·false, 이름 조회 실패는 확인 불가 문구', async () => {
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ password_set_by: null }) })
    makeAdmin()
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({
      ok: true, passwordSetBy: serverKoTranslate('srv.mailSettings.setterDeleted'), passwordSetterIsAdmin: false,
    })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    makeAdmin({ profile: { data: null, error: { message: 'boom' } } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetBy: serverKoTranslate('srv.mailSettings.setterUnavailable') })
  })

  it('행 조회 실패·보관 응답·상태 판정 실패는 조회 실패 — 미설정으로 위장하지 않는다', async () => {
    makeAdmin()
    h.loadWorkspaceMailRow.mockRejectedValue(new Error('db down'))
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'archived' })
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'none' })
    h.resolveMailStatus.mockResolvedValue({ error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
  })
})

describe('saveWorkspaceMailSettings — 새 비밀번호·유지·재사용 거부', () => {
  it('Gmail 새 비밀번호 — 고정 서버값, 공백 지운 비밀번호, 설정자·설정 시각·수정자를 이 관리자로 upsert', async () => {
    const a = makeAdmin()
    expect(await saveWorkspaceMailSettings(WS, GMAIL)).toEqual({ ok: true })
    expect(a.upsert).toHaveBeenCalledTimes(1)
    const [payload, opts] = a.upsert.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(payload).toMatchObject({
      workspace_id: WS, preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true,
      username: 'sender@gmail.com', password: 'abcdefghijklmnop', from_address: null,
      password_set_by: 'u-admin', updated_by: 'u-admin',
    })
    expect(typeof payload.password_set_at).toBe('string')
    expect(payload.password_set_at).toBe(payload.updated_at)
    expect(opts).toEqual({ onConflict: 'workspace_id' })
    expect(h.loadWorkspaceMailRow).not.toHaveBeenCalled()   // 새 비밀번호면 저장값을 읽을 필요가 없다
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'page')
  })

  it('비밀번호 빈칸 + 같은 host·username(대소문자·끝 점만 다름) — 비밀번호·설정자 칸을 건드리지 않는 update', async () => {
    const a = makeAdmin()
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    const r = await saveWorkspaceMailSettings(WS, { ...CUSTOM, host: 'SMTP.Acme.com.', username: ' Mailer@Acme.com ', password: '' })
    expect(r).toEqual({ ok: true })
    expect(a.upsert).not.toHaveBeenCalled()
    expect(a.update).toHaveBeenCalledTimes(1)
    const payload = a.update.mock.calls[0]![0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('password')
    expect(payload).not.toHaveProperty('password_set_by')
    expect(payload).not.toHaveProperty('password_set_at')
    expect(payload).toMatchObject({ host: 'smtp.acme.com', updated_by: 'u-admin' })
    // 읽은 뒤 다른 관리자가 서버·계정을 바꿨으면 0행이 되게 저장값으로 조건을 건다
    expect(a.calls.update).toContainEqual(['eq', 'workspace_id', WS])
    expect(a.calls.update).toContainEqual(['eq', 'host', 'smtp.acme.com'])
    expect(a.calls.update).toContainEqual(['eq', 'username', 'mailer@acme.com'])
    expect(a.calls.update).toContainEqual(['select', 'workspace_id'])
  })

  it('유지 저장이 0행이면(그 사이 바뀜) 비밀번호를 다시 입력하게 한다', async () => {
    makeAdmin({ write: { data: [], error: null } })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, password: '' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })
  })

  it('재사용 거부 — 저장 행 없음 / 직접 입력→Gmail 같은 주소 / Gmail→직접 입력 다른 host. 아무것도 쓰지 않는다', async () => {
    const a = makeAdmin()
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, password: '' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })

    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ username: 'sender@gmail.com' }) })
    expect(await saveWorkspaceMailSettings(WS, { preset: 'gmail', address: 'sender@gmail.com', password: '' }))
      .toEqual({ ok: false, error: PASSWORD_REQUIRED })

    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'sender@gmail.com' }) })
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, username: 'sender@gmail.com', password: '' }))
      .toEqual({ ok: false, error: PASSWORD_REQUIRED })

    expect(a.upsert).not.toHaveBeenCalled()
    expect(a.update).not.toHaveBeenCalled()
  })

  it('입력 검증 실패는 사유 문구, 저장 실패는 고정 문구(DB 원문을 싣지 않는다)', async () => {
    makeAdmin({ upsert: { data: null, error: { code: '23514', message: 'violates check constraint' } } })
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, port: 8025 })).toEqual({ ok: false, error: serverKoTranslate(reasonKey('port_invalid')) })
    const r = await saveWorkspaceMailSettings(WS, CUSTOM)
    expect(r).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.saveFailed') })
    expect(JSON.stringify(r)).not.toContain('constraint')
  })
})

describe('deleteWorkspaceMailSettings', () => {
  it('그 워크스페이스 행만 지우고 영향 행으로 결과를 정한다 — 0행이면 지울 설정이 없다', async () => {
    const a = makeAdmin()
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: true })
    expect(a.calls.delete).toEqual([['eq', 'workspace_id', WS], ['select', 'workspace_id']])
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'page')

    makeAdmin({ write: { data: [], error: null } })
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.nothingToDelete') })
    makeAdmin({ write: { data: null, error: { message: 'boom' } } })
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.deleteFailed') })
  })
})

describe('sendWorkspaceTestMail — 저장 전 값으로 본인에게만', () => {
  it('수신자는 로그인한 본인 — 입력에 다른 주소가 섞여도 무시. 저장 전 폼 값·워크스페이스 발신 표시명·검사한 IP 로 보낸다', async () => {
    const a = makeAdmin()
    const input = { ...CUSTOM, host: 'smtp.new-acme.com', to: 'evil@example.com' } as MailSettingsInput
    const r = await sendWorkspaceTestMail(WS, input)
    expect(r).toEqual({ ok: true, to: ME })
    expect(h.vetMailHost).toHaveBeenCalledWith('smtp.new-acme.com')
    expect(h.transportFromSettings).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.new-acme.com', port: 587, secure: false, auth: { user: 'mailer@acme.com', pass: 'new-secret' }, fromAddress: 'mailer@acme.com' }),
      { fromName: '우리 팀 메일', connectTo: '203.0.113.10' },
    )
    expect(h.loadDisplayBranding).toHaveBeenCalledWith(WS, a.client)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0]![0]).toMatchObject({ to: [ME], replyTo: null })
    expect(h.loadWorkspaceMailRow).not.toHaveBeenCalled()   // 새 비밀번호 — 저장값을 읽지 않는다
    expect(a.upsert).not.toHaveBeenCalled()                  // 테스트 발송은 저장하지 않는다
    expect(JSON.stringify(r)).not.toContain('new-secret')
  })

  it('비밀번호 빈칸이면 같은 재사용 규칙 — 같은 host·username 이면 저장 비밀번호로 보내고, 아니면 거부', async () => {
    makeAdmin()
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    expect(await sendWorkspaceTestMail(WS, { ...CUSTOM, password: '' })).toEqual({ ok: true, to: ME })
    expect(h.transportFromSettings.mock.calls[0]![0]).toMatchObject({ auth: { user: 'mailer@acme.com', pass: 'stored-secret' } })

    h.transportFromSettings.mockClear()
    expect(await sendWorkspaceTestMail(WS, { ...CUSTOM, host: 'smtp.other.com', password: '' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('본인 메일 주소를 모르면 거부 — DNS·트랜스포트 미도달', async () => {
    makeAdmin()
    h.getSession.mockResolvedValue({ id: 'u-admin', email: undefined, user_metadata: {} })
    expect(await sendWorkspaceTestMail(WS, CUSTOM)).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.testNoRecipient') })
    expect(h.vetMailHost).not.toHaveBeenCalled()
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('서버 주소가 사설·예약 대역으로 풀리면 MAIL_HOST_NOT_ALLOWED — 연결하지 않는다', async () => {
    makeAdmin()
    h.vetMailHost.mockResolvedValue({ ok: false })
    expect(await sendWorkspaceTestMail(WS, CUSTOM)).toEqual({ ok: false, error: MAIL_HOST_NOT_ALLOWED })
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('발송 오류는 smtpErrorMessage(test) 문구 — SMTP 원문·비밀번호를 싣지 않는다', async () => {
    makeAdmin()
    const err = Object.assign(new Error('535 bad credentials for mailer@acme.com / new-secret'), { code: 'EAUTH', responseCode: 535 })
    h.send.mockRejectedValue(err)
    const r = await sendWorkspaceTestMail(WS, CUSTOM)
    expect(r).toEqual({ ok: false, error: smtpErrorMessage(serverKoTranslate, err, { test: true }) })
    expect(JSON.stringify(r)).not.toContain('new-secret')
    // 로그에도 원문(계정·비밀번호가 섞일 수 있다)을 남기지 않는다 — code·responseCode 만
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('new-secret')
  })

  it('메일 서버가 본인 주소를 거부하면 실패 문구', async () => {
    makeAdmin()
    h.send.mockResolvedValue({ rejected: [ME.toUpperCase()] })
    const r = await sendWorkspaceTestMail(WS, CUSTOM)
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain(ME)
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/actions/mail-settings-gate.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/actions/mailSettings"`(액션 파일이 아직 없다).

- [ ] **Step 3: 서버 사전에 `srv.mailSettings.*` 키를 더한다 — `src/lib/i18n/dict/serverUi.ts`**

Task 4 Step 1 이 이미 `// src/app/actions/mailSettings.ts·src/lib/mail/errors.ts` 묶음 머리와 `'srv.mailSettings.testAuthFailed'` 줄을
`srv.llmConfig.*` 묶음과 `// src/app/actions/meetingNotify.ts` 사이에 넣어 두었다. 이 작업의 열한 키는 그 묶음 안 — `testAuthFailed` 줄 바로 뒤,
`// src/app/actions/meetingNotify.ts` 앞에 넣는다(묶음 머리를 두 번 쓰지 않는다. 조회 실패·호스트 거부 문구는 transport.ts 의 상수를 쓴다).

old:
```ts
  'srv.mailSettings.testAuthFailed': '메일 계정 인증에 실패했습니다. Gmail 이면 계정 비밀번호가 아니라 앱 비밀번호(16자리)를 넣었는지 확인하세요.',
  // src/app/actions/meetingNotify.ts
```
new:
```ts
  'srv.mailSettings.testAuthFailed': '메일 계정 인증에 실패했습니다. Gmail 이면 계정 비밀번호가 아니라 앱 비밀번호(16자리)를 넣었는지 확인하세요.',
  'srv.mailSettings.saveFailed': '메일 설정을 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.',
  'srv.mailSettings.deleteFailed': '메일 설정을 삭제하지 못했습니다. 잠시 뒤 다시 시도하세요.',
  'srv.mailSettings.nothingToDelete': '지울 설정이 없습니다.',
  'srv.mailSettings.settingsUnusable': '입력한 값으로는 메일을 보낼 수 없습니다. 보내는 주소와 계정을 확인하세요.',
  'srv.mailSettings.testNoRecipient': '로그인한 계정의 메일 주소를 확인할 수 없어 테스트 메일을 보내지 않았습니다.',
  'srv.mailSettings.testRecipientRejected': '메일 서버가 받는 주소({to})를 거부했습니다.',
  'srv.mailSettings.testSubject': '[{product}] 메일 발송 테스트',
  'srv.mailSettings.testBody': '워크스페이스 메일 발송 설정을 확인하려고 보낸 테스트 메일입니다. 이 메일을 받았다면 설정이 올바릅니다.',
  'srv.mailSettings.setterDeleted': '삭제된 계정',
  'srv.mailSettings.setterNoName': '이름 없음',
  'srv.mailSettings.setterUnavailable': '이름 확인 불가',
  // src/app/actions/meetingNotify.ts
```

주의: Task 4 도 `srv.mailSettings.*`(SMTP·테스트 발송 오류 문구)를 이 파일에 더한다. 위 열한 키와 이름이 겹치면 같은 객체 리터럴의 중복 속성이라
`npm run typecheck` 가 TS1117 로 잡는다 — 그때는 Task 4 의 키를 그대로 두고 이 작업의 키 이름을 바꾼다(테스트·액션의 키 문자열도 함께). 공용 사전(`settingsUi.ts`)의
`mailSettings.*` 와는 접두가 달라 `tests/invariants/i18n-server-messages.test.ts` 의 "서버 키와 공용 키는 겹치지 않는다"를 지킨다.

- [ ] **Step 4: 액션을 구현한다 — `src/app/actions/mailSettings.ts`(새 파일 전체)**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { requireWorkspaceAdmin } from '@/lib/authz'
import { isWorkspaceAdminRole } from '@/lib/domain/authz'
import { SAFE_ID_RE } from '@/lib/domain/validate'
import { adminFor, type AdminClient } from '@/lib/supabase/adminFor'
import {
  canReusePassword, normalizeMailSettingsInput, reasonKey,
  type MailPreset, type MailSettingsInput, type NormalizedMailSettings,
} from '@/lib/mail/settingsInput'
import { loadWorkspaceMailRow, rowToSmtpEnv, vetMailHost, type WorkspaceMailRow } from '@/lib/mail/workspaceSmtp'
import {
  MAIL_HOST_NOT_ALLOWED, MAIL_SETTINGS_UNAVAILABLE, resolveMailStatus, resolveSmtpSettings, transportFromSettings,
  type MailStatus,
} from '@/lib/mail/transport'
import { smtpErrorMessage } from '@/lib/mail/errors'
import { loadDisplayBranding } from '@/lib/settings/displayBranding'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'

// 워크스페이스 발송 메일 설정(설계 2026-10-15 §3). 워크스페이스 관리자만 — 가드 앞에서는 id 모양(SAFE_ID_RE)만 보고,
// 존재·소속 판정은 requireWorkspaceAdmin 과 .eq('workspace_id', wid) 가 한다. service_role 은 adminFor({ workspaceId }) 로만 만든다
// (범위가 정해진 클라이언트 — 감사표 행이 생기지 않는다). 비밀번호는 응답·로그·오류 어디에도 싣지 않는다.

/** 비밀번호를 뺀 저장 설정 보기 — 저장된 행이 있으면 비밀번호도 있다(DB 제약 workspace_mail_settings_login) */
export interface MailSettingsView {
  preset: MailPreset; host: string; port: number; secure: boolean
  username: string; fromAddress: string | null; hasPassword: true
}

export type GetMailSettingsResult =
  | { ok: true; settings: MailSettingsView | null; status: MailStatus
      passwordSetBy: string | null; passwordSetAt: string | null; passwordSetterIsAdmin: boolean | 'unknown' | null }
  | { ok: false; error: string }

type Fail = { ok: false; error: string }

const SETTINGS_PATH = '/w/[slug]/settings'

const isWorkspaceIdArg = (v: unknown): v is string => typeof v === 'string' && SAFE_ID_RE.test(v)

/** 가드 뒤 그 워크스페이스로 범위를 묶은 service_role. uuid 가 아닌 id 는 adminFor 가 throw 한다 — 던지지 않고 조회 실패 문구로 */
function scopedAdmin(wid: string, where: string): { ok: true; admin: AdminClient } | Fail {
  try {
    return { ok: true, admin: adminFor({ workspaceId: wid }).admin }
  } catch (e) {
    console.error(`[${where}] 범위 클라이언트 생성 실패:`, e instanceof Error ? e.message : e)
    return { ok: false, error: MAIL_SETTINGS_UNAVAILABLE }
  }
}

/** 저장된 행. 조회 실패는 미설정으로 위장하지 않는다(3원칙 ①). 보관 응답은 가드(buildActor, 0056)가 먼저 닫으므로 여기 오면 모르는 상태 — 닫는다 */
async function loadStored(admin: AdminClient, wid: string, where: string): Promise<{ ok: true; row: WorkspaceMailRow | null } | Fail> {
  try {
    const r = await loadWorkspaceMailRow(admin, wid)
    if (r.kind === 'archived') return { ok: false, error: MAIL_SETTINGS_UNAVAILABLE }
    return { ok: true, row: r.kind === 'row' ? r.row : null }
  } catch (e) {
    console.error(`[${where}] 메일 설정 조회 실패:`, e instanceof Error ? e.message : e)
    return { ok: false, error: MAIL_SETTINGS_UNAVAILABLE }
  }
}

/**
 * 보낼·저장할 비밀번호. 빈칸(null)은 저장값 재사용 — 저장 행이 있고 정규화한 host·username 이 저장값과 같을 때만(canReusePassword, 설계 §3).
 * Gmail 은 host·username 이 고정이라 이 한 규칙이 Gmail↔직접 입력 사이의 재사용도 막는다. 저장과 테스트 발송이 같이 쓴다.
 */
function pickPassword(tr: ServerTranslate, v: NormalizedMailSettings, stored: WorkspaceMailRow | null):
  { ok: true; password: string; reusedFrom: WorkspaceMailRow | null } | Fail {
  if (v.password !== null) return { ok: true, password: v.password, reusedFrom: null }
  if (stored && canReusePassword({ host: v.host, username: v.username }, { host: stored.host, username: stored.username })) {
    return { ok: true, password: stored.password, reusedFrom: stored }
  }
  return { ok: false, error: tr(reasonKey('password_required')) }
}

/** 발송 판정 한 벌(resolveSmtpSettings)로 본다 — 저장해도 workspace·invalid 가 될 값, 테스트로 보낼 수 없는 값을 거른다(env 로 내려가지 않는다) */
function smtpSettingsFor(v: NormalizedMailSettings, password: string) {
  return resolveSmtpSettings(rowToSmtpEnv({
    host: v.host, port: v.port, secure: v.secure, username: v.username, password, from_address: v.from_address,
  }))
}

/** 비밀번호를 넣은 사람 — 표시 이름과 지금 이 워크스페이스 관리자인지. 계정이 지워졌으면(on delete set null) 관리자가 아니다. 조회 실패는 'unknown'(3원칙) */
async function passwordSetter(tr: ServerTranslate, admin: AdminClient, wid: string, userId: string | null):
  Promise<{ name: string; isAdmin: boolean | 'unknown' }> {
  if (userId === null) return { name: tr('srv.mailSettings.setterDeleted'), isAdmin: false }
  const [profile, member] = await Promise.all([
    admin.from('profiles').select('display_name').eq('user_id', userId).maybeSingle(),
    admin.from('workspace_members').select('role').eq('workspace_id', wid).eq('user_id', userId).maybeSingle(),
  ])
  let name: string
  if (profile.error) {
    console.error('[getWorkspaceMailSettings] 설정자 이름 조회 실패:', profile.error.message)
    name = tr('srv.mailSettings.setterUnavailable')
  } else if (!profile.data) {
    name = tr('srv.mailSettings.setterDeleted')
  } else {
    name = (profile.data as { display_name: string | null }).display_name?.trim() || tr('srv.mailSettings.setterNoName')
  }
  let isAdmin: boolean | 'unknown'
  if (member.error) {
    console.error('[getWorkspaceMailSettings] 설정자 소속 조회 실패:', member.error.message)
    isAdmin = 'unknown'
  } else {
    isAdmin = isWorkspaceAdminRole((member.data as { role: string | null } | null)?.role)
  }
  return { name, isAdmin }
}

/** 설정 화면 — 비밀번호를 뺀 보기 + 발송 상태 + 비밀번호 설정자 */
export async function getWorkspaceMailSettings(wid: string): Promise<GetMailSettingsResult> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const a = scopedAdmin(wid, 'getWorkspaceMailSettings')
  if (!a.ok) return a

  const [stored, status] = await Promise.all([
    loadStored(a.admin, wid, 'getWorkspaceMailSettings'),
    resolveMailStatus(wid).catch((e: unknown): { error: string } => {
      console.error('[getWorkspaceMailSettings] 발송 상태 판정 실패:', e instanceof Error ? e.message : e)
      return { error: MAIL_SETTINGS_UNAVAILABLE }
    }),
  ])
  if (!stored.ok) return stored
  if ('error' in status) return { ok: false, error: status.error }

  const row = stored.row
  if (!row) return { ok: true, settings: null, status, passwordSetBy: null, passwordSetAt: null, passwordSetterIsAdmin: null }
  const setter = await passwordSetter(tr, a.admin, wid, row.password_set_by)
  return {
    ok: true,
    settings: {
      preset: row.preset, host: row.host, port: row.port, secure: row.secure,
      username: row.username, fromAddress: row.from_address, hasPassword: true,
    },
    status,
    passwordSetBy: setter.name,
    passwordSetAt: row.password_set_at,
    passwordSetterIsAdmin: setter.isAdmin,
  }
}

/**
 * 저장 — 검증 → (빈 비밀번호면 저장값 재사용 판정) → 쓰기. 새 비밀번호를 넣었을 때만 password_set_by·password_set_at 을 바꾼다(설계 §1.1).
 * DB 오류는 code·message 만 로그한다 — 검사 제약 위반의 details 에는 행 값(비밀번호 포함)이 실린다.
 */
export async function saveWorkspaceMailSettings(
  wid: string, input: MailSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const n = normalizeMailSettingsInput(input)
  if (!n.ok) return { ok: false, error: tr(reasonKey(n.code)) }
  const v = n.value
  const a = scopedAdmin(wid, 'saveWorkspaceMailSettings')
  if (!a.ok) return a

  let stored: WorkspaceMailRow | null = null
  if (v.password === null) {
    const s = await loadStored(a.admin, wid, 'saveWorkspaceMailSettings')
    if (!s.ok) return s
    stored = s.row
  }
  const pw = pickPassword(tr, v, stored)
  if (!pw.ok) return pw
  if (!smtpSettingsFor(v, pw.password).ok) return { ok: false, error: tr('srv.mailSettings.settingsUnusable') }

  const now = new Date().toISOString()
  const base = {
    preset: v.preset, host: v.host, port: v.port, secure: v.secure, username: v.username, from_address: v.from_address,
    updated_by: g.actor.userId, updated_at: now,
  }
  if (pw.reusedFrom) {
    // 비밀번호를 유지한 저장 — 비밀번호·설정자 칸을 싣지 않는다. 읽은 뒤 다른 관리자가 서버·계정을 바꿨으면
    // 저장값 조건(host·username)에 걸려 0행이 된다 — 남의 비밀번호를 새 서버로 옮기지 않게 다시 입력을 받는다.
    const { data, error } = await a.admin.from('workspace_mail_settings').update(base)
      .eq('workspace_id', wid).eq('host', pw.reusedFrom.host).eq('username', pw.reusedFrom.username)
      .select('workspace_id')
    if (error) {
      console.error('[saveWorkspaceMailSettings] 저장 실패:', { code: error.code, message: error.message })
      return { ok: false, error: tr('srv.mailSettings.saveFailed') }
    }
    if (!data || data.length === 0) return { ok: false, error: tr(reasonKey('password_required')) }
  } else {
    const { error } = await a.admin.from('workspace_mail_settings').upsert({
      workspace_id: wid, ...base, password: pw.password, password_set_by: g.actor.userId, password_set_at: now,
    }, { onConflict: 'workspace_id' })
    if (error) {
      console.error('[saveWorkspaceMailSettings] 저장 실패:', { code: error.code, message: error.message })
      return { ok: false, error: tr('srv.mailSettings.saveFailed') }
    }
  }
  revalidatePath(SETTINGS_PATH, 'page')
  return { ok: true }
}

/** 설정 삭제 = 행 삭제(끄기). 영향 행으로 결과를 정한다 — 0행을 성공으로 보고하지 않는다. 지운 뒤에는 env(있으면)로 돌아간다 */
export async function deleteWorkspaceMailSettings(wid: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const a = scopedAdmin(wid, 'deleteWorkspaceMailSettings')
  if (!a.ok) return a

  const { data, error } = await a.admin.from('workspace_mail_settings').delete()
    .eq('workspace_id', wid)
    .select('workspace_id')
  if (error) {
    console.error('[deleteWorkspaceMailSettings] 삭제 실패:', { code: error.code, message: error.message })
    return { ok: false, error: tr('srv.mailSettings.deleteFailed') }
  }
  if (!data || data.length === 0) return { ok: false, error: tr('srv.mailSettings.nothingToDelete') }
  revalidatePath(SETTINGS_PATH, 'page')
  return { ok: true }
}

/**
 * 테스트 메일 — 저장 전 폼 값으로 로그인한 **본인 주소에만** 1통(설계 §3). 수신자를 입력으로 받지 않는다(임의 주소 발송 통로 차단).
 * 순서: 가드 → 검증 → 본인 주소 → 재사용 규칙 → 발송 판정(env 로 내려가지 않는다) → 서버 주소 검사(§2.4) → 트랜스포트 → 발송.
 */
export async function sendWorkspaceTestMail(
  wid: string, input: MailSettingsInput,
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const n = normalizeMailSettingsInput(input)
  if (!n.ok) return { ok: false, error: tr(reasonKey(n.code)) }
  const v = n.value

  const user = await getSession()
  const to = user?.email?.trim()
  if (!to) return { ok: false, error: tr('srv.mailSettings.testNoRecipient') }

  const a = scopedAdmin(wid, 'sendWorkspaceTestMail')
  if (!a.ok) return a
  let stored: WorkspaceMailRow | null = null
  if (v.password === null) {
    const s = await loadStored(a.admin, wid, 'sendWorkspaceTestMail')
    if (!s.ok) return s
    stored = s.row
  }
  const pw = pickPassword(tr, v, stored)
  if (!pw.ok) return pw
  const resolved = smtpSettingsFor(v, pw.password)
  if (!resolved.ok) return { ok: false, error: tr('srv.mailSettings.settingsUnusable') }

  // 관리자가 넣은 호스트로 서버가 직접 접속한다 — 사설·예약 대역으로 풀리면 연결하지 않고, 통과한 IP 로만 붙는다(재해석 차단)
  const vet = await vetMailHost(resolved.settings.host)
  if (!vet.ok) return { ok: false, error: MAIL_HOST_NOT_ALLOWED }

  const branding = await loadDisplayBranding(wid, a.admin)
  const transport = transportFromSettings(resolved.settings, { fromName: branding.mailFromName, connectTo: vet.address })
  if (!transport.ok) return { ok: false, error: transport.error }

  const body = tr('srv.mailSettings.testBody')
  try {
    const { rejected } = await transport.send({
      to: [to], replyTo: null,
      subject: fill(tr('srv.mailSettings.testSubject'), { product: branding.productName }),
      html: `<p>${body}</p>`,
      text: body,
    })
    const self = to.toLowerCase()
    if (rejected.some(r => r.trim().toLowerCase() === self)) {
      return { ok: false, error: fill(tr('srv.mailSettings.testRecipientRejected'), { to }) }
    }
    return { ok: true, to }
  } catch (e) {
    // SMTP 원문에는 계정·호스트(때로는 보낸 자격 증명)가 섞인다 — 로그에도 code·responseCode 만 남긴다
    const err = e as { code?: unknown; responseCode?: unknown } | null
    console.error('[sendWorkspaceTestMail] 발송 실패:', { code: err?.code ?? 'unknown', responseCode: err?.responseCode ?? null })
    return { ok: false, error: smtpErrorMessage(tr, e, { test: true }) }
  }
}
```

구현 메모:
- `scopedAdmin`·`loadStored`·`pickPassword` 가 돌려주는 `Fail` 을 `return a`/`return s`/`return pw` 로 그대로 올린다 — 셋 다 고정 문구(`MAIL_SETTINGS_UNAVAILABLE`·사전 키)만 싣는다.
- `smtpErrorMessage` 의 `tr` 형은 `ServerTranslate` — `serverTranslator()` 의 결과를 그대로 넘긴다.
- `getSession()` 은 가드 뒤에만 부른다(가드 거부 테스트가 미호출을 단언한다).
- 파일 어디에도(주석 포함) service_role 생성 함수 이름을 쓰지 않는다 — `tests/invariants/admin-scope.test.ts` 가 원문 낱말로 감사표 행을 요구한다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `npx vitest run tests/actions/mail-settings-gate.test.ts`
Expected: PASS(5 describe, 21 tests).

- [ ] **Step 6: 열거 게이트가 새 액션을 잡는지 확인한다(매니페스트 없이 실패)**

Run: `npx vitest run tests/gates/enumerate.test.ts`
Expected: FAIL — 코드의 액션 = 매니페스트(양방향) 검사가 `src/app/actions/mailSettings.ts#getWorkspaceMailSettings` 등 네 키가 매니페스트에 없다고 보고한다.

- [ ] **Step 7: 매니페스트에 네 항목을 더한다 — `tests/gates/manifest.ts`**

`// ── llmConfig — 플랫폼` 묶음 끝과 `// ── meetingNotify` 사이.

old:
```ts
  [`${A('llmConfig')}#testLlmConnection`]: nul('superuser'),
  // ── meetingNotify
```
new:
```ts
  [`${A('llmConfig')}#testLlmConnection`]: nul('superuser'),
  // ── mailSettings — 워크스페이스 발송 메일 설정(설계 2026-10-15 §3, core). 가드 앞은 SAFE_ID_RE 뿐 — W('ws-1')가 가드에 닿는다.
  //    둘째 인자 {} 는 가드 뒤 normalizeMailSettingsInput 에서 실패한다 — 가드 통과 실행에서도 SMTP 연결을 시도하지 않는다. 클라이언트는 adminFor(감사표 행 없음)
  [`${A('mailSettings')}#getWorkspaceMailSettings`]: { ...nul('workspaceAdmin'), sample: [W] },
  [`${A('mailSettings')}#saveWorkspaceMailSettings`]: { ...nul('workspaceAdmin'), sample: [W, {}] },
  [`${A('mailSettings')}#deleteWorkspaceMailSettings`]: { ...nul('workspaceAdmin'), sample: [W] },
  [`${A('mailSettings')}#sendWorkspaceTestMail`]: { ...nul('workspaceAdmin'), sample: [W, {}] },
  // ── meetingNotify
```
(`guard: 'workspaceAdmin'` 은 `NOTE_REQUIRED` 밖이라 note 가 필요 없다. module null 이므로 deny·delegatedTo·target 을 두지 않는다.)

- [ ] **Step 8: 게이트 테스트를 돌린다**

Run: `npx vitest run tests/gates/enumerate.test.ts tests/gates/deny.test.ts`
Expected: PASS. 확인할 것 —
- deny "null 항목(가드 거부 실행)" 두 모드(세션 없음·등급 거부): 네 항목 모두 `requireWorkspaceAdmin` 에 닿고 응답 `{ ok:false, error: ERR_DENIED }`, 쓰기·DB 접근·admin 생성 0.
- deny "null 항목(정적)": 본문·같은 파일 도우미에 `requireModule`/`requireSessionModule` 호출이 없고, 만지는 표(`workspace_mail_settings`·`profiles`·`workspace_members`)가
  `tests/gates/_tables.ts` 의 `MODULE_TABLE_OWNER` 에 없어 `NULL_TABLE_ALLOW` 가 필요 없다. RPC 를 부르지 않아 `_rpc-tables.ts` 도 그대로.
- deny "null 항목(가드 통과 실행)": 관문 호출 0(본문의 성패는 보지 않는다 — 하네스 admin 의 행으로 `loadWorkspaceMailRow` 가 throw 해도 액션이 잡는다).
실패하면: 가드 거부 응답에 ERR_DENIED 가 없다 → 가드 결과를 바꿔 싣고 있지 않은지(`{ ok: false, error: g.error }`), "가드에 닿지 않았다" → 가드 앞 검증이 `ws-1` 을 거부하지 않는지(uuid 검사를 가드 앞에 두지 않는다 — 설계 §3).

- [ ] **Step 9: 관련 불변식을 돌린다**

Run:
```bash
npx vitest run tests/invariants/admin-scope.test.ts tests/invariants/use-server-exports.test.ts tests/invariants/i18n-server-messages.test.ts \
  tests/invariants/settings-writes.test.ts tests/invariants/rpc-actor-source.test.ts tests/invariants/no-raw-db-errors.test.ts \
  tests/authz/guard-signatures.test.ts tests/settings/operational-env.test.ts
```
Expected: PASS —
- admin-scope: `mailSettings.ts` 원문에 service_role 생성 함수 이름이 없어 감사표(`docs/sp2-admin-client-audit.md`) 행이 필요 없다(adminFor 경유). 실패하면 그 낱말이 주석에 들어갔는지 본다.
- use-server-exports: export 는 async 함수 넷과 `MailSettingsView`·`GetMailSettingsResult` 형뿐(`SETTINGS_PATH`·도우미는 export 하지 않는다).
- i18n-server-messages: `error:` 값은 `tr(…)`·`fill(tr(…))`·상수·`g.error`·`transport.error`·`smtpErrorMessage(…)` — 한국어 리터럴 0. 서버 키·공용 키 겹침 0.
- settings-writes: 설정 표 이름을 쓰지 않는다. operational-env: `process.env` 를 읽지 않는다.

- [ ] **Step 10: 형 검사·린트**

Run: `npm run typecheck && npx eslint src/app/actions/mailSettings.ts tests/actions/mail-settings-gate.test.ts tests/gates/manifest.ts src/lib/i18n/dict/serverUi.ts`
Expected: 오류 0. (TS1117 중복 키가 나면 Step 3 의 주의대로 이 작업의 키 이름을 바꾼다.)

- [ ] **Step 11: 커밋**

```bash
git add src/app/actions/mailSettings.ts src/lib/i18n/dict/serverUi.ts tests/actions/mail-settings-gate.test.ts tests/gates/manifest.ts
git commit -m "$(cat <<'MSG'
워크스페이스 메일 설정 액션 — 관리자가 화면에서 발송 계정을 저장·확인·삭제하고 본인에게 테스트 메일을 보낸다

배포 환경변수를 고치고 재배포하지 않아도 워크스페이스마다 발송 계정을 바꾸게 하려고 서버 액션 넷을 둔다.
가드 앞은 id 모양만 보고 워크스페이스 관리자 가드 뒤 adminFor 로 그 행만 다룬다(감사표 행 없음).
빈 비밀번호는 같은 서버·계정일 때만 저장값을 재사용한다 — 다른 서버로 남의 비밀번호를 옮기지 않게.
새 비밀번호를 넣었을 때만 설정자·시각을 바꾸고, 테스트 메일은 수신자를 입력받지 않고 로그인한 본인에게만 보낸다.
응답·로그 어디에도 비밀번호와 SMTP 원문을 싣지 않는다. 열거 게이트 매니페스트에 네 항목을 더한다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```
(`git add -A` 금지 — 파일명을 명시했다. 마이그레이션 파일은 없다 — G1 무관.)

**이 작업 끝에 다시 돌릴 기존 테스트:** `npx vitest run tests/gates tests/invariants tests/authz tests/settings/operational-env.test.ts tests/actions/mail-settings-gate.test.ts tests/actions/project-invites-gate.test.ts tests/actions/meeting-notify-gate.test.ts tests/mail`
(게이트·불변식 전부, 그리고 같은 `transport.ts`·`workspaceSmtp.ts` 를 쓰는 초대·회의 액션과 메일 모듈 테스트 — Task 4·5 의 변경과 함께 초록이어야 한다.)

---

### Task 7: 메일 발송 편집기 컴포넌트 `MailSettingsEditor`

설계 §4 1~7. 서버가 내린 `getWorkspaceMailSettings` 결과(`initial`)를 그리고, 저장·테스트 발송·삭제는 Task 6 의 액션을 부른다.
입력 검사는 Task 2 의 순수 함수(`normalizeMailSettingsInput`·`canReusePassword`·`reasonKey`)를 폼에서도 먼저 돌린다(서버가 다시 본다).
선행: Task 2(settingsInput·`mailSettings.reason.*` 사전 키), Task 6(`src/app/actions/mailSettings.ts` 의 형·액션).

계약과의 차이(더하기만): props 에 선택 prop `timeZone?: string | null` 을 더한다 — 비밀번호 설정 시각을 범위 tz 로 찍어야 한다
(`tests/invariants/instant-format-zone.test.ts`, 브라우저 tz 금지). 없으면 시각 칸은 '—'. **Task 8 은
`<MailSettingsEditor workspaceId={access.id} initial={mail} timeZone={historyCal.ok ? historyCal.calendar.timezone : null} />` 로 넘긴다.**
계약의 `workspaceId`·`initial` 이름·형은 그대로다.

**Files:**
- Create: `src/components/settings/MailSettingsEditor.tsx`
- Modify: `src/lib/i18n/dict/settingsUi.ts` (편집기 문구 `mailSettings.*` — Task 2 의 `mailSettings.reason.*` 와 같은 파일, 다른 키)
- Test: `tests/components/mail-settings-editor.test.tsx`

지킬 불변식:
- `tests/invariants/i18n-no-korean-literals.test.ts` — 컴포넌트에 한국어 리터럴 0(주석만 한국어). 모든 화면 글자는 `t('mailSettings.*')`·`common.*`.
- `tests/invariants/i18n-server-messages.test.ts` — 새 키는 `mailSettings.*`(공용), 서버 키 `srv.mailSettings.*`(Task 4·6)와 겹치지 않는다. 같은 객체 안 중복 키는 tsc(TS1117)가 잡는다.
- `tests/invariants/instant-format-zone.test.ts` — 시각은 `formatStampIn(at, timeZone)` 만 쓴다.
- `tests/css/breakpoint-safety-net.test.ts`·CLAUDE.md CSS 규칙 — 상태 변형 display 유틸(`group-hover:flex`·`data-[…]:hidden`)·컨테이너 쿼리 display 를 쓰지 않는다. 조건부 렌더로 숨긴다.
- `tests/invariants/settings-editor-uuid.test.ts` — `crypto.randomUUID` 를 쓰지 않는다(이 편집기는 commandId 가 없다).
- `tests/invariants/no-english-eyebrow.test.ts` — eyebrow 를 쓰지 않는다.
- 클라이언트 번들: `@/lib/mail/transport`(server-only)를 import 하지 않는다. `MailStatus` 형은 `GetMailSettingsResult` 에서 꺼낸다.

- [ ] **Step 1: 편집기 문구를 공용 설정 사전에 더한다**

`src/lib/i18n/dict/settingsUi.ts` 의 끝 — 파일에 하나뿐인 `} as const` 바로 앞(Task 2 가 넣은 `mailSettings.reason.*` 블록 뒤)에 넣는다.

old:
```ts
} as const
```
new:
```ts
  // components/settings/MailSettingsEditor.tsx — 워크스페이스 메일 발송(설계 2026-10-15 §4)
  'mailSettings.status.workspaceValid': '이 워크스페이스 설정으로 발송 중 · 보내는 주소 {from}',
  'mailSettings.status.workspaceInvalid': '저장된 설정이 올바르지 않습니다 — 다시 저장하세요(지금은 메일이 나가지 않습니다)',
  'mailSettings.status.envValid': '서버 환경변수 설정으로 발송 중',
  'mailSettings.status.envInvalid': '서버 환경변수의 메일 설정이 올바르지 않습니다 — 이 화면에서 저장하면 그 설정으로 발송합니다',
  'mailSettings.status.none': '메일 발송이 설정되지 않았습니다 — 회의 안내·초대 메일이 나가지 않습니다',
  'mailSettings.passwordSet': '비밀번호 설정: {name} · {at}',
  'mailSettings.passwordSetByUnknown': '알 수 없는 사용자',
  'mailSettings.setterNotAdmin': '비밀번호를 넣은 사람이 더 이상 이 워크스페이스 관리자가 아닙니다 — 설정을 바꾸거나 삭제하세요',
  'mailSettings.setterUnknown': '비밀번호를 넣은 사람의 현재 권한을 확인하지 못했습니다.',
  'mailSettings.preset.label': '발송 방식',
  'mailSettings.preset.gmail': 'Gmail',
  'mailSettings.preset.custom': '직접 입력',
  'mailSettings.gmail.address': '보내는 Gmail 주소',
  'mailSettings.gmail.appPassword': '앱 비밀번호',
  'mailSettings.gmail.howto': 'Google 계정 › 보안에서 2단계 인증을 켠 뒤 앱 비밀번호를 만들어 붙여 넣으세요. 4자씩 띄운 공백은 지우지 않아도 됩니다.',
  'mailSettings.gmail.dedicated': '발송 한도·평판이 이 계정에 쌓이고 앱 비밀번호는 메일함 전체를 여는 값이므로 발송 전용 계정을 권합니다.',
  'mailSettings.sendsNotice': '이 계정으로 회의 안내(일반 멤버인 회의 작성자 포함, 참석자 외 외부 주소 최대 20개/회)와 초대 메일이 나갑니다.',
  'mailSettings.custom.host': '서버 주소',
  'mailSettings.custom.port': '포트',
  'mailSettings.custom.secure': '보안 연결',
  'mailSettings.custom.ssl': 'SSL',
  'mailSettings.custom.starttls': 'STARTTLS',
  'mailSettings.custom.username': '계정',
  'mailSettings.custom.password': '비밀번호',
  'mailSettings.custom.from': '보내는 주소',
  'mailSettings.custom.fromHint': '비우면 계정 주소로 보냅니다.',
  'mailSettings.passwordKeptPh': '저장됨 · 바꾸려면 새로 입력',
  'mailSettings.fromNameNote': "보내는 사람 이름은 '일반' 섹션의 메일 발신 이름을 씁니다.",
  'mailSettings.test': '테스트 메일 보내기',
  'mailSettings.testing': '보내는 중…',
  'mailSettings.testHint': '저장하기 전의 값으로 내 메일 주소에 한 통 보냅니다.',
  'mailSettings.testSent': '{to} 주소로 테스트 메일을 보냈습니다.',
  'mailSettings.saving': '저장 중…',
  'mailSettings.saved': '메일 발송 설정을 저장했습니다.',
  'mailSettings.delete': '설정 삭제',
  'mailSettings.deleteTitle': '메일 발송 설정 삭제',
  'mailSettings.deleteConfirm': '이 워크스페이스의 메일 발송 설정과 저장된 비밀번호를 지웁니다. 서버 환경변수 설정이 있으면 그 설정으로 발송하고, 없으면 메일이 나가지 않습니다.',
  'mailSettings.deleting': '삭제 중…',
  'mailSettings.deleted': '메일 발송 설정을 삭제했습니다.',
} as const
```
(키 접두 `mailSettings.status.*` 등은 Task 2 의 `mailSettings.reason.*` 와 겹치지 않는다. 서버 사전의 `srv.mailSettings.*` 와도 다른 키다.)

- [ ] **Step 2: 실패하는 컴포넌트 테스트를 쓴다**

`tests/components/mail-settings-editor.test.tsx`:
```tsx
// @vitest-environment jsdom
// 워크스페이스 메일 발송 편집기(설계 2026-10-15 §4) — 상태 줄 다섯 갈래, 비밀번호 설정자 경고, 방식 전환,
// 비밀번호 칸은 늘 빈 값으로 시작하고 브라우저 자동완성이 로그인 비밀번호를 채우지 못하게(new-password·smtp-* 이름) 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetMailSettingsResult } from '@/app/actions/mailSettings'
import { t } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const saveWorkspaceMailSettings = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
const deleteWorkspaceMailSettings = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
const sendWorkspaceTestMail = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true, to: 'me@example.com' }))
const refresh = vi.fn()
const toast = vi.fn()

vi.mock('@/app/actions/mailSettings', () => ({
  getWorkspaceMailSettings: vi.fn(),
  saveWorkspaceMailSettings: (...a: unknown[]) => saveWorkspaceMailSettings(...a),
  deleteWorkspaceMailSettings: (...a: unknown[]) => deleteWorkspaceMailSettings(...a),
  sendWorkspaceTestMail: (...a: unknown[]) => sendWorkspaceTestMail(...a),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  const api = { t: (k: Parameters<typeof t>[0]) => t(k) }
  return { useLocale: () => api }
})

import { MailSettingsEditor } from '@/components/settings/MailSettingsEditor'

type Initial = Extract<GetMailSettingsResult, { ok: true }>
type Status = Initial['status']

const NONE: Initial = {
  ok: true, settings: null, status: { source: 'none' },
  passwordSetBy: null, passwordSetAt: null, passwordSetterIsAdmin: null,
}
const GMAIL: Initial = {
  ok: true,
  settings: { preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'ops@gmail.com', fromAddress: null, hasPassword: true },
  status: { source: 'workspace', valid: true, fromAddress: 'ops@gmail.com' },
  passwordSetBy: '김관리', passwordSetAt: '2026-10-15T01:02:00Z', passwordSetterIsAdmin: true,
}
const CUSTOM: Initial = {
  ...GMAIL,
  settings: { preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'mailer', fromAddress: 'noreply@example.com', hasPassword: true },
  status: { source: 'workspace', valid: true, fromAddress: 'noreply@example.com' },
}

describe('MailSettingsEditor', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    saveWorkspaceMailSettings.mockReset(); saveWorkspaceMailSettings.mockResolvedValue({ ok: true })
    deleteWorkspaceMailSettings.mockReset(); deleteWorkspaceMailSettings.mockResolvedValue({ ok: true })
    sendWorkspaceTestMail.mockReset(); sendWorkspaceTestMail.mockResolvedValue({ ok: true, to: 'me@example.com' })
    refresh.mockClear(); toast.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(initial: Initial = NONE) {
    act(() => { root.render(<MailSettingsEditor workspaceId="w-1" initial={initial} timeZone="UTC" />) })
  }
  const $ = <T extends Element>(sel: string) => container.querySelector<T>(sel)
  function typeInto(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  function choose(el: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  async function click(el: Element | null) {
    await act(async () => { (el as HTMLElement).click() })
  }
  const pickCustom = () => click($('input[type="radio"][value="custom"]'))

  describe('상태 줄 — 다섯 갈래', () => {
    const cases: Array<[string, Status, string, string]> = [
      ['workspace-valid', { source: 'workspace', valid: true, fromAddress: 'ops@gmail.com' }, '이 워크스페이스 설정으로 발송 중', 'ops@gmail.com'],
      ['workspace-invalid', { source: 'workspace', valid: false }, '저장된 설정이 올바르지 않습니다', '지금은 메일이 나가지 않습니다'],
      ['env-valid', { source: 'env', valid: true, fromAddress: 'env@example.com' }, '서버 환경변수 설정으로 발송 중', ''],
      ['env-invalid', { source: 'env', valid: false }, '서버 환경변수의 메일 설정이 올바르지 않습니다', '이 화면에서 저장하면'],
      ['none', { source: 'none' }, '메일 발송이 설정되지 않았습니다', '초대 메일이 나가지 않습니다'],
    ]
    it.each(cases)('%s', (variant, status, head, tail) => {
      render({ ...NONE, status })
      const line = $('[data-mail-status]')!
      expect(line.getAttribute('data-mail-status')).toBe(variant)
      expect(line.getAttribute('role')).toBe('status')
      expect(line.textContent).toContain(head)
      expect(line.textContent).toContain(tail)
    })
  })

  describe('비밀번호 설정자', () => {
    it('저장된 행이 있으면 누가·언제 넣었는지 범위 tz 로 보인다', () => {
      render(GMAIL)
      const line = $('[data-mail-password-set]')!
      expect(line.textContent).toContain('김관리')
      expect(line.textContent).toContain('2026-10-15 01:02')
      expect($('[data-mail-setter-warning]')).toBeNull()
    })
    it('설정자가 지금 관리자가 아니면 경고한다', () => {
      render({ ...GMAIL, passwordSetterIsAdmin: false })
      expect($('[data-mail-setter-warning]')!.textContent).toContain('비밀번호를 넣은 사람이 더 이상 이 워크스페이스 관리자가 아닙니다')
    })
    it("설정자 판정을 못 읽었으면('unknown') 모른다고 보인다 — 경고 없음으로 위장하지 않는다", () => {
      render({ ...GMAIL, passwordSetterIsAdmin: 'unknown' })
      expect($('[data-mail-setter-unknown]')).not.toBeNull()
      expect($('[data-mail-setter-warning]')).toBeNull()
    })
    it('설정자가 지워진 계정(null)이면 이름 대신 알 수 없는 사용자', () => {
      render({ ...GMAIL, passwordSetBy: null, passwordSetterIsAdmin: false })
      expect($('[data-mail-password-set]')!.textContent).toContain('알 수 없는 사용자')
    })
    it('저장된 행이 없으면 설정자 줄이 없다', () => {
      render(NONE)
      expect($('[data-mail-password-set]')).toBeNull()
    })
  })

  describe('방식 전환', () => {
    it('기본은 Gmail — 주소·앱 비밀번호만, 서버 칸은 없다', () => {
      render(NONE)
      expect($<HTMLInputElement>('input[type="radio"][value="gmail"]')!.checked).toBe(true)
      expect($('#smtp-username')).not.toBeNull()
      expect($('#smtp-host')).toBeNull()
      expect(container.textContent).toContain('발송 전용 계정을 권합니다')
    })
    it('직접 입력으로 바꾸면 서버·포트·보안·계정·보내는 주소 칸이 생긴다', async () => {
      render(NONE)
      await pickCustom()
      for (const id of ['smtp-host', 'smtp-port', 'smtp-secure', 'smtp-username', 'smtp-password', 'smtp-from']) expect($(`#${id}`), id).not.toBeNull()
    })
    it('저장된 직접 입력 설정은 그 값으로 시작한다(비밀번호는 빈 칸)', () => {
      render(CUSTOM)
      expect($<HTMLInputElement>('input[type="radio"][value="custom"]')!.checked).toBe(true)
      expect($<HTMLInputElement>('#smtp-host')!.value).toBe('smtp.example.com')
      expect($<HTMLSelectElement>('#smtp-port')!.value).toBe('587')
      expect($<HTMLSelectElement>('#smtp-secure')!.value).toBe('starttls')
      expect($<HTMLInputElement>('#smtp-from')!.value).toBe('noreply@example.com')
      expect($<HTMLInputElement>('#smtp-password')!.value).toBe('')
    })
    it('포트 465 를 고르면 SSL, 587 이면 STARTTLS 로 짝을 맞춘다', async () => {
      render(NONE)
      await pickCustom()
      choose($<HTMLSelectElement>('#smtp-port')!, '465')
      expect($<HTMLSelectElement>('#smtp-secure')!.value).toBe('ssl')
      choose($<HTMLSelectElement>('#smtp-port')!, '587')
      expect($<HTMLSelectElement>('#smtp-secure')!.value).toBe('starttls')
    })
    it('방식을 바꾸면 입력하던 비밀번호를 비운다 — 다른 서버로 새 나가지 않게', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-password')!, 'secret')
      await pickCustom()
      expect($<HTMLInputElement>('#smtp-password')!.value).toBe('')
    })
  })

  describe('자동완성 차단', () => {
    it.each([['gmail', NONE], ['custom', CUSTOM]] as const)('비밀번호 칸(%s) — password·new-password·smtp-password·빈 값', (_name, initial) => {
      render(initial)
      const pw = $<HTMLInputElement>('#smtp-password')!
      expect(pw.type).toBe('password')
      expect(pw.getAttribute('autocomplete')).toBe('new-password')
      expect(pw.name).toBe('smtp-password')
      expect(pw.value).toBe('')
    })
    it('저장돼 있으면 자리표시가 "저장됨", 없으면 자리표시가 없다', () => {
      render(GMAIL)
      expect($<HTMLInputElement>('#smtp-password')!.placeholder).toBe('저장됨 · 바꾸려면 새로 입력')
      act(() => root.unmount()); root = createRoot(container)
      render(NONE)
      expect($<HTMLInputElement>('#smtp-password')!.getAttribute('placeholder')).toBeNull()
    })
    it('주소·계정·서버·보내는 주소 칸은 autocomplete=off 와 smtp-* 이름', async () => {
      render(NONE)
      const addr = $<HTMLInputElement>('#smtp-username')!
      expect(addr.getAttribute('autocomplete')).toBe('off')
      expect(addr.name).toBe('smtp-username')
      await pickCustom()
      expect($<HTMLInputElement>('#smtp-username')!.getAttribute('autocomplete')).toBe('off')
      expect($<HTMLInputElement>('#smtp-host')!.getAttribute('autocomplete')).toBe('off')
      const from = $<HTMLInputElement>('#smtp-from')!
      expect(from.getAttribute('autocomplete')).toBe('off')
      expect(from.name).toBe('smtp-from')
    })
  })

  describe('저장', () => {
    it('Gmail — 주소·앱 비밀번호를 넘기고, 성공하면 비밀번호 칸을 비우고 새로 그린다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'abcd efgh ijkl mnop')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).toHaveBeenCalledWith('w-1', { preset: 'gmail', address: 'ops@gmail.com', password: 'abcd efgh ijkl mnop' })
      expect($<HTMLInputElement>('#smtp-password')!.value).toBe('')
      expect(refresh).toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '메일 발송 설정을 저장했습니다.', variant: 'success' }))
    })
    it('직접 입력 — 서버·포트(숫자)·보안·계정·보내는 주소를 넘긴다', async () => {
      render(NONE)
      await pickCustom()
      typeInto($<HTMLInputElement>('#smtp-host')!, 'smtp.example.com')
      // 보내는 주소를 비우면 계정이 이메일이어야 정규화를 통과한다(Task 2 의 from_invalid) — 그래서 계정을 이메일로 넣는다
      typeInto($<HTMLInputElement>('#smtp-username')!, 'mailer@example.com')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'pw')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).toHaveBeenCalledWith('w-1', {
        preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'mailer@example.com', password: 'pw', fromAddress: '',
      })
    })
    it('저장된 설정이 없는데 비밀번호가 비면 서버에 가기 전에 사유를 보인다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
      expect($('[role="alert"]')!.textContent).toBe(t('mailSettings.reason.password_required'))
    })
    it('주소 형식이 틀리면 사유 코드 문구(공용 사전)를 보인다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'not-an-email')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'pw')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
      expect($('[role="alert"]')!.textContent).toBe(t('mailSettings.reason.address_invalid'))
    })
    it('저장된 같은 Gmail 계정이면 비밀번호 빈칸으로도 저장한다(저장값 재사용)', async () => {
      render(GMAIL)
      expect($<HTMLInputElement>('#smtp-username')!.value).toBe('ops@gmail.com')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).toHaveBeenCalledWith('w-1', { preset: 'gmail', address: 'ops@gmail.com', password: '' })
    })
    it('Gmail 로 저장된 상태에서 직접 입력으로 바꾸면 비밀번호를 다시 요구한다', async () => {
      render(GMAIL)
      await pickCustom()
      typeInto($<HTMLInputElement>('#smtp-host')!, 'smtp.example.com')
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
      expect($('[role="alert"]')!.textContent).toBe(t('mailSettings.reason.password_required'))
    })
    it('액션 오류 문구는 그대로 보이고 새로 그리지 않는다', async () => {
      saveWorkspaceMailSettings.mockResolvedValue({ ok: false, error: '서버 오류 문구' })
      render(GMAIL)
      await click($('[data-mail-save]'))
      expect($('[role="alert"]')!.textContent).toBe('서버 오류 문구')
      expect(refresh).not.toHaveBeenCalled()
    })
    it('액션이 던지면 요청 실패 문구', async () => {
      saveWorkspaceMailSettings.mockRejectedValue(new Error('network'))
      render(GMAIL)
      await click($('[data-mail-save]'))
      expect($('[role="alert"]')!.textContent).toBe(t('wsAccounts.requestFailed'))
    })
  })

  describe('테스트 메일', () => {
    it('저장 전 폼 값으로 보내고 받는 주소(본인)를 알린다 — 수신자는 넘기지 않는다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'pw')
      await click($('[data-mail-test]'))
      expect(sendWorkspaceTestMail).toHaveBeenCalledWith('w-1', { preset: 'gmail', address: 'ops@gmail.com', password: 'pw' })
      expect($('[data-mail-notice]')!.textContent).toBe('me@example.com 주소로 테스트 메일을 보냈습니다.')
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
    })
    it('발송 실패 문구를 그대로 보인다', async () => {
      sendWorkspaceTestMail.mockResolvedValue({ ok: false, error: '인증 실패 문구' })
      render(GMAIL)
      await click($('[data-mail-test]'))
      expect($('[role="alert"]')!.textContent).toBe('인증 실패 문구')
    })
  })

  describe('설정 삭제', () => {
    it('저장된 행이 없으면 삭제 버튼이 없다', () => {
      render(NONE)
      expect($('[data-mail-delete]')).toBeNull()
    })
    it('확인 대화상자를 거쳐 지우고 새로 그린다', async () => {
      render(GMAIL)
      await click($('[data-mail-delete]'))
      expect(deleteWorkspaceMailSettings).not.toHaveBeenCalled()
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(dialog.textContent).toContain('서버 환경변수 설정이 있으면 그 설정으로 발송하고')
      await click(dialog.querySelector('[data-mail-delete-confirm]'))
      expect(deleteWorkspaceMailSettings).toHaveBeenCalledWith('w-1')
      expect(refresh).toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '메일 발송 설정을 삭제했습니다.' }))
    })
    it('삭제 실패는 대화상자를 닫고 문구를 보인다', async () => {
      deleteWorkspaceMailSettings.mockResolvedValue({ ok: false, error: '지울 설정이 없습니다.' })
      render(GMAIL)
      await click($('[data-mail-delete]'))
      await click(document.querySelector('[data-mail-delete-confirm]'))
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect($('[role="alert"]')!.textContent).toBe('지울 설정이 없습니다.')
      expect(refresh).not.toHaveBeenCalled()
    })
  })
})
```
(사유 문구는 Task 2 가 정한 글자를 `t('mailSettings.reason.*')` 로 읽어 비교한다 — 이 테스트가 그 글자를 다시 적지 않는다.
테스트 파일은 `src/` 밖이라 한국어 리터럴 불변식의 대상이 아니다.)

- [ ] **Step 3: 테스트가 실패하는지 본다**

Run: `npx vitest run tests/components/mail-settings-editor.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/settings/MailSettingsEditor"`(파일이 아직 없다).

- [ ] **Step 4: 컴포넌트를 만든다**

`src/components/settings/MailSettingsEditor.tsx`:
```tsx
'use client'
// 워크스페이스 설정 › 메일 발송(설계 2026-10-15 §4). 서버가 읽은 보기(비밀번호 없음)와 발송 판정(status)을 그리고,
// 저장·테스트 발송·삭제는 서버 액션이 다시 판정한다(워크스페이스 관리자 가드 + 같은 순수 검사). 폼은 같은 검사를 먼저 돌려
// 서버에 가기 전에 사유를 보인다 — 비밀번호 빈칸 재사용 규칙(같은 host·username)도 같은 함수(canReusePassword)다.
// 비밀번호 칸은 늘 빈 값으로 시작하고 저장값을 내려받지 않는다. 숨김은 조건부 렌더로만 한다(상태 변형 display 유틸 금지 — CLAUDE.md CSS).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Info, Save, Send, ShieldAlert, Trash2 } from 'lucide-react'
import {
  deleteWorkspaceMailSettings, saveWorkspaceMailSettings, sendWorkspaceTestMail, type GetMailSettingsResult,
} from '@/app/actions/mailSettings'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import type { DictKey } from '@/lib/i18n/dict'
import { formatStampIn } from '@/lib/i18n/format'
import { fill } from '@/lib/i18n/translate'
import {
  MAIL_PORTS, canReusePassword, normalizeMailSettingsInput, reasonKey,
  type MailPreset, type MailSettingsInput,
} from '@/lib/mail/settingsInput'

type Initial = Extract<GetMailSettingsResult, { ok: true }>
type Status = Initial['status']
type Tone = 'ok' | 'warn' | 'bad'

const TONE_CLASS: Record<Tone, { box: string; icon: string }> = {
  ok: { box: 'bg-success-weak', icon: 'text-success' },
  warn: { box: 'bg-warning-weak', icon: 'text-warning' },
  bad: { box: 'bg-danger-weak', icon: 'text-danger' },
}

/** 판정 다섯 갈래 → 표지·색·문구 */
function statusView(s: Status, t: (k: DictKey) => string): { variant: string; tone: Tone; text: string } {
  if (s.source === 'workspace') {
    return s.valid
      ? { variant: 'workspace-valid', tone: 'ok', text: fill(t('mailSettings.status.workspaceValid'), { from: s.fromAddress }) }
      : { variant: 'workspace-invalid', tone: 'bad', text: t('mailSettings.status.workspaceInvalid') }
  }
  if (s.source === 'env') {
    return s.valid
      ? { variant: 'env-valid', tone: 'ok', text: t('mailSettings.status.envValid') }
      : { variant: 'env-invalid', tone: 'bad', text: t('mailSettings.status.envInvalid') }
  }
  return { variant: 'none', tone: 'warn', text: t('mailSettings.status.none') }
}

/** 라벨 + 안내 — id 는 호출부가 고정(smtp-*)한다. Field(useId)를 쓰지 않는 까닭: 로그인 폼과 겹치지 않는 고정 name/id 가 계약이다 */
function Row({ htmlFor, label, hint, children }: { htmlFor: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-fg-secondary">{label}</label>
      {children}
      {hint && <p className="text-meta leading-4 text-fg-muted">{hint}</p>}
    </div>
  )
}

export function MailSettingsEditor({ workspaceId, initial, timeZone = null }: {
  workspaceId: string
  initial: Initial
  /** 비밀번호 설정 시각을 찍을 tz(워크스페이스 달력) — 없거나 손상이면 시각 칸은 '—' */
  timeZone?: string | null
}) {
  const { t } = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const saved = initial.settings
  const [preset, setPreset] = useState<MailPreset>(saved?.preset ?? 'gmail')
  const [address, setAddress] = useState(saved?.preset === 'gmail' ? saved.username : '')
  const [host, setHost] = useState(saved?.preset === 'custom' ? saved.host : '')
  const [port, setPort] = useState(saved?.preset === 'custom' ? String(saved.port) : '587')
  const [secure, setSecure] = useState(saved?.preset === 'custom' ? saved.secure : false)
  const [username, setUsername] = useState(saved?.preset === 'custom' ? saved.username : '')
  const [fromAddress, setFromAddress] = useState(saved?.preset === 'custom' ? (saved.fromAddress ?? '') : '')
  // 비밀번호는 늘 빈 값으로 시작한다 — 빈칸 = 저장값 재사용(같은 host·username 일 때만, 서버가 다시 본다)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [action, setAction] = useState<'save' | 'test' | null>(null)
  const [pending, startTransition] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const busy = pending || deletePending

  const view = statusView(initial.status, t)
  const tone = TONE_CLASS[view.tone]
  const StatusIcon = view.tone === 'ok' ? CheckCircle2 : view.tone === 'bad' ? AlertTriangle : Info

  function clearMessages() { setError(null); setNotice(null) }

  function choosePreset(next: MailPreset) {
    if (next === preset) return
    // 입력하던 비밀번호를 다른 방식(다른 서버)으로 들고 가지 않는다
    setPreset(next); setPassword(''); clearMessages()
  }

  function choosePort(next: string) {
    setPort(next)
    // 포트와 보안 연결의 짝(DB 제약 workspace_mail_settings_tls): 465 는 SSL, 587·25 는 STARTTLS. 2525 는 그대로 둔다
    if (next === '465') setSecure(true)
    else if (next === '587' || next === '25') setSecure(false)
    clearMessages()
  }

  function buildInput(): MailSettingsInput {
    return preset === 'gmail'
      ? { preset, address, password }
      : { preset, host, port: Number(port), secure, username, password, fromAddress }
  }

  /** 서버와 같은 순수 검사 — 통과하면 null, 아니면 사유 문구 */
  function precheck(input: MailSettingsInput): string | null {
    const n = normalizeMailSettingsInput(input)
    if (!n.ok) return t(reasonKey(n.code))
    const stored = saved ? { host: saved.host, username: saved.username } : null
    if (n.value.password === null && !canReusePassword(n.value, stored)) return t(reasonKey('password_required'))
    return null
  }

  function run(kind: 'save' | 'test') {
    clearMessages()
    const input = buildInput()
    const reason = precheck(input)
    if (reason) { setError(reason); return }
    setAction(kind)
    startTransition(async () => {
      try {
        if (kind === 'test') {
          const res = await sendWorkspaceTestMail(workspaceId, input)
          if (!res.ok) { setError(res.error); return }
          setNotice(fill(t('mailSettings.testSent'), { to: res.to }))
          return
        }
        const res = await saveWorkspaceMailSettings(workspaceId, input)
        if (!res.ok) { setError(res.error); return }
        setPassword('')
        toast({ title: t('mailSettings.saved'), variant: 'success' })
        router.refresh()
      } catch {
        setError(t('wsAccounts.requestFailed'))
      } finally {
        setAction(null)
      }
    })
  }

  function confirmDelete() {
    clearMessages()
    startDelete(async () => {
      try {
        const res = await deleteWorkspaceMailSettings(workspaceId)
        // 성공이든 실패든 대화상자는 닫는다 — 실패 사유는 편집기 아래에 남겨야 보인다
        setConfirming(false)
        if (!res.ok) { setError(res.error); return }
        setPassword('')
        toast({ title: t('mailSettings.deleted'), variant: 'success' })
        router.refresh()
      } catch {
        setConfirming(false)
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  const passwordInput = (
    <input
      id="smtp-password"
      name="smtp-password"
      type="password"
      // 크로미움은 비밀번호 칸의 "off" 를 무시하고 로그인 비밀번호를 채운다 — new-password 로 막는다(설계 §4-5)
      autoComplete="new-password"
      className="app-input w-full"
      value={password}
      onChange={(e) => { setPassword(e.target.value); clearMessages() }}
      placeholder={saved ? t('mailSettings.passwordKeptPh') : undefined}
      disabled={busy}
    />
  )

  return (
    <div className="space-y-4">
      <div role="status" data-mail-status={view.variant}
        className={`flex items-start gap-2.5 rounded-xl border border-border px-3.5 py-3 ${tone.box}`}>
        <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden />
        <p className="text-sm leading-5 text-fg">{view.text}</p>
      </div>

      {saved && (
        <div className="space-y-1.5">
          <p data-mail-password-set className="text-xs text-fg-secondary">
            {fill(t('mailSettings.passwordSet'), {
              name: initial.passwordSetBy ?? t('mailSettings.passwordSetByUnknown'),
              at: formatStampIn(initial.passwordSetAt, timeZone),
            })}
          </p>
          {initial.passwordSetterIsAdmin === false && (
            <div role="status" data-mail-setter-warning className="flex items-start gap-2.5 rounded-xl border border-border bg-warning-weak px-3.5 py-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p className="text-xs leading-5 text-fg">{t('mailSettings.setterNotAdmin')}</p>
            </div>
          )}
          {initial.passwordSetterIsAdmin === 'unknown' && (
            <p role="status" data-mail-setter-unknown className="text-xs text-fg-secondary">{t('mailSettings.setterUnknown')}</p>
          )}
        </div>
      )}

      <div role="radiogroup" aria-label={t('mailSettings.preset.label')} className="flex flex-wrap gap-4">
        {(['gmail', 'custom'] as const).map(p => (
          <label key={p} className="flex items-center gap-1.5 text-sm text-fg">
            <input type="radio" name="smtp-preset" value={p} checked={preset === p} disabled={busy}
              onChange={() => choosePreset(p)} />
            {t(p === 'gmail' ? 'mailSettings.preset.gmail' : 'mailSettings.preset.custom')}
          </label>
        ))}
      </div>

      {preset === 'gmail' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Row htmlFor="smtp-username" label={t('mailSettings.gmail.address')}>
              <input id="smtp-username" name="smtp-username" type="email" autoComplete="off" className="app-input w-full"
                value={address} onChange={(e) => { setAddress(e.target.value); clearMessages() }}
                placeholder="name@gmail.com" disabled={busy} />
            </Row>
            <Row htmlFor="smtp-password" label={t('mailSettings.gmail.appPassword')}>{passwordInput}</Row>
          </div>
          <p className="text-xs leading-5 text-fg-secondary">{t('mailSettings.gmail.howto')}</p>
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-pending-weak px-3.5 py-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-pending" aria-hidden />
            <p className="text-xs leading-5 text-fg">{t('mailSettings.sendsNotice')} {t('mailSettings.gmail.dedicated')}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Row htmlFor="smtp-host" label={t('mailSettings.custom.host')}>
              <input id="smtp-host" name="smtp-host" autoComplete="off" className="app-input w-full font-mono"
                value={host} onChange={(e) => { setHost(e.target.value); clearMessages() }}
                placeholder="smtp.example.com" disabled={busy} />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row htmlFor="smtp-port" label={t('mailSettings.custom.port')}>
                <select id="smtp-port" name="smtp-port" className="app-input w-full" value={port}
                  onChange={(e) => choosePort(e.target.value)} disabled={busy}>
                  {MAIL_PORTS.map(p => <option key={p} value={String(p)}>{p}</option>)}
                </select>
              </Row>
              <Row htmlFor="smtp-secure" label={t('mailSettings.custom.secure')}>
                <select id="smtp-secure" name="smtp-secure" className="app-input w-full" value={secure ? 'ssl' : 'starttls'}
                  onChange={(e) => { setSecure(e.target.value === 'ssl'); clearMessages() }} disabled={busy}>
                  <option value="ssl">{t('mailSettings.custom.ssl')}</option>
                  <option value="starttls">{t('mailSettings.custom.starttls')}</option>
                </select>
              </Row>
            </div>
            <Row htmlFor="smtp-username" label={t('mailSettings.custom.username')}>
              <input id="smtp-username" name="smtp-username" autoComplete="off" className="app-input w-full"
                value={username} onChange={(e) => { setUsername(e.target.value); clearMessages() }} disabled={busy} />
            </Row>
            <Row htmlFor="smtp-password" label={t('mailSettings.custom.password')}>{passwordInput}</Row>
            <Row htmlFor="smtp-from" label={t('mailSettings.custom.from')} hint={t('mailSettings.custom.fromHint')}>
              <input id="smtp-from" name="smtp-from" type="email" autoComplete="off" className="app-input w-full"
                value={fromAddress} onChange={(e) => { setFromAddress(e.target.value); clearMessages() }} disabled={busy} />
            </Row>
          </div>
          <p className="text-xs leading-5 text-fg-secondary">{t('mailSettings.sendsNotice')}</p>
        </div>
      )}

      <p className="text-xs leading-5 text-fg-muted">{t('mailSettings.fromNameNote')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" data-mail-test icon={<Send className="h-4 w-4" />}
          busy={pending && action === 'test'} disabled={busy && action !== 'test'} onClick={() => run('test')}>
          {pending && action === 'test' ? t('mailSettings.testing') : t('mailSettings.test')}
        </Button>
        <Button variant="primary" data-mail-save icon={<Save className="h-4 w-4" />}
          busy={pending && action === 'save'} disabled={busy && action !== 'save'} onClick={() => run('save')}>
          {pending && action === 'save' ? t('mailSettings.saving') : t('common.save')}
        </Button>
        {saved && (
          <Button variant="ghost" data-mail-delete className="text-danger" icon={<Trash2 className="h-4 w-4" />}
            disabled={busy} onClick={() => { clearMessages(); setConfirming(true) }}>
            {t('mailSettings.delete')}
          </Button>
        )}
        <span className="basis-full text-meta text-fg-muted">{t('mailSettings.testHint')}</span>
      </div>

      {notice && <p role="status" data-mail-notice className="text-sm font-medium text-success">{notice}</p>}
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

      <Modal
        open={confirming}
        onClose={() => { if (!deletePending) setConfirming(false) }}
        title={t('mailSettings.deleteTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={deletePending} onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" data-mail-delete-confirm busy={deletePending} onClick={confirmDelete}>
              {deletePending ? t('mailSettings.deleting') : t('mailSettings.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-secondary">{t('mailSettings.deleteConfirm')}</p>
      </Modal>
    </div>
  )
}
```

메모:
- `useLocale().t` 는 `DictKey` 만 받는다 — `reasonKey(code)` 는 Task 2 계약대로 `DictKey` 를 돌려준다.
- `toast` 는 액션 성공 뒤에만, 오류는 편집기 안 `role="alert"` 한 줄(ProjectInviteManager 와 같은 꼴). 저장·삭제 뒤 `router.refresh()` 로
  서버가 `getWorkspaceMailSettings` 를 다시 읽어 상태 줄·설정자 줄·삭제 버튼이 새 값으로 그려진다(편집기 상태는 남고 비밀번호만 비운다).
- 숨김은 모두 조건부 렌더(`preset === 'gmail' ? … : …`, `saved && …`) — `hidden`·상태 변형 display 클래스를 쓰지 않는다.
  `sm:grid-cols-2` 는 display 유틸이 아니라 열 수라 안전망과 무관하다.
- 한국어는 주석에만 있다(`placeholder="name@gmail.com"`·`smtp.example.com` 은 영문 표본).

- [ ] **Step 5: 테스트가 통과하는지 본다**

Run: `npx vitest run tests/components/mail-settings-editor.test.tsx`
Expected: PASS (전 사례).

- [ ] **Step 6: 불변식·타입을 확인한다**

Run:
```bash
npx vitest run tests/invariants/i18n-no-korean-literals.test.ts tests/invariants/i18n-server-messages.test.ts \
  tests/invariants/instant-format-zone.test.ts tests/invariants/settings-editor-uuid.test.ts \
  tests/invariants/no-english-eyebrow.test.ts tests/css/breakpoint-safety-net.test.ts
npx tsc --noEmit -p tsconfig.json
npm run lint
```
Expected: 전부 PASS / 타입 오류 0 / 린트 오류 0.
- 한국어 리터럴 불변식이 `MailSettingsEditor.tsx` 를 잡으면: 화면 글자를 Step 1 의 키로 옮긴다(ALLOW 에 더하지 않는다).
- `i18n-server-messages` 의 "서버 키와 공용 키는 겹치지 않는다" 가 실패하면 `srv.mailSettings.*` 와 같은 키를 공용 사전에 둔 것 — 공용 쪽 이름을 바꾼다.
- tsc 가 TS1117(중복 속성)을 내면 Task 2 블록과 키가 겹친 것 — 이 Task 의 키를 바꾼다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/settings/MailSettingsEditor.tsx src/lib/i18n/dict/settingsUi.ts tests/components/mail-settings-editor.test.tsx
git commit -m "$(cat <<'MSG'
워크스페이스 메일 발송 편집기 — 관리자가 Gmail 주소·앱 비밀번호만 넣고 테스트·저장·삭제하게

상태 줄은 발송 판정 다섯 갈래(워크스페이스·환경변수 × 정상·손상, 미설정)를 그대로 보여 지금 메일이 나가는지 숨기지 않는다.
비밀번호 칸은 늘 빈 값으로 시작하고 new-password·smtp-* 이름으로 브라우저가 로그인 비밀번호를 채우지 못하게 한다.
입력 검사는 서버와 같은 순수 함수를 먼저 돌려 사유를 보이고, 비밀번호를 넣은 사람이 관리자가 아니게 되면 경고한다.
화면 문구는 공용 설정 사전(mailSettings.*)에만 둔다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```
(src 와 tests 만 — `supabase/migrations/*` 는 넣지 않는다(G1). UI 위험 파일(`globals.css`·레이아웃·`src/components/app/*`)을 건드리지 않으므로 G2 트레일러는 필요 없다.)

- [ ] **Step 8: 이웃 테스트를 다시 돌린다**

Run:
```bash
npx vitest run tests/components/ tests/invariants/ tests/mail/settings-input.test.ts
```
Expected: PASS. (`tests/ui/workspace-settings-page.test.tsx` 는 Task 8 이 편집기를 목으로 갈아 끼운 뒤 그 Task 에서 돌린다.)

---

### Task 8: 워크스페이스 설정 페이지에 '메일 발송' 섹션 연결

선행: Task 6(`src/app/actions/mailSettings.ts` — `getWorkspaceMailSettings`·`GetMailSettingsResult`)과 Task 7(`src/components/settings/MailSettingsEditor.tsx`)이 끝나 있어야 한다(이 작업의 테스트가 두 모듈 경로를 목으로 바꾸고, 페이지가 둘을 import 한다).

**Files:**
- Modify: `src/app/(app)/w/[slug]/settings/page.tsx`
- Modify: `src/lib/i18n/dict/pagesUi.ts`
- Test: `tests/ui/workspace-settings-page.test.tsx`

확인해 둔 사실(계획 작성 시 리포에서 확인):
- `lucide-react` 는 `Send` 를 내보낸다(`node -e "require('lucide-react').Send"` → object, `src/components/settings/ProjectInviteManager.tsx:5` 가 이미 import).
- `tests/invariants/i18n-no-korean-literals.test.ts` 는 이 페이지의 한국어 리터럴 상한이 `max: 9` 이고 지금 정확히 9개다. 이 작업은 한국어 리터럴을 하나도 더하지 않는다 — `searchText` 는 영어 낱말만, 섹션 문구는 `t(…)`, 로그 문구는 `console.error(…)` 인자(검사 제외)다. ALLOW 표는 고치지 않는다.
- `tests/invariants/module-page-gates.test.ts`(`inspectScopeFirst`): 첫 데이터 await 가 `workspacePageAccess(slug)` 여야 한다 — 새 조회는 그 뒤의 `Promise.all` 에 넣으므로 그대로 통과.
- `tests/invariants/project-page-gates.test.ts`: `mailSettings.ts` 는 `'use server'`, `MailSettingsEditor.tsx` 는 `'use client'` 라 service_role 원천 탐색이 그 경계에서 멈춘다. 게이트(`await workspacePageAccess(`)도 사용보다 앞 줄이다.
- `tests/invariants/page-h1.test.ts`: `<h1` 을 더하지 않는다.
- `tests/invariants/no-english-eyebrow.test.ts`: `eyebrow={t('pages.wsSettings.nav.mail')}` 는 호출 인자라 검사 대상이 아니고 사전 값은 한국어다.
- 사전 키 `pages.wsSettings.nav.mail`·`pages.wsSettings.mailTitle` 은 아직 어디에도 없다(`grep -rn "wsSettings.nav.mail\|wsSettings.mailTitle" src` 0건) — `tests/invariants/i18n-server-messages.test.ts` 의 "서버 키와 공용 키는 겹치지 않는다" 를 깨지 않는다(`srv.*` 가 아님).
- `#workspace-invites` 앵커(`src/lib/data/inviteDomainNotice.ts:26`)는 그대로 둔다 — 섹션 id 를 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트로 고친다 — `tests/ui/workspace-settings-page.test.tsx`**

(a) 목 표(`vi.hoisted`)에 메일 조회·편집기 목을 더한다:

```diff
   notifyEditor: vi.fn<(p: Record<string, unknown>) => null>(() => null),
+  mail: vi.fn(),
+  mailEditor: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => <div data-mail-editor="" />),
 }))
```

(b) 모듈 목 두 줄을 `@/app/actions/authzEvents` 목 바로 아래와 `NotifyPolicyEditor` 목 바로 아래에 더한다:

```diff
 vi.mock('@/app/actions/authzEvents', () => ({ listAuthzEvents: (...a: unknown[]) => h.events(...a) }))
+vi.mock('@/app/actions/mailSettings', () => ({ getWorkspaceMailSettings: (...a: unknown[]) => h.mail(...a) }))
 vi.mock('@/components/settings/AuthzEventsList', () => ({ AuthzEventsList: (p: Record<string, unknown>) => h.eventsList(p) }))
```

```diff
 vi.mock('@/components/settings/NotifyPolicyEditor', () => ({ NotifyPolicyEditor: (p: Record<string, unknown>) => h.notifyEditor(p) }))
+vi.mock('@/components/settings/MailSettingsEditor', () => ({ MailSettingsEditor: (p: Record<string, unknown>) => h.mailEditor(p) }))
 vi.mock('@/components/settings/SettingsHistoryList', () => ({ SettingsHistoryList: () => null }))
```

(c) 기본 조회 결과(미설정)를 상수로 두고 `beforeEach` 에서 건다:

```diff
 const render = async () => renderToStaticMarkup((await WorkspaceSettingsPage({ params: Promise.resolve({ slug: 'alpha' }) })) as ReactElement)
+/** 메일 설정 조회 성공 — 저장된 행 없음·env 도 없음(설계 §3 getWorkspaceMailSettings 의 보기) */
+const MAIL_NONE = { ok: true, settings: null, status: { source: 'none' }, passwordSetBy: null, passwordSetAt: null, passwordSetterIsAdmin: null }
 
 beforeEach(() => {
   vi.clearAllMocks()
   h.access.mockResolvedValue(access())
   h.config.mockResolvedValue(config())
   h.history.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
   h.events.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
+  h.mail.mockResolvedValue(MAIL_NONE)
 })
```

(d) 관리자 아님 사례에 "메일 설정도 읽지 않는다" 단언을 더한다:

```diff
   it('워크스페이스 관리자가 아니면 그 워크스페이스 홈으로 돌려보내고 설정을 읽지 않는다', async () => {
     h.access.mockResolvedValue(access({ isAdmin: false }))
     await expect(render()).rejects.toThrow('NEXT_REDIRECT /w/alpha')
     expect(h.config).not.toHaveBeenCalled()
+    expect(h.mail).not.toHaveBeenCalled()
   })
```

(e) 목차 사례 — 이름의 범주 수(열 → 열한)와 기대값('초대' 앞에 '메일 발송'):

```diff
-  it('열 범주 목차를 스펙 순서로 낸다(달력 — SP5 과제 26, 회의록 첨부 — SP5 B3 과제 9, 회의록 폴더 — SP5 B2, 알림 — SP8 알림 정책, 보안 — SPU1 로컬 초안)', async () => {
+  it('열한 범주 목차를 스펙 순서로 낸다(달력 — SP5 과제 26, 회의록 첨부 — SP5 B3 과제 9, 회의록 폴더 — SP5 B2, 알림 — SP8 알림 정책, 보안 — SPU1 로컬 초안, 메일 발송 — 2026-10-15 설계 §4)', async () => {
     await render()
     expect(h.shell.mock.calls[0][0].items).toEqual([
       { id: 'workspace-general', label: '일반' }, { id: 'workspace-modules', label: '모듈·AI' },
-      { id: 'workspace-invites', label: '초대' }, { id: 'workspace-calendar', label: '달력' },
+      { id: 'workspace-mail', label: '메일 발송' }, { id: 'workspace-invites', label: '초대' }, { id: 'workspace-calendar', label: '달력' },
       { id: 'workspace-minutes', label: '회의록' }, { id: 'workspace-minute-roots', label: '회의록 폴더' },
       { id: 'workspace-menu', label: '메뉴' }, { id: 'workspace-notify', label: '알림' }, { id: 'workspace-security', label: '보안' }, { id: 'workspace-history', label: '기록' },
     ])
   })
```

(f) 설정 조회 실패 사례에 "메일 조회까지 가지 않는다" 단언(페이지가 그 앞에서 오류 화면을 돌려준다):

```diff
   it('설정 조회 실패는 404 나 빈 화면이 아니라 오류 화면이고 로그를 남긴다', async () => {
     const error = vi.spyOn(console, 'error').mockImplementation(() => {})
     h.config.mockRejectedValue(new ConfigUnavailableError('db down'))
     expect(await render()).toContain('data-load-error')
     expect(error).toHaveBeenCalledWith('[workspace settings] 설정 조회 실패:', expect.objectContaining({ workspaceId: WID }))
+    expect(h.mail).not.toHaveBeenCalled()
     error.mockRestore()
   })
```

(g) 새 사례 둘 — `describe` 블록 끝(알림 정책 사례 뒤, 마지막 `})` 앞)에 더한다:

```ts
  it('메일 발송 범주 — 이 워크스페이스 id 로 조회하고, 성공 결과(비밀번호 없는 보기)를 편집기에 그대로 넘긴다. 섹션은 모듈 뒤·초대 앞', async () => {
    const view = {
      ok: true,
      settings: { preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'ops@example.com', fromAddress: null, hasPassword: true },
      status: { source: 'workspace', valid: true, fromAddress: 'ops@example.com' },
      passwordSetBy: '김관리', passwordSetAt: '2026-10-15T01:00:00.000Z', passwordSetterIsAdmin: true,
    }
    h.mail.mockResolvedValue(view)
    const html = await render()
    expect(h.mail).toHaveBeenCalledTimes(1)
    expect(h.mail).toHaveBeenCalledWith(WID)
    expect(h.mailEditor).toHaveBeenCalledTimes(1)
    expect(h.mailEditor.mock.calls[0][0]).toEqual({ workspaceId: WID, initial: view, timeZone: 'UTC' }) // 기본 config 의 CAL_FIELDS_UTC_SUN(UTC) — 범위 tz 를 넘긴다
    expect(html).toMatch(/<section id="workspace-mail"><div data-mail-editor/)
    expect(html.indexOf('id="workspace-mail"')).toBeGreaterThan(html.indexOf('id="workspace-modules"'))
    expect(html.indexOf('id="workspace-mail"')).toBeLessThan(html.indexOf('id="workspace-invites"'))
    expect(html).not.toContain('data-load-error')
  })

  it('메일 설정 조회가 실패하면 그 섹션 안에만 ConfigLoadError 를 그리고 로그를 남긴다 — 다른 섹션은 그대로 그린다(3원칙 ①)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.mail.mockResolvedValue({ ok: false, error: '메일 설정을 불러오지 못했습니다.' })
    const html = await render()
    expect(h.mailEditor).not.toHaveBeenCalled()
    const section = html.match(/<section id="workspace-mail">([\s\S]*?)<\/section>/)?.[1] ?? ''
    expect(section).toContain('data-load-error')
    expect(html.match(/data-load-error/g)).toHaveLength(1)   // 다른 섹션은 오류로 바뀌지 않는다
    for (const id of ['workspace-general', 'workspace-modules', 'workspace-invites', 'workspace-calendar', 'workspace-notify', 'workspace-security', 'workspace-history']) {
      expect(html, id).toContain(`id="${id}"`)
    }
    expect(h.notifyEditor).toHaveBeenCalledTimes(1)
    expect(h.eventsList).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[workspace settings] 메일 설정 조회 실패:', expect.objectContaining({ workspaceId: WID, cause: '메일 설정을 불러오지 못했습니다.' }))
    error.mockRestore()
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ui/workspace-settings-page.test.tsx`
Expected: FAIL — 목차 사례(`workspace-mail` 항목 없음), 메일 사례 둘(`h.mail` 이 불리지 않음·`section#workspace-mail` 없음). 나머지 사례는 통과.

- [ ] **Step 3: 사전 키 둘을 더한다 — `src/lib/i18n/dict/pagesUi.ts`**

```diff
   'pages.wsSettings.nav.modulesAi': '모듈·AI',
+  'pages.wsSettings.nav.mail': '메일 발송',
   'pages.wsSettings.nav.invites': '초대',
```

```diff
   'pages.wsSettings.integrationsLink': '연동 자격증명 관리 바로가기',
+  'pages.wsSettings.mailTitle': '메일 발송',
   'pages.wsSettings.invitesTitle': '초대 정책',
```

(편집기 안의 문구는 Task 7 이 `settingsUi.ts` 의 `mailSettings.*` 에 둔다 — 같은 키를 여기 두지 않는다.)

- [ ] **Step 4: 페이지를 고친다 — `src/app/(app)/w/[slug]/settings/page.tsx`**

(a) 아이콘 import 에 `Send`:

```diff
-import { Settings2, Palette, Mail, Menu, History, CalendarDays, Paperclip, FolderTree, KeyRound, ShieldCheck, Bell } from 'lucide-react'
+import { Settings2, Palette, Mail, Menu, History, CalendarDays, Paperclip, FolderTree, KeyRound, ShieldCheck, Bell, Send } from 'lucide-react'
 import { listSettingsHistory } from '@/app/actions/settings'
 import { listAuthzEvents } from '@/app/actions/authzEvents'
+import { getWorkspaceMailSettings } from '@/app/actions/mailSettings'
 import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'
```

(b) 편집기 import:

```diff
 import { NotifyPolicyEditor } from '@/components/settings/NotifyPolicyEditor'
+import { MailSettingsEditor } from '@/components/settings/MailSettingsEditor'
 import { SettingsHistoryList } from '@/components/settings/SettingsHistoryList'
```

(c) 조회 — 기존 `Promise.all`(82행)에 메일 설정을 함께 싣고 실패를 남긴다:

```diff
-  const [history, authzEvents] = await Promise.all([listSettingsHistory({ workspaceId: access.id }), listAuthzEvents(access.id)])
+  // 메일 발송(설계 2026-10-15 §4) — 액션이 requireWorkspaceAdmin 을 다시 건다. 실패는 그 섹션만 오류로 그리고, 화면이 원문을 싣지 않으므로 여기서 남긴다(3원칙 ①)
+  const [history, authzEvents, mail] = await Promise.all([
+    listSettingsHistory({ workspaceId: access.id }), listAuthzEvents(access.id), getWorkspaceMailSettings(access.id),
+  ])
+  if (!mail.ok) console.error('[workspace settings] 메일 설정 조회 실패:', { workspaceId: access.id, cause: mail.error })
```

(d) 목차 — '초대' 앞에 '메일 발송':

```diff
       <SettingsShell items={[
         { id: 'workspace-general', label: t('pages.settingsNav.general') }, { id: 'workspace-modules', label: t('pages.wsSettings.nav.modulesAi') },
-        { id: 'workspace-invites', label: t('pages.wsSettings.nav.invites') }, { id: 'workspace-calendar', label: t('pages.settingsNav.calendar') }, …
+        { id: 'workspace-mail', label: t('pages.wsSettings.nav.mail') },
+        { id: 'workspace-invites', label: t('pages.wsSettings.nav.invites') }, { id: 'workspace-calendar', label: t('pages.settingsNav.calendar') }, …
```

(`…` 는 92행의 나머지 항목 — 손대지 않는다. 실제 편집은 92행 맨 앞 `{ id: 'workspace-invites'` 앞에 위 한 줄을 넣는 것뿐이다.)

(e) 섹션 — `workspace-modules` 섹션의 닫는 `</SectionCard>`(135행)와 `workspace-invites` 섹션(136행) 사이에 넣는다:

```diff
       </SectionCard>
+      {/* 메일 발송(설계 2026-10-15 §4) — 회의 안내·초대 메일의 발신 계정. searchText 는 영어 낱말만(이 파일의 한국어 리터럴 상한 9 — SettingsShell 이 화면 글자도 검색한다).
+          조회 실패는 이 섹션만 ConfigLoadError — 다른 섹션은 그대로 그린다 */}
+      <SectionCard id="workspace-mail" searchText="mail smtp gmail email app-password" eyebrow={t('pages.wsSettings.nav.mail')} title={t('pages.wsSettings.mailTitle')} icon={Send}>
+        {mail.ok
+          ? <MailSettingsEditor workspaceId={access.id} initial={mail} timeZone={historyCal.ok ? historyCal.calendar.timezone : null} />
+          : <ConfigLoadError error={mail.error} />}
+      </SectionCard>
       <SectionCard id="workspace-invites" searchText="invites.allowed_domains" eyebrow={t('pages.wsSettings.nav.invites')} title={t('pages.wsSettings.invitesTitle')} icon={Mail}>
```

`mail.ok` 로 좁히면 `mail` 은 `Extract<GetMailSettingsResult, { ok: true }>` 라 Task 7 의 `initial` 형과 맞는다(직렬화 가능한 평범한 객체 — 클라이언트 경계 통과).

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/ui/workspace-settings-page.test.tsx`
Expected: PASS (기존 15건 + 새 2건).

- [ ] **Step 6: 불변식과 주변 테스트를 다시 돌린다**

Run:
```bash
npx vitest run tests/invariants/i18n-no-korean-literals.test.ts tests/invariants/i18n-server-messages.test.ts tests/invariants/page-h1.test.ts tests/invariants/module-page-gates.test.ts tests/invariants/project-page-gates.test.ts tests/invariants/no-english-eyebrow.test.ts tests/components/settings-shell.test.tsx tests/data/invite-domain-notice.test.ts tests/components/project-invite-manager.test.tsx
npm run typecheck
```
Expected: 모두 PASS, 타입 오류 0. 특히
- `i18n-no-korean-literals` — `src/app/(app)/w/[slug]/settings/page.tsx` 의 한국어 리터럴이 그대로 9(상한 9). 늘었다면 `searchText` 나 JSX 글자에 한국어가 들어간 것이다 — 사전 키로 옮긴다(ALLOW 상한을 올리지 않는다).
- `module-page-gates` — 첫 데이터 await 가 여전히 `workspacePageAccess(slug)`.
- `project-page-gates` — `getWorkspaceMailSettings`('use server')·`MailSettingsEditor`('use client')는 원천으로 잡히지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add "src/app/(app)/w/[slug]/settings/page.tsx" src/lib/i18n/dict/pagesUi.ts tests/ui/workspace-settings-page.test.tsx
git commit -m "$(cat <<'EOF'
워크스페이스 설정에 '메일 발송' 섹션을 단다 — 관리자가 재배포 없이 발신 계정을 정하는 자리

목차의 '초대' 앞에 두고, 조회 실패는 그 섹션만 ConfigLoadError 로 그려 다른 설정은 그대로 쓰게 한다.
검색 낱말은 영어만 둔다(이 페이지의 한국어 리터럴 상한 9 — 화면 글자로도 '메일' 이 찾힌다).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

UI 위험 파일(`globals.css`·레이아웃·`src/components/app/*`)은 건드리지 않으므로 브랜치·`Preview-checked:` 트레일러가 필요 없다(pre-push G2 대상 아님). 화면 눈확인은 Task 9 의 로컬 `npm run dev` 에서 한다.

---

### Task 9: 최종 검증과 운영 반영

선행: Task 1~8 이 모두 커밋돼 있어야 한다(Task 1 은 마이그레이션 단독 커밋 — G1). 이 작업은 새 코드를 쓰지 않는다. 검증이 실패하면 그 실패를 낸 작업의 파일을 고쳐 별도 커밋으로 올리고 이 작업의 해당 단계부터 다시 돈다.
문서 두 곳(`.env.local.example`·`docs/runbook-staging.md`)만 고친다.

**[사람 승인 필요]** 표시가 붙은 단계(Step 11 운영 DB 적용, Step 12 이력 행, Step 13 Vercel 환경변수, Step 14 `main` push)는 **사람이 명시적으로 승인한 뒤에만** 실행한다. 에이전트는 명령을 보여 주고 멈춘다. `main` push 는 곧 운영 배포다(CLAUDE.md).

**Files:**
- Modify: `.env.local.example` (메일 발송 절 머리 주석)
- Modify: `docs/runbook-staging.md` (§5 표의 스키마 범위, Vercel 환경변수 목록, 메일 발송 한 단락)
- Test(다시 돌림만): 전체 `npm run test`, `npm run test:rls`, `tests/settings/operational-env.test.ts`, `tests/settings/catalog-sync.test.ts`, `tests/invariants/legacy-auth-removed.test.ts`

확인해 둔 사실(계획 작성 시 리포에서 확인):
- `package.json` 스크립트: `typecheck`(tsc --noEmit), `lint`, `test`(vitest run), `test:rls`(`vitest run -c vitest.config.rls.ts` — 로컬 Postgres 필요, 파일 직렬), `build`, `db:reset`, `db:diff:baseline`, `settings:verify`, `db:apply`, `smoke:prod`.
- CI(`.github/workflows/ci.yml`)는 `supabase db reset --version 0001` → `supabase migration up --local` → `npm run test:rls` 순서로 돈다. 로컬도 같은 것을 먼저 돌려 둔다.
- `scripts/db-apply.mjs`: `--target prod` 는 `--yes` 가 없고 대상 ref 를 손으로 다시 입력받는다(사람이 입력한다). `schema_migrations` 는 쓰지 않는다. 토큰은 키체인 "Supabase CLI" 항목 또는 `SUPABASE_ACCESS_TOKEN`.
- 이 리포 폴더에는 `.vercel/` 링크가 없다 — `vercel env` 는 `--project d-flow --scope leedonseoks-projects` 를 명시한다(CLI 64.0.2 의 `vercel env add`/`ls` 는 `--project` 를 받는다). `vercel env add` 는 값을 stdin 으로 받는다(`NAME=value` 위치 인자 금지). `printf '%s'` 로 끝 줄바꿈 없이 넘긴다.
- `NEXT_PUBLIC_APP_URL` 은 `src/lib/settings/operational.ts` 에서 `env_public`·`apply: 'rebuild'` 다 — 빌드 때 굳으므로 **코드 push(=빌드) 전에** 넣는다(설계 §7-3).
- 비밀번호 재설정 링크의 노출 판정 `passwordResetMailAvailable()`(`src/lib/auth/passwordResetMail.ts`)은 env 판정 `mailConfigured()` 를 그대로 쓴다(설계 범위 밖). 그래서 **운영에 워크스페이스 메일 설정만 저장해도 로그인 화면의 재설정 링크는 숨겨진 채다** — 문서에 적는다.
- 로컬 메일함: `supabase/config.toml` `[inbucket]` 의 웹 화면 `port = 54324`, SMTP 는 `# smtp_port = 54325` 주석을 풀어야 열린다(`.env.local.example` 의 inbucket 예시가 그 절차를 적어 둠). `.env.local` 은 `.gitignore` 의 `.env*` 로 무시된다.
- **워크스페이스 행은 로컬 inbucket 으로 시험할 수 없다**: 저장 때 `normalizeMailSettingsInput` 이 IP 리터럴·`localhost`·점 없는 단일 레이블을 `host_invalid` 로 거르고(Task 2), DB 제약도 소문자 DNS 이름만 받으며(Task 1), 발송 때 `vetMailHost` 가 사설·루프백 대역을 거른다(Task 3). 로컬 실발송 시험은 env 경로(inbucket)로 하고, 워크스페이스 경로의 실발송은 실제 Gmail 앱 비밀번호가 있을 때만 한다 — 없으면 단위 테스트(`tests/mail/*`·`tests/actions/mail-settings-gate.test.ts`)가 근거다.
- `.githooks/pre-push` 의 `UI_RE` 는 레이아웃 여섯·`globals.css`·`src/components/app/` 뿐이다. 이 기능의 화면 파일(`src/app/(app)/w/[slug]/settings/page.tsx`·`src/components/settings/MailSettingsEditor.tsx`)은 들지 않으므로 G2 의 `Preview-checked:` 트레일러는 필요 없다. G4 는 Task 1 커밋(또는 범위 안 빈 커밋)의 `Staging-verified:` 트레일러를 요구한다.
- `git push --dry-run` 은 "보내는 것만 빼고 다 한다" — pre-push 훅(G1~G5)을 원격을 바꾸지 않고 미리 돌려 볼 수 있다.
- `tests/settings/operational-env.test.ts` 는 `.env.local.example` 에서 `^\s*(#\s*)?NAME=` 꼴만 읽어 레지스트리 이름이 다 있는지 본다. 이 작업은 `NAME=` 줄을 지우지 않고 주석 문장만 더한다. `tests/invariants/legacy-auth-removed.test.ts` 는 같은 파일에 옛 비밀 이름이 없는지 본다 — 더하지 않는다.
- `docs/settings-catalog.md` 는 `OPERATIONAL_SETTINGS`·레지스트리에서 생성된다(`tests/settings/catalog-sync.test.ts`). 새 표는 레지스트리에 넣지 않는다(설계에 없음 — `OperationalDef.editor` 에 워크스페이스 관리자 칸도 없다). 카탈로그는 바뀌지 않아야 한다.

- [ ] **Step 1: 출발 상태를 확인한다**

```bash
git status --short                       # 비어 있어야 한다(병렬 세션의 dirty 파일이 있으면 손대지 말고 사람에게 알린다)
git fetch origin
git status -sb                           # "## main...origin/main [ahead N]" — behind 가 있으면 멈추고 사람에게 알린다
git log --oneline origin/main..HEAD      # Task 1~8 커밋이 보인다
docker info >/dev/null 2>&1 && echo docker-ok
supabase --version
```
Expected: 작업 트리 깨끗, `ahead` 만, `docker-ok`. Docker 가 꺼져 있으면 Docker Desktop/colima 를 켠 뒤 `npm run db:start`.

- [ ] **Step 2: 타입·린트**

```bash
npm run typecheck
npm run lint
```
Expected: 둘 다 오류 0(종료 코드 0). 경고가 새로 생겼으면 그 파일의 작업에서 고친다.

- [ ] **Step 3: 단위 테스트 전체**

```bash
npm run test
```
Expected: 전부 PASS. 실패하면 아래 중 어디서 났는지 보고 해당 작업의 파일을 고친다(이 기능이 건드리는 불변식·게이트):
- `tests/invariants/i18n-no-korean-literals.test.ts` — 새 파일·설정 페이지의 한국어 리터럴 상한(페이지는 9 — Task 8 은 더하지 않음)
- `tests/invariants/i18n-server-messages.test.ts` — `srv.mailSettings.*`(서버)와 `mailSettings.*`(공용) 키가 겹치지 않음
- `tests/gates/*`(매니페스트 `tests/gates/manifest.ts` 의 네 액션 — `nul('workspaceAdmin')`, 표본 `[W]`/`[W, {}]`)
- `tests/invariants/admin-scope.test.ts` — `transport.ts`·`workspaceSmtp.ts`·`mailSettings.ts` 에 `createAdminClient` 가 없어야(감사표 행 없음)
- `tests/invariants/settings-writes.test.ts`, `tests/settings/operational-env.test.ts`(`process.env` 를 통째로 넘기는 파일은 `transport.ts` 만 허용)
- `tests/mail/*`, `tests/actions/mail-settings-gate.test.ts`, `tests/actions/meeting-notify-gate.test.ts`, `tests/actions/project-invites-gate.test.ts`, `tests/components/mail-settings-editor.test.tsx`, `tests/ui/workspace-settings-page.test.tsx`
- `tests/invariants/migration-files.test.ts`(번호 0059 유일), `tests/css/breakpoint-safety-net.test.ts`(편집기에 상태 변형 display 유틸 없음)

- [ ] **Step 4: 프로덕션 빌드**

```bash
npm run build
```
Expected: `✓ Compiled successfully`, 종료 코드 0. `'server-only'` 모듈(`workspaceSmtp.ts`)이 클라이언트 번들로 끌려가면 여기서 실패한다 — `MailSettingsEditor.tsx` 가 `settingsInput.ts`(공용)·액션(`'use server'`)만 import 하는지 확인한다.

- [ ] **Step 5: DB 리허설 — 리셋, CI 순서 대조, RLS 테스트**

```bash
npm run db:reset                 # 기준선 + 0001~0059 + seed. 0059 의 사후 검사(do 블록)가 여기서 돈다
npm run test:rls                 # tests/rls 전체(Task 1 이 더한 메일 설정 RLS 사례·delete_empty_workspace 부속 삭제 포함)
npm run db:diff:baseline         # CI db 잡과 같은 순서(0001 까지 재생 → 기준선 대조 → migration up)
npm run test:rls                 # migration up 으로 다시 올린 DB 에서 한 번 더(CI 와 같은 상태)
# 리셋이 계정까지 지웠다 — 플랫폼 관리자·워크스페이스(기본 slug default)를 다시 만든다.
# 프롬프트 없이 돌리도록 env 로 넘긴다. 비밀번호는 이 셸 변수로만 건네고 파일(.env.local·스크립트·계획)에 남기지 않는다 — read -s 로 받는다.
read -s -p '부트스트랩 비밀번호: ' BOOTSTRAP_PASSWORD; echo
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD="$BOOTSTRAP_PASSWORD" npm run dev:bootstrap
unset BOOTSTRAP_PASSWORD
npm run settings:verify
```
Expected: `db:reset` 이 `Finished supabase db reset` 로 끝나고 0059 에서 `RAISE EXCEPTION` 이 없다. `test:rls` 전부 PASS — 특히 `tests/rls/workspace-isolation.test.ts`(isolation-map 의 `A_ROW_FILTER`·`UPDATE_DENIED_BY_GRANT` 와 `fixture-ws.sql` 의 메일 설정 행이 짝), `tests/rls/workspace-rename-delete.test.ts`(빈 워크스페이스 삭제), `tests/rls/h2-table-grants.test.ts`, `tests/rls/schema-invariants.test.ts`. `db:diff:baseline` 은 차이 0. `settings:verify` 통과.

- [ ] **Step 6: 커밋 범위가 훅을 통과하는지 미리 본다(G1·G4)**

```bash
# 커밋마다 파일 목록 — supabase/migrations/* 가 든 커밋에 src/ 가 섞이지 않아야 한다(G1)
git log --reverse --format='--- %h %s' --name-only origin/main..HEAD
# G4 트레일러 — 범위 안 어느 커밋에든 있어야 한다
git log --format='%h %(trailers:key=Staging-verified,valueonly,separator=%x20)' origin/main..HEAD | grep -v ' $'
```
Expected: 0059 마이그레이션 커밋(Task 1)은 `supabase/migrations/0059_*`·`supabase/rollbacks/0059_*`·`tests/rls/*` 만, 둘째 명령이 한 줄 이상(`<해시> local db reset <일시>`).
트레일러가 없으면(Task 1 을 리셋 전에 커밋한 경우) Step 5 가 초록인 지금 빈 커밋으로 남긴다:

```bash
git commit --allow-empty -m "0059 워크스페이스 메일 설정 — 로컬 db reset·RLS 테스트 리허설 통과

마이그레이션 커밋에 리허설 트레일러가 빠져 G4 가 main push 를 막는다. 리셋과 test:rls 가 초록인 지금 범위 안 빈 커밋으로 근거를 남긴다." \
  --trailer "Staging-verified: local db reset $(date '+%Y-%m-%d %H:%M')" \
  --trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 로컬 화면 확인 — env 경로(inbucket 실발송)**

로컬 메일함의 SMTP 포트를 **임시로** 연다(커밋하지 않는다):

```bash
# supabase/config.toml [inbucket] 의 '# smtp_port = 54325' 주석을 푼다 — 끝나면 Step 9 에서 되돌린다
sed -i '' 's/^# smtp_port = 54325$/smtp_port = 54325/' supabase/config.toml
git diff --stat supabase/config.toml     # 1 file changed, 1 insertion, 1 deletion
npm run db:stop && npm run db:start      # stop 은 볼륨을 남긴다 — Step 5 의 부트스트랩 계정은 그대로
```

`.env.local`(git 무시 파일)에 inbucket env 를 넣는다 — `.env.local.example` 의 inbucket 예시 그대로:

```bash
cat >> .env.local <<'ENV'
SMTP_HOST=127.0.0.1
SMTP_PORT=54325
SMTP_SECURE=false
SMTP_AUTH=none
SMTP_FROM_ADDRESS=noreply@example.com
ENV
npm run dev
```

기동 확인(에이전트가 할 수 있는 몫 — 이 샌드박스의 브라우저는 localhost 에 닿지 않는다, `.claude/skills/verify`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login              # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/w/default/settings   # 307 → /login (미들웨어)
```

사람이 브라우저로 확인한다(Step 5 의 부트스트랩 계정으로 로그인, `http://localhost:3000/w/default/settings#workspace-mail`):
1. 목차에 '메일 발송' 이 '초대' 바로 앞에 있고, 설정 검색창에 `메일`·`smtp` 를 치면 이 섹션이 남는다.
2. 상태 줄이 env·valid 문구(`mailSettings.status.envValid` — "서버 환경변수 설정으로 발송 중")다. 저장된 행이 없으므로 '설정 삭제' 버튼이 없다.
3. 방식 전환(Gmail ↔ 직접 입력)이 되고, 두 방식 모두 비밀번호 칸이 비어 있다.
4. 직접 입력에서 서버 주소 `127.0.0.1`·`localhost`·`mailhost` 를 넣고 저장 → 셋 다 호스트 사유 문구(`mailSettings.reason.host_invalid`), 행이 생기지 않는다(상태 줄 그대로).
5. 직접 입력 포트 465 + STARTTLS → 보안 짝 사유 문구(`mailSettings.reason.tls_mismatch`). Gmail 에서 주소 `abc` → 주소 형식 사유.
6. 직접 입력 서버 `smtp.rls.invalid`·포트 2525·STARTTLS·계정 `mailer@example.com`(이메일 형식 — 보내는 주소를 비워 두면 계정이 발신 주소가 되므로 이메일 형식이어야 `normalizeMailSettingsInput` 이 `from_invalid` 로 막지 않고 `vetMailHost` 까지 간다. 계정을 이메일이 아닌 값으로 두려면 **보내는 주소**에 `mailer@example.com` 을 채운다)·비밀번호 아무 값 → **테스트 메일 보내기** → "이 메일 서버 주소는 쓸 수 없습니다."(`MAIL_HOST_NOT_ALLOWED`). `.invalid` 는 DNS 가 풀지 않는다 — 조회가 `ENOTFOUND` 로 실패하거나 빈 결과를 돌려주고, `vetMailHost` 는 둘 다 `{ ok: false }` 로 거부하므로 사설 대역 거부와 **같은 문구**가 나온다(이 사례는 대역 검사가 아니라 해석 실패 경로를 본다). SMTP 연결은 하지 않으므로 결과가 결정적이다.
7. 아무 프로젝트에서 회의 안내 메일을 보낸다(회의 저장 → 안내 발송) → `http://127.0.0.1:54324` 메일함에 도착, 발신 `noreply@example.com`, 표시명은 워크스페이스 '일반' 의 메일 발신 이름.
8. 초대 허용 도메인을 `example.com` 으로 두고 프로젝트 초대 1건 → 같은 메일함에 초대 메일 도착.

- [ ] **Step 8: 로컬 화면 확인 — 워크스페이스 경로(실제 Gmail 앱 비밀번호가 있을 때만)**

워크스페이스 행은 로컬 inbucket 을 가리킬 수 없다(위 "확인해 둔 사실"). 발송 전용 Gmail 계정의 앱 비밀번호가 있으면 사람이 같은 화면에서:
1. Gmail 방식에 주소·앱 비밀번호(구글이 보여 준 4자 띄어쓰기 그대로 붙여 넣어도 된다) → **테스트 메일 보내기** → 로그인한 본인 주소로 1통 도착. 결과 문구에 받는 주소가 보인다.
2. **저장** → 상태 줄 workspace·valid("이 워크스페이스 설정으로 발송 중 · 보내는 주소 …"), 비밀번호 칸은 다시 비고 자리표시 "저장됨 · 바꾸려면 새로 입력".
3. 비밀번호를 비운 채 다시 저장 → 성공(같은 주소 — 저장값 재사용). 직접 입력으로 바꿔 다른 서버로 비밀번호 없이 저장 → 비밀번호 필요 사유.
4. 회의 안내 1건 → Gmail '보낸편지함'에 있고 inbucket 에는 오지 않는다(워크스페이스 설정이 env 보다 앞선다).
5. **설정 삭제** → 확인 대화상자 → 상태 줄이 env·valid 로 돌아간다. 다시 삭제 버튼은 사라진다.

앱 비밀번호가 없으면 이 단계는 건너뛰고, 근거는 Step 3 의 `tests/mail/workspace-smtp.test.ts`·`tests/mail/transport.test.ts`·`tests/actions/mail-settings-gate.test.ts`·`tests/components/mail-settings-editor.test.tsx` 통과로 갈음한다고 완료 보고에 적는다.

- [ ] **Step 9: 로컬 임시 변경을 되돌린다**

```bash
# dev 서버(Ctrl+C) 정지 뒤
git checkout -- supabase/config.toml
git status --short                       # 비어 있어야 한다(.env.local 은 무시 파일 — SMTP_* 줄은 남겨도 되고 지워도 된다)
npm run db:stop && npm run db:start      # inbucket SMTP 포트를 다시 닫는다(운영 반영 뒤 Step 18 에서 최종 정지)
```

- [ ] **Step 10: 문서 두 곳을 고친다**

(a) `.env.local.example` — 메일 발송 절 머리(72행 부근). `NAME=` 줄은 하나도 바꾸지 않는다(`tests/settings/operational-env.test.ts`).

old:
```
# ── 메일 발송(회의 안내·프로젝트 초대) — SMTP ──
# 공급자 중립(회사 SMTP·Gmail·로컬 inbucket). 공급자 기본값은 없다 — SMTP_HOST 를 비우면 발송 액션이
```
new:
```
# ── 메일 발송(회의 안내·프로젝트 초대) — SMTP ──
# 워크스페이스 설정 › 메일 발송에 계정을 저장한 워크스페이스는 그 계정으로 보내고 아래 SMTP_* 를 보지 않는다.
# 우선순위: 워크스페이스 설정 → 아래 SMTP_* → 미설정. 저장된 설정이 잘못돼도 아래로 내려오지 않는다(발송 실패로 알린다).
# 워크스페이스 설정은 IP 주소·localhost·점 없는 이름·사설 대역으로 풀리는 서버를 받지 않는다 — 로컬 inbucket 시험은 아래 env 로 한다.
# 로그인 화면의 비밀번호 재설정 링크는 아래 SMTP_* 로만 판정한다(워크스페이스 설정과 무관 — 재설정 메일은 Supabase Auth 가 보낸다).
# 공급자 중립(회사 SMTP·Gmail·로컬 inbucket). 공급자 기본값은 없다 — SMTP_HOST 를 비우면 발송 액션이
```

(b) `docs/runbook-staging.md` §5.

old:
```
| 스키마 | 기준선 + 0001~0058 (첫 배포 시점) |
```
new:
```
| 스키마 | 기준선 + 0001~0059 (첫 배포 0058, 0059 `workspace_mail_settings` 2026-10-15) |
```

old:
```
**Vercel 환경변수 — Production 에만 넣었다**: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`CRON_SECRET`.
`APP_ENV` 는 `next.config.ts` 가 `VERCEL_ENV` 에서 옮긴다. AI 키·SMTP·초대 허용 도메인·기능 스위치(`.env.local.example`)는 넣지 않았다 — 그 기능들은 꺼져 있다.
```
new:
```
**Vercel 환경변수 — Production 에만 넣었다**: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`CRON_SECRET`,
그리고 `NEXT_PUBLIC_APP_URL=https://d-flow-eight.vercel.app`(2026-10-15 — 회의 안내·초대 메일 링크의 기준 주소. 빌드 때 굳으므로 바꾸면 다시 배포한다).
`APP_ENV` 는 `next.config.ts` 가 `VERCEL_ENV` 에서 옮긴다. AI 키·SMTP·초대 허용 도메인·기능 스위치(`.env.local.example`)는 넣지 않았다 — 그 기능들은 꺼져 있다.

**메일 발송(2026-10-15)**: 회의 안내·초대 메일은 워크스페이스 설정 › 메일 발송에 저장한 계정으로 나간다(표 `workspace_mail_settings`, 0059 — service_role 전용,
비밀번호는 평문 저장이고 지키는 것은 권한뿐이다). 우선순위는 워크스페이스 설정 → env `SMTP_*` → 미설정이다. 운영에는 `SMTP_*` 를 넣지 않았으므로
설정을 저장하지 않은 워크스페이스는 메일을 보내지 않는다. 계정을 바꾸는 데 재배포가 필요 없다. 로그인 화면의 비밀번호 재설정 링크는 여전히 env `SMTP_*`
(`mailConfigured()`)로만 판정하므로 숨겨진 채다 — 재설정 메일을 열려면 Supabase Auth 의 SMTP 와 env `SMTP_*` 를 따로 정한다(`docs/runbook-selfhost.md`).
```

문서 관련 검사를 돌린다:

```bash
npx vitest run tests/settings/operational-env.test.ts tests/settings/catalog-sync.test.ts tests/invariants/legacy-auth-removed.test.ts
```
Expected: PASS(변경 전과 같은 개수).

커밋(문서 전용 — 코드·마이그레이션과 섞지 않는다). 이 문서는 Step 11~13 이 끝나야 사실이 되므로 **push(Step 14) 전에 그 셋을 반드시 끝낸다**:

```bash
git add .env.local.example docs/runbook-staging.md
git commit -m "메일 발송 우선순위와 0059·NEXT_PUBLIC_APP_URL 운영 반영을 문서에 적는다

워크스페이스 설정이 env SMTP_* 를 앞서게 되면서 .env.local.example 만 읽은 사람은 env 를 고쳐도 왜 안 바뀌는지 알 수 없다.
운영 runbook 에는 0059 적용·새 환경변수와, 재설정 링크가 여전히 env 판정이라 숨겨진 채라는 사실을 남긴다." \
  --trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: [사람 승인 필요] 운영 DB 에 0059 를 적용한다**

전제: Step 5 초록, Step 6 의 G4 트레일러 있음. 승인을 받은 뒤 사람이 실행한다(대상 ref 를 손으로 다시 입력하는 확인이 있다).

```bash
PROD_REF=aivjcfoeshnhqdrfteyq npm run db:apply -- supabase/migrations/0059_workspace_mail_settings.sql --target prod
# 프롬프트: 운영 적용입니다. … 계속하려면 "aivjcfoeshnhqdrfteyq" 입력:  ← 사람이 입력
```
Expected: `대상: dflow-prod (aivjcfoeshnhqdrfteyq) / 파일: supabase/migrations/0059_workspace_mail_settings.sql` → `✓ prod 적용 완료`. 토큰이 없다는 오류면 `npx supabase login` 뒤 다시(또는 `SUPABASE_ACCESS_TOKEN=sbp_…`). 0059 안의 사후 검사가 실패하면 마이그레이션 전체가 오류로 끝난다 — 그때는 멈추고 사람에게 알린다(Step 12 이후로 가지 않는다).

적용 확인(대시보드 SQL 편집기, 읽기 전용 질의):

```sql
select relrowsecurity from pg_class where oid = 'public.workspace_mail_settings'::regclass;                     -- true
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'workspace_mail_settings' and grantee in ('anon', 'authenticated');  -- 0행
select p.prosecdef, p.proconfig,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as svc_exec,
       position('workspace_mail_settings' in p.prosrc) > 0 as attached
  from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid,uuid,text)'::regprocedure;
-- prosecdef=true, proconfig={search_path=""}, auth_exec=false, svc_exec=true, attached=true
```

- [ ] **Step 12: [사람 승인 필요] 운영 이력 행을 넣는다**

`db:apply` 는 `supabase_migrations.schema_migrations` 를 쓰지 않는다(runbook §5). 대시보드 SQL 편집기에서:

```sql
insert into supabase_migrations.schema_migrations(version, name) values ('0059', 'workspace_mail_settings');
select version, name from supabase_migrations.schema_migrations where version >= '0057' order by version;
-- 0057 import_append_order / 0058 project_delete / 0059 workspace_mail_settings
```

- [ ] **Step 13: [사람 승인 필요] Vercel Production 에 `NEXT_PUBLIC_APP_URL` 을 넣는다**

빌드 때 굳는 값이라 Step 14 의 push(=빌드) **전에** 넣는다. 이 폴더에는 `.vercel` 링크가 없으므로 프로젝트·팀을 명시한다. 값은 stdin 으로(끝 줄바꿈 없이):

```bash
vercel whoami                             # 이 팀(leedonseoks-projects)에 접근할 수 있는 계정인지
vercel env ls production --project d-flow --scope leedonseoks-projects   # NEXT_PUBLIC_APP_URL 이 아직 없는지
printf '%s' 'https://d-flow-eight.vercel.app' | vercel env add NEXT_PUBLIC_APP_URL production --project d-flow --scope leedonseoks-projects --no-sensitive
vercel env ls production --project d-flow --scope leedonseoks-projects   # 다섯 개: 기존 넷 + NEXT_PUBLIC_APP_URL
```
Expected: `Added Environment Variable NEXT_PUBLIC_APP_URL to Project d-flow [production]`. 이미 있다고 나오면 값을 확인하고(`vercel env ls … --json`) 다르면 사람에게 묻는다 — `--force` 로 덮지 않는다. `--no-sensitive` 는 공개 값(번들에 들어간다)이라 나중에 값을 읽어 확인할 수 있게 둔다.
CLI 가 링크(`vercel link`)를 물으면 멈춘다 — 링크는 `.env.local` 끝에 `VERCEL_OIDC_TOKEN` 을 덧붙인다(runbook §5). 사람이 대시보드(Project d-flow › Settings › Environment Variables › Production)에서 같은 값을 넣어도 된다.

- [ ] **Step 14: [사람 승인 필요] `main` 을 push 한다(= 운영 배포)**

전제: Step 11·12·13 완료(운영 스키마가 먼저, 빌드 env 가 먼저). Step 2~5 초록.

```bash
git fetch origin && git status -sb       # behind 0
git push --dry-run origin main           # pre-push 훅 G1~G5 를 원격 변경 없이 미리 돌린다 — 차단 메시지 없이 종료 코드 0
git push origin main                     # 사람 확인 뒤에만
gh run list --branch main --limit 1      # CI(lint·test·build·db) — 사후 검사, 끝까지 본다
gh run watch "$(gh run list --branch main --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status   # 실패하면 Step 17
vercel ls d-flow --environment production --limit 3 --scope leedonseoks-projects   # 맨 위 배포가 Ready 가 될 때까지
```
G1 에 걸리면 마이그레이션과 코드가 한 커밋에 섞인 것이다 — 커밋을 나눠 다시(`SKIP_GUARD` 로 넘기지 않는다). G4 에 걸리면 Step 6 의 빈 커밋을 만든다.

- [ ] **Step 15: 운영 스모크**

```bash
SMOKE_URL=https://d-flow-eight.vercel.app npm run smoke:prod
curl -s -o /dev/null -w '%{http_code}\n' https://d-flow-eight.vercel.app/login     # 200
```
Expected: `smoke:prod` 종료 코드 0(1 이면 배포 산출물 손실 — Step 17, 2 면 네트워크·스크립트 오류라 다시 돌린다).

- [ ] **Step 16: 운영 화면에서 설정한다(사람)**

워크스페이스 관리자 계정으로 `https://d-flow-eight.vercel.app/w/<slug>/settings#workspace-mail`:
1. 상태 줄이 none("메일 발송이 설정되지 않았습니다…")인지 — 운영에는 `SMTP_*` 가 없다.
2. Gmail 방식 — 발송 전용 Gmail 주소와 앱 비밀번호(Google 계정 › 보안 › 2단계 인증 › 앱 비밀번호) → **테스트 메일 보내기** → 본인 메일함 도착 확인 → **저장**.
   인증 실패 문구가 나오면 계정 비밀번호가 아니라 앱 비밀번호인지 확인한다.
3. 상태 줄 workspace·valid 와 보내는 주소 확인.
4. 초대를 쓰려면 같은 페이지 '초대'(`#workspace-invites`)에서 허용 도메인을 정한다(비어 있으면 초대가 전부 거부된다).
5. 실제 회의 안내 1건 또는 초대 1건을 보내 받은 메일의 링크가 `https://d-flow-eight.vercel.app/…` 로 시작하는지 본다(Step 13 의 `NEXT_PUBLIC_APP_URL` 이 빌드에 들어갔다는 근거).
6. 로그인 화면의 비밀번호 재설정 링크는 여전히 숨겨져 있다 — 의도된 동작이다(Step 10 문서).

- [ ] **Step 17: (실패했을 때만) 되돌리기**

화면·스모크가 깨졌으면 `docs/runbook-rollback.md` 를 따른다. 순서는 **앱 먼저, DB 나중**(설계 §1.4 — 앱을 되돌리면 env 발송으로 돌아가고, 남은 표는 해가 없다):

```bash
git log --oneline origin/main~20..origin/main      # Task 2~9 의 코드·문서 커밋 해시를 고른다(0059 마이그레이션 커밋은 빼도 된다)
git revert --no-edit <해시…>                        # revert 커밋은 G1 검사에서 제외된다
# [사람 승인 필요] git push origin main
```
DB 까지 되돌려야 할 때만(저장된 메일 설정이 사라진다 — 사람에게 먼저 알린다), [사람 승인 필요]:

```bash
PROD_REF=aivjcfoeshnhqdrfteyq npm run db:apply -- supabase/rollbacks/0059_workspace_mail_settings_rollback.sql --target prod
```
```sql
delete from supabase_migrations.schema_migrations where version = '0059';
```

- [ ] **Step 18: 로컬 정리**

```bash
npm run db:stop
git status --short        # 비어 있다
```

이 작업 끝에 다시 돌려 둔 것(완료 보고에 결과를 적는다): `npm run typecheck`·`npm run lint`·`npm run test`(전체 — 특히 `tests/invariants/*`·`tests/gates/*`·`tests/settings/operational-env.test.ts`·`tests/settings/catalog-sync.test.ts`·`tests/mail/*`·`tests/actions/mail-settings-gate.test.ts`·`tests/actions/meeting-notify-gate.test.ts`·`tests/actions/project-invites-gate.test.ts`·`tests/components/mail-settings-editor.test.tsx`·`tests/ui/workspace-settings-page.test.tsx`)·`npm run build`·`npm run db:reset`·`npm run test:rls`·`npm run db:diff:baseline`·`npm run settings:verify`·`npm run smoke:prod`.

---

