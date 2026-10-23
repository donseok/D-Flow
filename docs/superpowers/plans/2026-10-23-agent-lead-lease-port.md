# 팀장 lease(계약 2.5) D-Flow 이식 — 팀장 PC 작업 지침

작성 2026-10-23. 이 문서만 보고 다른 PC(팀장 PC)에서 처음부터 끝까지 진행할 수 있게 썼다.
각 단계에는 **완료 기준**과 **멈춤 조건**이 있다. 멈춤 조건에 걸리면 다음 단계로 가지 말고 사람에게 보고한다.

## 0. 배경

### 증상

`oranda` 리포에서 `/dflow-team` 을 시작하면 팀장 등록에서 멈춘다.

| 요청 | 결과 | 뜻 |
|---|---|---|
| `GET /api/v1/agent/work/mine` (키 없이) | 401 | 라우트는 있다 |
| `POST /api/v1/agent/lead/lease` (키 없이) | 404 | **라우트 자체가 없다** |

### 원인

- `oranda/.claude/skills/dflow-*` 는 dmes-standard 스킬을 가리키는 심볼릭 링크다. 이 스킬은 wbs-web 의 **계약 2.11** 클라이언트다.
- `oranda/.dflow` 의 `api_base` 는 D-Flow 운영(`https://d-flow-eight.vercel.app`)이다. D-Flow 는 wbs-web `77cf6785` 에서 갈라진 포크라
  **계약 2.4** 에 멈춰 있다(`src/lib/agent/externalApi.ts` 의 `AGENT_CONTRACT_VERSION`).
- 그래서 "서버를 최신으로 다시 배포"해도 해결되지 않는다. D-Flow 어느 커밋에도 이 라우트가 없다. **옮겨 와야 한다.**

### 이 문서의 범위

- **1단계(이 문서의 본론):** 계약 2.5 = 팀장 lease 라우트 + watch 의 `holder` 거르기. `/dflow-team` 을 막는 것은 이것 하나다.
- **2단계(개요만, §6):** 계약 2.6~2.11 과 에이전트 콘솔. 마이그레이션이 필요한 별도 작업이다.

### 왜 마이그레이션 없이 될 것으로 보는가 (가설 — §3-8·§3-9 가 증명한다)

D-Flow 기준선(`supabase/migrations/0000_baseline.sql`)은 원본 운영 DB 에서 떠 왔고, 그 시점에 원본은 0101 을 이미 적용했다.
그래서 기준선에 다음이 들어 있다.

- 표 `public.agent_lead_leases` (RLS 켜짐, 0011 이 세션 쓰기 회수)
- 함수 `lead_lease_acquire(uuid, uuid[], text, text, text, boolean)` · `lead_lease_renew(uuid, text, jsonb)` ·
  `lead_lease_release(uuid, text, jsonb)` · `lead_lease_force_release(uuid, uuid)` · `lead_lease_ttl()` — 셋 다 service_role 실행권
- 함수 본문은 `agent_lead_leases` 와 `lead_lease_ttl()` 만 참조한다(D-Flow 가 지운 `memberships`·`project_roles`·`agent_projects`·
  `agent_runners` 참조 없음 — 2026-10-23 grep 확인).

PL/pgSQL 은 호출할 때 참조를 푼다. `db:reset` 이 통과해도 함수가 실제로 도는지는 모른다. 그래서 §3-8 의 로컬 실행 확인과
§3-9 의 운영 DB 확인을 **건너뛰지 않는다.**

## 1. 전제

- D-Flow 클론, `main` 최신(`git pull`). **이 문서는 origin/main 만 전제한다** — 다른 PC 의 커밋 안 된 변경(스킬 교체 등)에 기대지 않는다.
- Node `^22.13.0 || >=24`(package.json engines), Docker 런타임(Docker Desktop 또는 colima), `supabase` CLI 2.75.
- `main` push 권한. **`main` push = 운영 배포**다.
- 원본 코드를 읽을 wbs-web 클론(코드만 — 아래 금지 참조):
  ```bash
  git clone https://github.com/donseok/wbs-web ../wbs-web-ref   # 이미 있으면 그 클론에서 git fetch
  ```

지켜야 할 것(D-Flow CLAUDE.md 요약):

- wbs-web 의 Supabase(`rglfgrwwwwdqejohdnty`·`abtyahghvvkcriawffty`)에 **접속하지 않는다.** 원본은 git 코드만 읽는다.
- wbs-web 을 D-Flow 의 remote 로 더하거나 fetch·cherry-pick 하지 않는다. 원본 이력이 D-Flow 에 들어오면 pre-push G5 가
  우회 없이 push 를 막는다. 원본 파일은 아래처럼 `git -C ../wbs-web-ref show … > <D-Flow 경로>` 로만 가져온다.
- `git add -A` 금지 — 파일명을 적어 stage 한다.
- push 는 사람 확인 뒤. `.env*`·`.dflow.local` 값(PAT)을 출력하거나 붙여넣지 않는다.

## 2. 원본 세 커밋

아래 명령은 모두 **D-Flow 루트에서** 실행한다(`git -C` 로 원본 클론을 읽기만 한다).

```bash
W="git -C ../wbs-web-ref"
$W show bfea5805 --stat          # 라우트 + leadLease.ts + 시험 2개 + 계약 2.5
$W show bfea5805:src/app/api/v1/agent/lead/lease/route.ts
$W show bfea5805:src/lib/agent/leadLease.ts
$W show bfea5805:tests/agent/lead-lease-parse.test.ts
$W show bfea5805:tests/agent/lead-lease-route.test.ts
$W show f27859b5 -- src/app/api/v1/agent/watch/route.ts tests/agent/watch-route.test.ts   # watch 의 holder
$W show 762457c7 -- src/app/api/v1/agent/watch/route.ts                                    # held 프로젝트가 limit 에 밀리지 않게
```

주의: wbs-web **최신** 라우트는 0106 의 `lead_lease_heavy` 를 부른다. 반드시 `bfea5805` 판을 기준으로 한다.

## 3. 작업 단계

UI 위험 파일을 건드리지 않으므로 `main` 직행으로 해도 된다(CLAUDE.md §브랜치). 마이그레이션도 없다.

### 3-1. `src/lib/agent/leadLease.ts` — 원본 그대로

D-Flow 루트에서 `git -C ../wbs-web-ref show bfea5805:src/lib/agent/leadLease.ts > src/lib/agent/leadLease.ts`
(D-Flow 이력에는 원본 커밋이 없으므로 `git -C` 없이 `git show` 하면 실패한다). `isUuidLike` 는 D-Flow 의
`@/lib/domain/agentWork` 에도 있다. 파일 머리 주석의 스펙 경로는 원본 리포 문서이니 "원본 wbs-web" 이라고 밝혀 둔다.

- 완료 기준: `npx tsc --noEmit` 이 이 파일로 오류를 내지 않는다.

### 3-2. 라우트 `src/app/api/v1/agent/lead/lease/route.ts` — D-Flow 권한 구조로 옮긴다

원본과 다른 점:

| 원본(wbs-web) | D-Flow | 이유 |
|---|---|---|
| `principal.kind === 'legacy'` 면 400 | 없앤다 | D-Flow 의 principal 은 PAT 하나뿐(SP7 §5.1.4) |
| 범위 밖·멤버 아님 → 403 `forbidden_role` | **404** | D-Flow 존재 은닉 규칙(watch 와 같다) |
| `isAgentProjectMember(admin, uid, pid)` | `agentActorFromPrincipal` 스냅샷 + `isProjectMember(actor, pid)` | 자격증명의 워크스페이스로 좁힌 판정 |
| 모듈 관문 없음 | `projectsWithModule(pids, 'agents', { client: admin, workspaceId })` 한 번 | `agent_lead_leases` 는 agents 토글 표(`tests/gates/_tables.ts`) |
| renew 는 판정 없음 | 멤버에서 빠졌거나 agents 가 꺼진 프로젝트는 연장하지 않고 `lost` | 모듈 관문이 그 모듈의 쓰기를 닫는다. 클라이언트는 `LEASE_LOST` 로 물러난다 |
| release 는 판정 없음 | 그대로(관문 **앞**에서 끝낸다) | 자기 lease 의 정리 — watch 의 `stop` 과 같은 원칙(P19) |

초안(시험이 최종 판정한다):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  agentActorFromPrincipal, apiBadRequest, apiInternalError, apiNotFound, patProjectAllowed, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { parseLeaseBody } from '@/lib/agent/leadLease'
import { isProjectMember } from '@/lib/domain/authz'
import { projectsWithModule } from '@/lib/modules/gate'

/**
 * 팀장 lease(계약 2.5) — 신원+프로젝트당 /dflow-team 팀장 하나. 원본 wbs-web bfea5805 를 D-Flow 권한 구조로 옮겼다.
 * 판정·CAS 는 기준선의 DB 함수(lead_lease_acquire·renew·release)가 행 잠금 안에서 한다. 여기서는 신원·스코프·멤버십·agents 관문만 거른다.
 * release 는 자기 lease 의 정리라 관문 앞에서 끝낸다(watch 의 stop 과 같다). acquire·renew 는 관문 뒤다.
 * 자격증명 범위 밖·멤버 아님·agents 꺼짐은 없는 프로젝트와 같은 404 다(원본의 403 forbidden_role 대신 — 존재 은닉).
 */
export const dynamic = 'force-dynamic'

interface AcquireRow { project_id: string; ok: boolean; generation: number; host: string | null; agent: string | null; expires_at: string | null }
interface RenewRow { project_id: string; ok: boolean; expires_at: string | null }

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const parsed = parseLeaseBody(raw)
  if ('error' in parsed) return apiBadRequest(parsed.error)

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    const pids = parsed.op === 'acquire' ? parsed.projects : parsed.leases.map((l) => l.project_id)
    if (pids.some((pid) => !patProjectAllowed(principal, pid))) return apiNotFound()

    if (parsed.op === 'release') {
      const { data, error } = await admin.rpc('lead_lease_release', {
        p_user: principal.userId, p_holder: parsed.holder, p_leases: parsed.leases,
      })
      if (error) { console.error('[agent-api] lease release 실패:', error.message); return apiInternalError() }
      return NextResponse.json({ ok: true, released: typeof data === 'number' ? data : 0 })
    }

    // 관문 — 소유자 스냅샷(조회 실패는 throw → 아래 catch 의 500)과 agents 모듈. 핸들러 최상위에서 한 번 늘 돈다.
    const actor = await agentActorFromPrincipal(admin, principal.userId, principal)
    const on = new Set(await projectsWithModule(pids, 'agents', { client: admin, workspaceId: principal.credential.workspaceId }))
    const usable = (pid: string) => on.has(pid) && isProjectMember(actor, pid)

    if (parsed.op === 'acquire') {
      // 멤버가 아닌 프로젝트의 lease 를 잡아 그 프로젝트의 진짜 팀장을 막는 일을 막는다.
      if (!parsed.projects.every(usable)) return apiNotFound()
      const { data, error } = await admin.rpc('lead_lease_acquire', {
        p_user: principal.userId, p_projects: parsed.projects, p_holder: parsed.holder,
        p_host: parsed.host, p_agent: parsed.agent, p_takeover: parsed.takeover,
      })
      if (error) { console.error('[agent-api] lease acquire 실패:', error.message); return apiInternalError() }
      const rows = (data ?? []) as AcquireRow[]
      const held = rows.filter((r) => !r.ok)
      if (held.length > 0) {
        return NextResponse.json({
          error: '같은 신원의 다른 팀장이 이 프로젝트의 lease 를 쥐고 있습니다.', code: 'lead_lease_held',
          held: held.map((r) => ({ project_id: r.project_id, host: r.host, agent: r.agent, expires_at: r.expires_at })),
        }, { status: 409 })
      }
      return NextResponse.json({
        ok: true, leases: rows.map((r) => ({ project_id: r.project_id, generation: r.generation, expires_at: r.expires_at })),
      })
    }

    // renew — 멤버에서 빠졌거나 agents 가 꺼진 프로젝트는 연장하지 않고 lost 로 돌려준다(클라이언트가 LEASE_LOST 로 물러난다).
    const keep = parsed.leases.filter((l) => usable(l.project_id))
    const dropped = parsed.leases.filter((l) => !usable(l.project_id)).map((l) => l.project_id)
    let rows: RenewRow[] = []
    if (keep.length > 0) {
      const { data, error } = await admin.rpc('lead_lease_renew', {
        p_user: principal.userId, p_holder: parsed.holder, p_leases: keep,
      })
      if (error) { console.error('[agent-api] lease renew 실패:', error.message); return apiInternalError() }
      rows = (data ?? []) as RenewRow[]
    }
    const kept = rows.filter((r) => r.ok && r.expires_at).map((r) => r.expires_at as string).sort()
    return NextResponse.json({
      ok: true, expires_at: kept[0] ?? null, lost: [...rows.filter((r) => !r.ok).map((r) => r.project_id), ...dropped],
    })
  } catch (e) {
    console.error('[agent-api] lease 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- 참고: dmes 클라이언트는 renew 에 `heavy` 필드를 실어 보낼 수 있다. 2.5 파서는 모르는 필드를 무시한다(0106 을 옮기는 2단계까지).
- 완료 기준: 타입 검사 통과, §3-5 의 시험 통과.

### 3-3. watch 의 `holder` — `src/app/api/v1/agent/watch/route.ts`

원본 `f27859b5` 와 `762457c7` 를 **둘 다** 반영한다. D-Flow 의 `loadResumeRequests` 는 인자가 원본과 다르다
(`admin, userId, projectId, principal, allowedProjectIds`) — 마지막에 `holder: string | null` 을 더한다.

1. POST 본문 파싱(`try` 앞)에서 `holder` 를 읽는다. 없거나 null 이면 null, 있으면 `HOLDER_RE`(`@/lib/agent/leadLease`)에 맞아야 하고
   아니면 400 `holder 형식이 올바르지 않습니다.`
2. `loadResumeRequests` 첫머리에서 holder 가 있으면 `agent_lead_leases` 에서 `user_id = userId`, `holder = holder`,
   `expires_at > now()` 인 `project_id` 를 읽는다.
   - 조회 실패 → 로그 후 `null`(호출자가 `resume_requests_error` 를 싣는다 — 에러 3원칙).
   - 집합이 비면 **주문 조회 없이 `[]`** (762457c7).
   - 아니면 주문 쿼리에 `.in('project_id', [...leased])` 를 더하고(762457c7), 결과에도 같은 집합으로 메모리 거르기를 한 번 더 한다(이중 방어선).
3. 호출부(관문 뒤에 있는 기존 호출)에 `holder` 를 넘긴다. **관문 앞으로 옮기지 않는다.**

- 완료 기준: holder 를 안 보내는 요청의 응답이 바이트 단위로 예전과 같다(기존 watch 시험 그대로 통과).

### 3-4. 계약 버전 2.5

- `src/lib/agent/externalApi.ts`: `AGENT_CONTRACT_VERSION = '2.5'`.
- `tests/agent/me-route.test.ts` 의 `toBe('2.4')` → `'2.5'`.
- `tests/skills/dflow-key-select.test.ts` 의 `"contract_version":"2.4"` 는 가짜 서버 응답 고정값이라 **바꾸지 않는다.**

### 3-5. 시험·관문 목록 (같은 커밋)

| 파일 | 할 일 |
|---|---|
| `tests/agent/lead-lease-parse.test.ts` | 원본 `bfea5805` 그대로(순수 함수) — `git -C ../wbs-web-ref show bfea5805:tests/agent/lead-lease-parse.test.ts > tests/agent/lead-lease-parse.test.ts` |
| `tests/agent/lead-lease-route.test.ts` | 새로 쓴다. 원본 시험의 케이스를 `tests/agent/watch-route.test.ts` 의 mock 방식(`../fixtures/credentials` 의 `agentCredential`·`ownerLookup`, `../fixtures/actor`, 전역 관문 mock)으로 옮긴다. 아래 케이스 표 |
| `tests/agent/watch-route.test.ts` | holder 케이스 추가: 형식 틀림 400 · lease 없음 → `[]` 이고 주문 조회 안 함 · lease 있는 프로젝트만 · lease 조회 실패 → `resume_requests: null` + `resume_requests_error` |
| `tests/gates/manifest.ts` | ``[`${R('v1/agent/lead/lease')}#POST`]: agent(),`` (watch 줄 옆) |
| `tests/modules/agents-gate.test.ts` | `V1_ROUTES` 에 `'@/app/api/v1/agent/lead/lease/route'` 를 더하고 정적 단언(`/projectsWithModule\(/`)을 하나 둔다. 개수를 적은 주석(11)도 고친다. `delegatedStatic` 확인이 이 파일에서 경로 문자열을 찾는다 |
| `tests/fixtures/agent-api-paths.json` | `upstream`·`normalized` 두 목록에 `api/v1/agent/lead/lease` 를 정렬 위치에 넣는다 |
| `.claude/skills/dflow-work/references/api-contract.md` | 제목을 v2.5 로, 아래 「v2.5 변경점」 절을 v2.4 절 위에 넣는다. **이 문구가 없으면 `tests/skills/api-paths-frozen.test.ts` 가 실패한다**(스킬 문서의 경로 = 라우트 파일 목록) |
| `tests/gates/_rpc-tables.ts` | 관문 시험이 `rpc?:lead_lease_*` 로 실패할 때만 `lead_lease_acquire`·`lead_lease_release`·`lead_lease_renew: ['agent_lead_leases']` 를 코드 포인트 순으로 더한다 |

route 시험 케이스:

| 케이스 | 기대 |
|---|---|
| 본문 JSON 아님 / op 틀림 / holder 형식 틀림 | 400 |
| 토큰 없음 | 401 |
| `work:read` 만 있는 PAT | 403 `insufficient_scope` |
| 자격증명 범위 밖 프로젝트 | 404 |
| acquire — 멤버 아님 / agents 꺼짐 | 404, RPC 안 부름 |
| acquire — 정상 | 200 `{ok, leases:[…]}` |
| acquire — 다른 holder 가 쥠 | 409 `lead_lease_held` + `held[]` |
| renew — 정상 / 일부 프로젝트 멤버 아님 | 200, 빠진 프로젝트는 `lost` 에 들어가고 RPC 에는 안 실린다 |
| renew — 전부 빠짐 | 200, RPC 안 부름, `expires_at: null` |
| release | 200 `{ok, released}`, **관문(`projectsWithModule`)을 부르지 않는다** |
| RPC 오류 | 500 |

`api-contract.md` 에 넣을 절:

```markdown
## v2.5 변경점 (2026-10-23 — D-Flow 이식, 원본 wbs-web 2026-09-23)

- `POST /api/v1/agent/lead/lease` 신설 — 신원+프로젝트당 `/dflow-team` 팀장 하나. 본문 `op`:
  - `acquire` `{projects, holder, host, agent, takeover?}` → 200 `{ok, leases:[{project_id, generation, expires_at}]}` · 409 `lead_lease_held` + `held:[{project_id, host, agent, expires_at}]`
  - `renew` `{holder, leases:[{project_id, generation}]}` → 200 `{ok, expires_at, lost:[project_id]}` — 멤버에서 빠졌거나 agents 가 꺼진 프로젝트는 `lost`
  - `release` `{holder, leases}` → 200 `{ok, released}`
  - `holder` = `<PC ID uuid>:<리포 경로 cksum>`. TTL 180초. PAT 전용, `work:claim`.
  - D-Flow 차이: 자격증명 범위 밖·멤버 아님·agents 꺼짐은 404 다(원본은 403 `forbidden_role`).
- `POST /api/v1/agent/watch` 에 선택 필드 `holder` — 주면 `resume_requests` 를 그 holder 로 쥔 유효 lease 의 프로젝트로 거른다. lease 조회 실패는 `resume_requests: null`.
```

### 3-6. 정적 검사

```bash
npm run lint && npm run test && npm run build
```

- 완료 기준: 셋 다 0 실패.
- 멈춤 조건: 관문·불변식 시험(`tests/gates/**`·`tests/invariants/**`·`tests/modules/**`)이 실패하는데 이 문서의 표로 풀리지 않으면,
  시험을 고치지 말고 실패 메시지를 그대로 보고한다. 이 시험들은 권한 관문을 지키는 장치다.

### 3-7. 커밋

```bash
git add src/lib/agent/leadLease.ts src/app/api/v1/agent/lead/lease/route.ts src/app/api/v1/agent/watch/route.ts \
  src/lib/agent/externalApi.ts tests/agent/lead-lease-parse.test.ts tests/agent/lead-lease-route.test.ts \
  tests/agent/watch-route.test.ts tests/agent/me-route.test.ts tests/gates/manifest.ts tests/modules/agents-gate.test.ts \
  tests/fixtures/agent-api-paths.json .claude/skills/dflow-work/references/api-contract.md
# _rpc-tables.ts 를 고쳤으면 더한다. git status 로 빠진 파일이 없는지 본다.
git commit   # 한국어, "왜" 위주. 예: "팀장 lease 라우트를 옮겨 계약 2.5 를 연다 — dmes 스킬의 /dflow-team 이 404 로 멈춘다"
```

아직 push 하지 않는다.

### 3-8. 로컬 실행 확인 (필수)

```bash
npm run db:start && npm run db:reset && npm run env:local && npm run dev:bootstrap
npm run dev
```

1. 브라우저에서 프로젝트를 하나 만들고 프로젝트 설정에서 **agents 모듈을 켠다.**
2. `/account` 에서 `work:claim` 스코프가 있는 에이전트 토큰을 발급한다(값은 셸 변수로만 쓰고 어디에도 남기지 않는다).
3. 같은 라우트로 한 바퀴 돈다:
   ```bash
   B=http://localhost:3000/api/v1/agent/lead/lease; H="$(uuidgen | tr A-Z a-z):12345"; P=<프로젝트 uuid>
   curl -s -X POST $B -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d "{\"op\":\"acquire\",\"projects\":[\"$P\"],\"holder\":\"$H\",\"host\":\"lead-pc\",\"agent\":\"me/lead-pc/lead\"}"
   # → 200 {ok:true, leases:[{project_id, generation:1, ...}]}
   curl -s -X POST $B -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d "{\"op\":\"renew\",\"holder\":\"$H\",\"leases\":[{\"project_id\":\"$P\",\"generation\":1}]}"
   # → 200 {ok:true, expires_at:…, lost:[]}
   # 다른 holder 로 acquire → 409 lead_lease_held
   curl -s -X POST $B -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d "{\"op\":\"release\",\"holder\":\"$H\",\"leases\":[{\"project_id\":\"$P\",\"generation\":1}]}"
   # → 200 {ok:true, released:1}
   ```
4. 끝나면 `npm run db:stop`.

- 완료 기준: 위 네 응답이 기대대로 나온다.
- 멈춤 조건: 500 이 나면 dev 서버 로그의 `[agent-api] lease … 실패:` 문구를 본다. 함수 본문이 D-Flow 스키마와 안 맞는 것이면
  마이그레이션이 필요하다는 뜻이다 — 고치지 말고 보고한다.

### 3-9. 운영 DB 확인 (push 전 필수 — 멈춤 관문)

Supabase 대시보드 → 프로젝트 `dflow-prod`(ref `aivjcfoeshnhqdrfteyq`) → SQL Editor 에서 **읽기만** 한다.

```sql
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'lead_lease%' order by 1;
-- 기대: lead_lease_acquire, lead_lease_force_release, lead_lease_release, lead_lease_renew, lead_lease_ttl (5행)
select count(*) from public.agent_lead_leases;
-- 기대: 오류 없이 숫자
```

- 멈춤 조건: 5행이 아니거나 표가 없으면 **push 하지 않는다.** 운영에 스키마가 없는 채로 코드가 나가면 라우트가 500 을 낸다. 보고한다.

### 3-10. push = 운영 배포 (사람 확인 뒤)

```bash
git push origin main
```

- GitHub Actions(lint·test·build) 결과를 확인한다.
- Vercel 배포가 끝나면 `SMOKE_URL=https://d-flow-eight.vercel.app npm run smoke:prod`.
- 키 없이 **정상 acquire 본문을 보내** 401을 확인한다(예전 404). 본문을 생략하면 인증 전에 JSON 파싱에서 400이므로 라우트 인증 확인이 되지 않는다.
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST https://d-flow-eight.vercel.app/api/v1/agent/lead/lease \
    -H 'Content-Type: application/json' \
    -d '{"op":"acquire","projects":["11111111-1111-4111-8111-111111111111"],"holder":"11111111-1111-4111-8111-111111111111:12345","host":"smoke","agent":"smoke/lead"}'
  # → 401
  ```

## 4. 팀장 PC 에서 확인 (`oranda`)

전제: 그 PC 의 토큰(`.dflow.local`)에 `work:claim` 스코프가 있고, 토큰 주인이 그 프로젝트의 멤버 이상이며,
프로젝트 설정에서 agents 모듈이 켜져 있다. 맡길 작업에는 `agent` 태그가 있어야 팀장이 집는다.

```bash
cd <oranda 경로>
node .claude/skills/dflow-work/scripts/dflow.mjs contract-ge 2.5; echo "exit=$?"   # → exit=0
node .claude/skills/dflow-work/scripts/dflow.mjs lease acquire                      # → LEASE_OK <n>
node .claude/skills/dflow-work/scripts/dflow.mjs lease release
```

그다음 Claude 세션에서 `/dflow-team 18:00`(원하는 종료 시각)을 다시 실행한다.

- `LEAD_LEASE_HELD …` 가 나오면 같은 신원의 다른 팀장이 살아 있다는 뜻이다. 그 팀장을 끝내거나 180초를 기다린다(`--takeover` 는 사람이 판단).
- 404 가 나오면 토큰의 프로젝트 범위·멤버십·agents 모듈 셋 중 하나다(D-Flow 는 셋을 구분하지 않는다 — 존재 은닉).
- 멈춤 조건: lease 는 잡혔는데 `/dflow-team` 이 그 뒤 단계에서 멈추면, 실패한 명령·HTTP 코드·응답 본문을 그대로 적어 보고한다.
  그 자리에서 스킬이나 서버를 고치지 않는다. dmes 스킬(2.11)을 2.5 서버에 붙여 `/dflow-team` 을 끝까지 돌려 본 적은 아직 없다.

## 5. 1단계 뒤에도 남는 차이 (알고 쓰기)

D-Flow 가 2.5 가 되어도 dmes 스킬(2.11)의 다음 기능은 꺼진 채다. 스킬 코드를 읽어 보면 계약 버전을 보고 건너뛰게 되어 있다
(`build-start`·`design-done`·`design-reopen` 은 코드로 확인, `/dflow-team` 의 2.11 대체 경로는 SKILL 문서로만 확인).
실제로 돌려 확인한 것은 아니므로 §4 의 멈춤 조건을 따른다.

| 기능 | D-Flow 에서 |
|---|---|
| 완료 보고의 결정 목록 `decisions`(2.6) | 저장 안 됨, 스킬이 경고만 |
| 팀장의 머지 충돌 표시(2.7) | heartbeat 400 — 표시 안 됨 |
| 선행 면제·스텁 주문(2.8) | 없음 |
| 설계 먼저·`build-start`(2.9), 설계 상태(2.11) | 스킬이 건너뜀 — 모든 작업을 전체 자동으로 처리 |
| heartbeat `prepare`·`wait_pred`·`wait_review` | 400 — 그동안 좌석 신호가 빠짐 |
| 토큰 사용량(`tokens`), 에이전트 콘솔 3종 | 없음 |

1단계 배포 전이라도 `/dflow-dev <작업>` 으로 한 건씩은 진행할 수 있다(팀장 등록이 필요 없다).

## 6. 2단계 개요 — 계약 2.6~2.11 과 콘솔

원본 커밋 목록:

```bash
git -C ../wbs-web-ref log --oneline --reverse bfea5805..origin/main -- src/app/api/v1/agent src/lib/agent supabase/migrations
```

| 계약 | 원본 마이그레이션 | 내용 |
|---|---|---|
| 2.6 | 0102 `agent_report_decisions` | 완료 보고 `decisions` (기준선에 열이 있는지 먼저 확인) |
| 2.7 | — | 팀장 대리 `merge_conflict` heartbeat |
| 2.8 | 0103 `force_progress` | 선행 면제·스텁 하위 Task (기준선에 `depends_waived` 있음 — 코드만일 수 있다) |
| (불변) | 0104 `agent_order_tokens`·0105 `agent_report_model`·0106 `agent_heavy_work` | 토큰 사용량, 보고 모델, 무거운 작업 |
| 2.9 | 0107 `wbs_design_stage` | 단계 `ds`, claim `design_first`, `build-start` |
| 2.10 | — | heartbeat `wait_review` |
| 2.11 | 0108 `design_state` | 설계 방식·설계 상태, `design-done`·`design-reopen`, 목록의 `action`·`mine` |
| (불변) | 0109·0110·0111·0112 `agent_console*`·`agent_watcher_summary` | 에이전트 콘솔, 감시자 요약 |

진행 규칙(CLAUDE.md):

- 마이그레이션은 D-Flow 다음 번호(현재 마지막 `0061`)로 다시 매기고, `supabase/rollbacks/` 에 롤백 파일을 함께 만든다.
- 마이그레이션 커밋과 코드 커밋을 나눈다(G1). `npm run db:reset` 으로 리허설하고 트레일러 `Staging-verified: local db reset <일시>`(G4).
- 운영 DB 에 먼저 적용(`PROD_REF=aivjcfoeshnhqdrfteyq npm run db:apply -- <파일> --target prod`)하고 `schema_migrations` 행을 넣은 뒤 코드를 push 한다.
- 원본 코드를 옮길 때마다 §3-2 표처럼 D-Flow 권한 구조(자격증명 범위 판정, 모듈 관문, 존재 은닉 404, 관문 매니페스트·RPC 표·불변식 시험)에 맞춘다.
- 계약 버전 단위로 나눠 커밋·배포한다.
