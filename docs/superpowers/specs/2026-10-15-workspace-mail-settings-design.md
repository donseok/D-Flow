# 워크스페이스 발송 메일 설정 — 설계

2026-10-15. 회의 안내 메일과 프로젝트 초대 메일을 워크스페이스 관리자가 화면에서 설정한 메일 계정으로 보낸다.

## 0. 배경과 목표

- 회의 안내(`src/app/actions/meetingNotify.ts`)와 프로젝트 초대(`src/app/actions/projectInvites.ts`)의 메일은 이미 구현돼 있다.
  둘 다 `src/lib/mail/transport.ts` 의 `getTransport()` 로 보내고, 그 함수는 **배포 환경변수 `SMTP_*` 만** 읽는다.
- 운영(2026-10-14 첫 배포)에는 `SMTP_*` 가 없어 메일이 하나도 나가지 않는다. 계정을 바꾸려면 Vercel 환경변수를 고치고 다시 배포해야 한다.
- 목표: **워크스페이스 관리자가 워크스페이스 설정 화면에서 보내는 Gmail 주소와 앱 비밀번호만 넣으면 바로 발송된다.** 재배포 없이, 다른 메일 서버도 같은 화면에서.

결정(사용자 확인 2026-10-15):

| 항목 | 결정 |
|---|---|
| 범위 | 워크스페이스마다 따로 둔다. 워크스페이스 관리자가 설정한다 |
| 저장 | 전용 표, service_role 전용(연동 자격증명 0035 와 같은 꼴). 암호화(Vault)는 하지 않는다 |
| 우선순위 | 워크스페이스 설정 → 배포 환경변수(`SMTP_*`) → 미설정 |

범위 밖:
- 비밀번호 재설정 메일 — Supabase Auth 가 자기 SMTP 로 보낸다(`src/lib/auth/passwordResetMail.ts`). 그 판정(`mailConfigured()`, env)은 그대로 둔다.
- 프로젝트별 발신 계정, 비밀번호 암호화 저장, Gmail 외 프리셋(직접 입력으로 쓴다), 앱 주소(`NEXT_PUBLIC_APP_URL`)의 화면 설정화.
- 워크스페이스 행의 무인증 릴레이(`SMTP_AUTH=none`) — 운영자 env 로만 쓴다(§1.1).
- `notifyMeetingSaved` 의 발송 횟수 제한·외부 주소 권한 축소 — 기존 동작(env 계정)과 같고, 이제 설정한 계정이 그 부담을 진다(§4 안내에 적는다).

## 1. 저장 — 마이그레이션 `0059_workspace_mail_settings`

### 1.1 표

```sql
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
  -- 공백 아닌 글자가 하나는 있어야 한다(\S). btrim 은 스페이스만 걷어 탭·줄바꿈뿐인 값을 통과시키므로 쓰지 않는다
  constraint workspace_mail_settings_login check (username ~ '\S' and password ~ '\S'),
  constraint workspace_mail_settings_from check (from_address is null or from_address ~ '\S'),
  -- 포트와 보안 연결의 짝: 465 는 SSL, 587·25 는 STARTTLS(secure=false). 2525 는 어느 쪽이든
  constraint workspace_mail_settings_tls check (not (port = 465 and not secure) and not (port in (587, 25) and secure)),
  -- Gmail 프리셋은 서버 값을 고정한다(화면이 넣는 값 그대로)
  constraint workspace_mail_settings_gmail check (preset <> 'gmail' or (host = 'smtp.gmail.com' and port = 465 and secure)),
  -- 호스트는 정규화된 DNS 이름(소문자·끝 점 없음, §3) — IP 리터럴·단일 레이블은 앱이 거른다
  constraint workspace_mail_settings_host check (length(host) between 1 and 253 and host = lower(host) and host !~ '\.$')
);
```

- 행이 없으면 미설정이다. "끄기"는 행 삭제다(enabled 열을 두지 않는다 — 꺼진 행과 없는 행이 같은 뜻이 된다).
- **계정 로그인만 받는다.** 무인증 릴레이는 인터넷의 열린 릴레이로 발신 주소를 위조하는 통로가 되므로 워크스페이스 행에서는 받지 않는다(env 는 그대로 `SMTP_AUTH=none` 을 지원한다).
- 포트는 SMTP 표준 넷만 — 임의 포트로 내부망을 두드리는 탐침을 막는다(§3 호스트 규칙과 함께).
- `password` 는 평문이다. 지키는 것은 권한(§1.2)뿐이다. Gmail 앱 비밀번호는 그 메일함 전체를 연다는 점을 화면에 적는다.
- `password_set_by`·`password_set_at` 은 **새 비밀번호를 입력했을 때만** 바뀐다(비밀번호를 유지한 저장은 두 칸을 건드리지 않는다).
  관리자가 빠지거나 강등돼도 메일 설정은 지우지 않는다 — 연동 토큰과 달리 그 사람의 토큰이 아니라 워크스페이스의 발송 설정이다. 대신 화면이 경고한다(§4).

### 1.2 권한

- RLS 를 켜고 정책은 두지 않는다. `revoke all on table … from public, anon, authenticated; grant all … to service_role;` — 세션은 읽지도 쓰지도 못한다.
- 사후 검사: anon·authenticated 의 표 권한이 0, RLS 켜짐, `workspaces` 참조 FK 의 `confdeltype = 'c'`, 공백 계정 행 삽입이 23514 로 거부됨.

### 1.3 워크스페이스 삭제와의 관계

`delete_empty_workspace`(0055)는 `workspaces` 를 참조하는 표에 행이 남아 있으면 삭제를 막고, 닫힌 목록 `v_attached` 의 표만 "함께 지워지는 부속 표"로 센다.
메일 설정은 자료가 아니라 설정이므로 **부속 표에 넣는다**(안 넣으면 메일 설정을 저장한 적 있는 워크스페이스는 비어 있어도 지울 수 없다).

- 0059 는 0055 본문(이후 재정의 없음 — 0056 은 주석에서만 언급)에 `'workspace_mail_settings'` 만 더해 다시 정의한다.
  **머리 전체를 다시 적는다**: `create or replace function public.delete_empty_workspace(p_actor uuid, p_workspace_id uuid, p_expected_slug text) returns jsonb language plpgsql security definer set search_path to '' as $$ … $$`.
  `security definer`·`set search_path` 는 본문이 아니라 속성이라 빠뜨리면 INVOKER·빈 설정으로 바뀐다. `revoke … from public, anon, authenticated; grant execute … to service_role` 도 다시 적는다.
- 0059 사후 검사(이 함수): `prosecdef` 참, `proconfig` 에 `search_path=""`, anon·authenticated 실행권 없음·service_role 있음,
  `prosrc` 에 `workspace_mail_settings` 와 0055 토큰(`platform_admins`·`AUTHZ_FORBIDDEN`·`pg_catalog.pg_constraint`·`WORKSPACE_SLUG_MISMATCH`·`for update`).
- 플랫폼 화면의 남은 항목 표(`src/lib/workspace/deleteRemaining.ts`)는 remaining 에만 쓰이고 부속 표는 remaining 에 오지 않으므로 손대지 않는다.

### 1.4 롤백

`supabase/rollbacks/0059_workspace_mail_settings_rollback.sql`: `delete_empty_workspace` 를 0055 본문·같은 머리(`security definer set search_path to ''`)·같은 실행권으로 되돌리고 표를 지운다.
되돌리지 않는 데이터: 저장된 메일 설정(표와 함께 사라진다). 앱을 먼저 되돌리면 env 발송으로 돌아간다.

## 2. 발송 경로

### 2.1 새 모듈 `src/lib/mail/workspaceSmtp.ts` (server-only)

```ts
/** 행 → env 꼴 레코드. 순수. 검증은 기존 resolveSmtpSettings 한 벌이 한다(SMTP_AUTH 는 비운다 — 계정 로그인만) */
export function rowToSmtpEnv(row: WorkspaceMailRow): Record<string, string>
/** 그 워크스페이스의 행. 조회 실패·보관 임베드를 못 읽음은 throw */
export async function loadWorkspaceMailRow(admin: Pick<AdminClient, 'from'>, workspaceId: string):
  Promise<{ kind: 'row'; row: WorkspaceMailRow } | { kind: 'none' } | { kind: 'archived' }>
/** 화면·발송이 함께 쓰는 판정 */
export type MailStatus =
  | { source: 'workspace'; valid: true; fromAddress: string } | { source: 'workspace'; valid: false }
  | { source: 'env'; valid: true; fromAddress: string } | { source: 'env'; valid: false }
  | { source: 'none' }
export async function resolveMailStatus(workspaceId: string | null): Promise<MailStatus | { error: string }>
/** 워크스페이스 행의 서버 주소를 해석해 사설·예약 대역이면 거부(§2.4). 통과하면 연결할 IP */
export async function vetMailHost(host: string): Promise<{ ok: true; address: string } | { ok: false }>
```

- 클라이언트는 `adminFor({ workspaceId })`(`src/lib/supabase/adminFor.ts`)로 만든다. 그래서 transport.ts·workspaceSmtp.ts 는 `createAdminClient` 를 언급하지 않고
  service_role 감사표(`docs/sp2-admin-client-audit.md`)에 행이 생기지 않는다. 매개변수 형은 `AdminClient`(adminFor.ts 의 형)로 적고 `ReturnType<typeof createAdminClient>` 를 쓰지 않는다.
  `adminFor` 가 uuid 가 아니라고 throw 하면 `MAIL_SETTINGS_UNAVAILABLE` 로 바꾼다.
- 보관 판정: `workspaces!inner(archived_at)` 임베드로 함께 읽는다. `archived_at` 이 null 이 아니면 `archived`, 임베드를 못 읽으면(키 없음·형이 다름) throw(모르면 닫는다 — `inviteRedeem.ts` 의 `loadInvite` 와 같은 규칙).
  행이 없는 보관 워크스페이스는 여기서 잡히지 않는다(조인할 행이 없다) — 발송 호출자 둘은 가드(`requireProjectAdmin` → `buildActor`, 0056)가 먼저 닫는다.
- 캐시하지 않는다 — 저장한 다음 발송부터 바로 쓰인다.
- 판정 규칙(`resolveMailStatus` 와 `getTransport` 가 같은 규칙):
  1. 행 `row` → `resolveSmtpSettings(rowToSmtpEnv(row))`. ok 면 workspace·valid, **ok 가 아니면 kind 가 'unset' 이든 'invalid' 든 workspace·invalid** — env 로 내려가지 않는다(관리자가 정한 계정을 조용히 다른 계정으로 바꾸지 않는다).
  2. 행 `archived` → 발송하지 않는다. env 로 내려가지 않는다(상태는 `{ error }`, 문구는 보관 사실을 드러내지 않는 `MAIL_SETTINGS_UNAVAILABLE`).
  3. 행 `none` → `resolveSmtpSettings(process.env)`: ok → env·valid, 'invalid' → env·invalid, 'unset' → none.
  4. 조회 실패 → `{ error: MAIL_SETTINGS_UNAVAILABLE }`(미설정으로 위장하지 않는다 — 3원칙 ①).

### 2.2 `transport.ts` 변경

```ts
export async function getTransport(opts: { workspaceId: string | null; fromName?: string }): Promise<Transport>
/** 검증이 끝난 설정으로 트랜스포트를 만든다(순수 구성 — nodemailer·타임아웃·from 은 이 파일만 안다). 테스트 발송도 이것을 쓴다 */
export function transportFromSettings(settings: SmtpSettings, opts?: { fromName?: string; connectTo?: string }): Transport
```

- `getTransport` 는 §2.1 판정으로 설정을 고른 뒤 `transportFromSettings` 로 만든다. 결과 문구: workspace·invalid 와 env·invalid 는 `SMTP_MISCONFIGURED`,
  none 은 `SMTP_NOT_CONFIGURED`, `{ error }` 는 그 문구. 'unset → SMTP_NOT_CONFIGURED' 는 env 경로에만 해당한다.
- 워크스페이스 행일 때만 연결 전에 `vetMailHost`(§2.4)를 지나고, 통과한 IP 를 `connectTo` 로 넘긴다 — nodemailer 의 `host` 는 그 IP, `name`·`tls.servername` 은 원래 호스트(재해석·DNS 리바인딩 차단, 인증서 검사는 원래 이름).
  거부되면 `MAIL_HOST_UNUSABLE_AT_SEND`('워크스페이스 메일 설정의 서버 주소를 쓸 수 없어 메일을 보내지 못했습니다. 워크스페이스 관리자에게 알리세요.' — 사설·예약 대역과 해석 실패를 한 문구로 둔다, §2.4).
  발송자(회의 안내·초대)는 메일 설정을 고칠 수 없는 일반 멤버일 수 있어 고칠 사람을 가리킨다 — 주소를 고치라는 관리자용 `MAIL_HOST_NOT_ALLOWED` 는 저장·테스트 발송(§3)에만 쓴다.
  env 경로(운영자가 정한 값, 로컬 inbucket 127.0.0.1)는 이 검사를 받지 않는다.
- `from` 은 지금처럼 `{ name: mailFromName(fromName), address: settings.fromAddress }` 로 이 파일이 고정한다.
- `mailConfigured()`(동기, env 판정)는 그대로 둔다.

### 2.3 호출처

- `projectInvites.ts` `sendInviteMail` — 이미 `workspaceId` 가 있다. `await getTransport({ workspaceId, fromName })`.
- `meetingNotify.ts` — 지금은 `getProjectConfig(...).workspaceId` 에서 워크스페이스를 얻는데 그 조회가 실패하면 모른다.
  맨 앞의 `resolveProjectId('meetings', meetingId)` 를 `resolveScope('meetings', meetingId)` 로 바꿔 프로젝트·워크스페이스를 함께 확정하고, 못 읽으면 가드 전에 멈춘다(3원칙 ②).
  `await getTransport({ workspaceId: scope.workspaceId, fromName })`.

### 2.4 SMTP 서버 주소 검사(워크스페이스 행만)

관리자가 넣은 호스트로 서버(Vercel)가 직접 접속하므로 내부망 탐침 통로가 되지 않게 한다.
- 저장 시(§3): 호스트를 `toAsciiHostname(host.trim().toLowerCase().replace(/\.$/, ''))`(`src/lib/domain/hostname.ts`)로 정규화하고 null 이면 거부 — IP 리터럴·`localhost` 같은 단일 레이블·IPv6 가 걸린다. `*.localhost`(RFC 6761)도 거부. 사유 코드 `host_invalid`.
  직접 입력이면 이어서 발송 때와 같은 DNS 검사(`vetOrDeny`)를 지나야 저장한다 — 거부면 `MAIL_HOST_NOT_ALLOWED`('이 메일 서버 주소는 쓸 수 없습니다. 주소를 찾지 못했거나 내부망 주소입니다 — 주소가 맞는지 확인하세요.' — 주소를 고칠 관리자용, 테스트 발송도 같은 문구), 아무것도 쓰지 않는다(상태 줄이 '발송 중'인데 메일이 나가지 않는 행을 남기지 않는다). Gmail 은 고정 공인 서버라 묻지 않는다.
- 발송 시: `dns.promises.lookup(host, { all: true, verbatim: true })` 결과가 비었거나 하나라도 0.0.0.0/8·127/8·10/8·172.16/12·192.168/16·169.254/16·100.64/10·::1·fc00::/7·fe80::/10·::ffff: 매핑 사설 IPv4 면 거부한다.
  IPv4 를 품은 다른 IPv6 꼴(NAT64 64:ff9b::/96·6to4 2002::/16·변환 ::ffff:0:a.b.c.d)은 품은 IPv4 로 보고, NAT64 지역 사용 접두 64:ff9b:1::/48(RFC 8215)은
  IPv4 의 자리가 망마다 달라(RFC 6052) 통째로 거부한다 — 전체 목록은 `isForbiddenAddress` 주석. 해석 오류·5초 시간 초과도 거부한다.
  거부 사유(사설·예약 대역으로 풀림 / 풀리지 않음)는 응답에서 가르지 않는다 — 문구는 경로마다 하나다(저장·테스트 발송 `MAIL_HOST_NOT_ALLOWED`, 발송 `MAIL_HOST_UNUSABLE_AT_SEND` — 경로가 갈릴 뿐 사유는 갈리지 않는다). 나누면 저장·테스트 발송이 어떤 내부 이름이 사설 주소로 풀리는지 알려 주는 통로가 된다.
  해석 오류 원문은 싣지 않는다. 로컬 개발 예외(`isLocalDevEnv`)를 워크스페이스 행에 두지 않는다 — 로컬 시험은 env(inbucket)로 한다.

### 2.5 SMTP 오류 문구 한 곳으로

회의·초대 액션에 같은 `EAUTH`/`ETIMEDOUT…` → 문구 변환이 두 벌 있다. `src/lib/mail/errors.ts` 의 `smtpErrorMessage(tr, e, { test?: boolean })` 로 모아 셋(회의·초대·테스트 발송)이 쓴다.
테스트 발송의 `EAUTH` 는 "Gmail 이면 앱 비밀번호인지 확인하세요"를 더한 문구다. SMTP 원문 오류는 응답에 싣지 않는다(계정·호스트가 섞인다).

## 3. 서버 액션 — `src/app/actions/mailSettings.ts`

`wid` 는 가드 앞에서 `typeof wid === 'string' && SAFE_ID_RE.test(wid)`(`src/lib/domain/validate.ts`)만 본다 — uuid 검사가 아니다(존재 판정은 가드와 `.eq('workspace_id', wid)`).
`integrations.ts` 의 `v === 'ws-1'` 예외는 따라 하지 않는다. 그다음 `requireWorkspaceAdmin(wid)` → `adminFor({ workspaceId: wid })` 로 그 행만 다룬다.
`adminFor` 가 throw 하면(uuid 가 아닌 id — 하네스의 `W`='ws-1' 포함) 던지지 않고 조회 실패 문구로 돌려준다.

| 액션 | 하는 일 |
|---|---|
| `getWorkspaceMailSettings(wid)` | 비밀번호를 뺀 보기 + `status: MailStatus` + `passwordSetBy`(표시 이름)·`passwordSetAt`·`passwordSetterIsAdmin`(true / false / 'unknown') |
| `saveWorkspaceMailSettings(wid, input)` | 가드 → `normalizeMailSettingsInput` → 비밀번호 재사용 규칙 → `resolveSmtpSettings` 로 쓸 수 있는 설정인지 → 직접 입력이면 서버 주소 검사(§2.4 `vetOrDeny`, 거부면 `MAIL_HOST_NOT_ALLOWED` 로 아무것도 쓰지 않는다. Gmail 은 건너뛴다) → upsert. `updated_by`=`g.actor.userId`. 새 비밀번호를 넣었을 때만 `password_set_by`·`password_set_at` 갱신 |
| `deleteWorkspaceMailSettings(wid)` | 행 삭제(`.select('workspace_id')` 로 영향 행 확인 — 0행이면 "지울 설정이 없습니다") → env(있으면)로 돌아간다 |
| `sendWorkspaceTestMail(wid, input)` | 저장 전 폼 값으로 **로그인한 본인 메일 주소에만** 1통 |

- 입력 형상: `{ preset: 'gmail' | 'custom', address?, password?, host?, port?, secure?, username?, fromAddress? }`.
  Gmail 이면 `address`·`password` 만 읽고 host=`smtp.gmail.com`·port=465·secure=true, username=address, from_address=null(→ username), 비밀번호의 공백을 지운다(구글이 4자씩 띄워 보여준다).
- 검증은 순수 함수 `src/lib/mail/settingsInput.ts` 의 `normalizeMailSettingsInput(input)` → `{ ok: true, row } | { ok: false, code }` 하나를 폼과 서버가 같이 쓴다.
  호스트 정규화(§2.4)·포트 넷·포트-보안 짝·주소 형식(`isValidEmail`)·빈 계정을 본다. 사유 코드는 공용 사전 문구로 바꾼다(§4).
- **비밀번호 빈칸 = 저장값 재사용**은 아래가 모두 맞을 때만이다(아니면 `password_required`):
  저장된 행이 있다, 정규화된 새 host 가 저장된 host 와 같다, 정규화된 새 username(trim·소문자)이 저장된 username(trim·소문자)과 같다.
  Gmail 은 host·username 이 고정되므로 이 한 규칙이 Gmail↔직접 입력 사이의 재사용도 막는다. 저장과 테스트 발송이 같은 규칙을 쓴다.
- 테스트 발송 순서: 가드 → 요청 제한(행위자 단위 10분 10회, `src/lib/http/rateLimit.ts` 의 `mailTestSend`·`consumeRateBy` — SMTP 도달·자격 증명 확인 통로 차단) → `normalizeMailSettingsInput` → 비밀번호 재사용 규칙 → `resolveSmtpSettings(rowToSmtpEnv(row))`(실패면 입력 오류 문구, env 로 내려가지 않는다)
  → `vetMailHost` → `transportFromSettings(settings, { fromName: 워크스페이스 발신 표시명, connectTo })` → `getSession()` 사용자 이메일로 발송 → `smtpErrorMessage(…, { test: true })`.
  수신자를 입력으로 받지 않는다 — 이 화면이 임의 주소 발송 통로가 되지 않게(이 규칙은 테스트 발송 경로에 대한 것이다. 회의 안내는 기존 제한 — 작성자·관리자 관문, 회당 외부 주소 20개, 주소 검증 — 그대로다).
- `passwordSetterIsAdmin`: `password_set_by` 가 null 이거나 그 사람이 지금 이 워크스페이스 관리자가 아니면 false, 조회 실패면 'unknown'(3원칙).
- 응답·로그·오류 어디에도 비밀번호를 싣지 않는다. 보기 형의 필드에 password 가 없다.

열거 게이트(`tests/gates/manifest.ts`): 네 항목 `getWorkspaceMailSettings`·`deleteWorkspaceMailSettings` 는 `{ ...nul('workspaceAdmin'), sample: [W] }`,
`saveWorkspaceMailSettings`·`sendWorkspaceTestMail` 는 `{ ...nul('workspaceAdmin'), sample: [W, {}] }` — 둘째 인자 `{}` 는 `normalizeMailSettingsInput`(저장은 가드 바로 뒤, 테스트 발송은 가드 → 요청 제한 다음)에서 실패하는 값이라
deny 하네스가 본문을 돌려도 실제 SMTP 연결을 시도하지 않는다. 액션·발송 경로가 모두 `adminFor` 를 쓰므로 service_role 감사표에는 새 행이 없다.

## 4. 화면 — 워크스페이스 설정 › 메일 발송

- `src/app/(app)/w/[slug]/settings/page.tsx` 에 `SectionCard id="workspace-mail"`(아이콘 `Send`), `SettingsShell items` 의 '초대' 앞에 '메일 발송'. 이 페이지는 이미 워크스페이스 관리자만 연다(`access.isAdmin`).
  UI 위험 파일 목록(레이아웃·`globals.css`·`src/components/app/*`)에 드는 파일은 건드리지 않는다.
- `searchText` 는 영어·키 낱말만(`"mail smtp gmail email app-password"`) — 이 페이지의 한국어 리터럴은 `tests/invariants/i18n-no-korean-literals.test.ts` 의 상한(9)을 다 썼다.
  `SettingsShell` 이 섹션의 화면 글자도 검색하므로 '메일' 로도 찾힌다.
- 서버에서 `getWorkspaceMailSettings` 결과를 내려 클라이언트 컴포넌트 `src/components/settings/MailSettingsEditor.tsx` 가 그린다. 조회 실패는 섹션 안 `ConfigLoadError`, 페이지의 다른 섹션은 그대로 그린다.
- 구성:
  1. 상태 줄 — `MailStatus` 다섯 갈래:
     workspace·valid "이 워크스페이스 설정으로 발송 중 · 보내는 주소 x" / workspace·invalid "저장된 설정이 올바르지 않습니다 — 다시 저장하세요(지금은 메일이 나가지 않습니다)" /
     env·valid "서버 환경변수 설정으로 발송 중" / env·invalid "서버 환경변수의 메일 설정이 올바르지 않습니다 — 이 화면에서 저장하면 그 설정으로 발송합니다" /
     none "메일 발송이 설정되지 않았습니다 — 회의 안내·초대 메일이 나가지 않습니다".
     저장된 행이 있으면 "비밀번호 설정: <이름> · <일시>", `passwordSetterIsAdmin === false` 면 "비밀번호를 넣은 사람이 더 이상 이 워크스페이스 관리자가 아닙니다 — 설정을 바꾸거나 삭제하세요".
  2. 방식 — **Gmail**(기본) / **직접 입력**.
  3. Gmail: 보내는 Gmail 주소, 앱 비밀번호. 안내: 2단계 인증 → 앱 비밀번호(공백은 지워도 된다). "이 계정으로 회의 안내(일반 멤버인 회의 작성자 포함, 참석자 외 외부 주소 최대 20개/회)와 초대 메일이 나갑니다.
     발송 한도·평판이 이 계정에 쌓이고 앱 비밀번호는 메일함 전체를 여는 값이므로 발송 전용 계정을 권합니다."
  4. 직접 입력: 서버 주소, 포트(25·465·587·2525), 보안 연결(SSL/STARTTLS), 계정, 비밀번호, 보내는 주소(비우면 계정).
  5. 비밀번호 칸(두 방식 모두) — `type="password"`·`autoComplete="new-password"`(크로미움이 비밀번호 칸의 "off" 를 무시한다)·로그인 폼과 겹치지 않는 `name`/`id`(`smtp-password`).
     처음 값은 늘 빈 문자열, 저장돼 있으면 자리표시 "저장됨 · 바꾸려면 새로 입력". 주소·계정·보내는 주소 칸은 `autoComplete="off"`·`name="smtp-username"`/`"smtp-from"`.
  6. 버튼 — **테스트 메일 보내기**(내 주소로, 저장 전 값으로) · **저장** · **설정 삭제**(확인 대화상자, 저장된 행이 있을 때만).
  7. 발신 표시명은 '일반' 섹션의 메일 발신 이름을 쓴다는 한 줄.
- 사전: 목차·섹션 제목은 `pagesUi.ts`(`pages.wsSettings.nav.mail`·`pages.wsSettings.mailTitle`), 편집기 문구와 `normalizeMailSettingsInput` 사유 코드 문구는 공용 `settingsUi.ts`(폼과 서버가 같은 키),
  서버만 내는 문구(테스트 발송 결과·요청 제한·SMTP 오류)는 `serverUi.ts` 의 `srv.mailSettings.*`. 같은 키를 두 사전에 두지 않는다.
  `MAIL_SETTINGS_UNAVAILABLE`·`MAIL_HOST_NOT_ALLOWED`·`MAIL_HOST_UNUSABLE_AT_SEND` 는 사전 키가 아니라 `transport.ts` 의 리터럴 상수다(`SMTP_NOT_CONFIGURED` 와 같은 방식 — 서버 사전을 값으로 import 하는 파일은 닫혀 있다).
- 상태 변형 display 유틸(`group-hover:flex` 등)은 쓰지 않는다.

## 5. 오류 처리

| 상황 | 결과 |
|---|---|
| 설정 행 조회 실패(발송 시) | 발송하지 않고 `MAIL_SETTINGS_UNAVAILABLE`. 회의 결과 패널·초대 결과에 그대로 뜬다 |
| 보관된 워크스페이스의 행(발송 시) | 발송하지 않고 env 로 내려가지 않는다. 문구는 `MAIL_SETTINGS_UNAVAILABLE`(보관 사실을 드러내지 않는다) |
| 저장된 행이 규칙 위반(손상·공백) | 발송 시 `SMTP_MISCONFIGURED`(env 로 내려가지 않는다), 상태 줄 workspace·invalid |
| env 설정이 규칙 위반 | 발송 시 `SMTP_MISCONFIGURED`, 상태 줄 env·invalid |
| 서버 주소가 사설·예약 대역으로 풀리거나 풀리지 않음(오타·DNS 장애·시간 초과) — 직접 입력 저장·테스트 발송(관리자) | `MAIL_HOST_NOT_ALLOWED` 한 문구 — 주소를 확인하라는 안내(두 사유를 가르지 않는다, §2.4) |
| 같은 거부 — 발송(회의 안내·초대, 일반 멤버일 수 있음) | `MAIL_HOST_UNUSABLE_AT_SEND` 한 문구 — 워크스페이스 관리자에게 알리라는 안내(두 사유를 가르지 않는다, §2.4) |
| 테스트 발송 요청 제한(행위자 단위 10분 10회) 초과 | `srv.mailSettings.testRateLimited` — 입력 검증·연결 전에 거절 |
| 저장 입력 오류 | 사유 문구(주소 형식·호스트·포트·보안 짝·비밀번호 필요) |
| 테스트 발송 실패 | 인증 실패(앱 비밀번호 확인) / 서버 연결 실패 / 기타 |
| 본인 메일 주소를 모름 | 테스트 발송 거부 문구 |

## 6. 테스트

새 테스트:
- `tests/mail/workspace-smtp.test.ts`: `rowToSmtpEnv` 매핑(Gmail·직접), 판정 규칙(행 → env → 미설정), 공백 계정 행이 env 가 있어도 `SMTP_MISCONFIGURED`,
  조회 실패 → `MAIL_SETTINGS_UNAVAILABLE`, 보관 행 → ok:false·env 미사용, 임베드 판독 불가 → `MAIL_SETTINGS_UNAVAILABLE`,
  `resolveMailStatus` 다섯 갈래(workspace·invalid, env·invalid, env 'unset' → none 포함), `vetMailHost`(DNS 를 목으로 — 사설 대역 거부·공인 통과·빈 결과 거부), env 경로는 검사 면제.
- `tests/mail/settings-input.test.ts`: Gmail 공백 제거·고정값, 포트 넷 밖 거부, 포트-보안 짝, IP 리터럴·`localhost`·단일 레이블 거부, 호스트 소문자·끝 점 정규화, 빈 계정 거부.
- `tests/actions/mail-settings-gate.test.ts`: 가드 전 admin 생성 금지, 응답에 비밀번호 없음, 비밀번호 유지(같은 host·username — 대소문자·끝 점만 다른 host 포함)와 재사용 거부
  (직접→Gmail 같은 주소, Gmail→직접 다른 host), 유지 저장은 `password_set_by` 를 바꾸지 않음, 테스트 수신자 = 본인, 테스트가 저장 전 값·워크스페이스 발신 표시명을 씀, 삭제 0행, `adminFor` throw → 오류 결과.
- `tests/components/mail-settings-editor.test.tsx`: 방식 전환, 상태 줄 다섯 갈래, 비밀번호 설정자 경고, 비밀번호 칸 `autocomplete="new-password"`·처음 빈 값(두 방식), 주소·계정 칸 `autocomplete="off"`.
- `tests/mail/transport.test.ts`: 비동기 시그니처로 갱신, `transportFromSettings` 가 `from` 을 `{ name, address: settings.fromAddress }` 로 고정, `connectTo` 가 host 를 IP 로·servername 을 원래 이름으로.

기존 테스트 갱신:
- `tests/actions/meeting-notify-gate.test.ts`: `getTransport` 목을 비동기로, `@/lib/authz` 목의 `resolveProjectId` 를 `resolveScope`(기본 `{ ok: true, projectId: 'p1', workspaceId: 'w1' }`)로.
  확정 실패 두 사례('대상 회의의 프로젝트를 확정하지 못하면…'·'없는 회의는 거부한다')는 `resolveScope` 실패로 옮기고 가드·`getTransport` 미호출을 단언. 성공 사례에서 `getTransport` 가 `{ workspaceId: 'w1' }` 로 불렸는지.
- `tests/actions/project-invites-gate.test.ts`: `getTransport` 목을 비동기·`{ workspaceId }` 인자로.
- `tests/ui/workspace-settings-page.test.tsx`: 목차 기대값에 `{ id: 'workspace-mail', label: '메일 발송' }` 을 '초대' 앞에(테스트 이름의 범주 수도), `@/app/actions/mailSettings`·`MailSettingsEditor` 목,
  조회 성공 시 편집기에 보기가 넘어가는 사례와 실패 시 `section#workspace-mail` 안 `ConfigLoadError`·다른 섹션 유지 사례.

불변식·DB:
- `tests/gates/manifest.ts` 네 항목(§3).
- `tests/rls/isolation-map.ts`: `A_ROW_FILTER` 에 `workspace_mail_settings: t.workspace_id = A`, `UPDATE_DENIED_BY_GRANT` 에 `'workspace_mail_settings'`(목록 주석의 개수도). `UNFILLED` 는 비운 채.
- `tests/rls/fixture-ws.sql`: A 워크스페이스 행 하나(SP7 integration_credentials 블록 옆) — 검사 제약을 통과하는 값:
  `('00000000-0000-0000-7e57-00000000aa01','custom','smtp.rls.invalid',2525,false,'rls-user','rls-pass')` … `on conflict (workspace_id) do nothing`. 서비스 전용 표의 전수 탐침이 빈 검사가 되지 않게 하는 행이라는 주석.
  위 세 가지(A_ROW_FILTER·UPDATE_DENIED_BY_GRANT·픽스처 행)는 함께 들어가야 한다.
- RLS 테스트: 세션(authenticated)의 select·insert 거부, `delete_empty_workspace` 가 메일 설정 행을 부속으로 함께 지움.
- 로컬 `npm run db:reset` 초록.

## 7. 배포 순서

1. 마이그레이션 커밋 — `supabase/migrations/0059_workspace_mail_settings.sql`·`supabase/rollbacks/0059_workspace_mail_settings_rollback.sql` 와
   DB 테스트 파일(`tests/rls/isolation-map.ts`·`tests/rls/fixture-ws.sql`·RLS 테스트). `src/` 는 넣지 않는다(G1). 로컬 `db:reset` 과 RLS 테스트 초록 뒤
   트레일러 `Staging-verified: local db reset <일시>`(G4). Docker 가 켜져 있어야 한다.
2. 운영 DB 적용: `PROD_REF=aivjcfoeshnhqdrfteyq npm run db:apply -- supabase/migrations/0059_workspace_mail_settings.sql --target prod`,
   이어서 `insert into supabase_migrations.schema_migrations(version, name) values ('0059', 'workspace_mail_settings');`.
3. Vercel Production 에 `NEXT_PUBLIC_APP_URL=https://d-flow-eight.vercel.app` 추가(초대 링크 기준 주소 — 빌드 때 굳으므로 코드 push 전에).
4. 코드 커밋 → `npm run lint`·`test`·`build` → 로컬 `npm run dev` 에서 화면 확인 → 사람 확인 후 `main` push(= 운영 배포) → `smoke:prod`.
5. 운영 화면: 워크스페이스 설정 › 메일 발송에서 Gmail 주소·앱 비밀번호 → 테스트 메일 → 저장. 초대를 쓰려면 같은 화면의 초대 허용 도메인도 정한다.
