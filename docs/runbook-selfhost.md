# 자체호스트 실행·리허설

현재 로컬 리허설만 진행 중이며 고객 폐쇄망 배포 완료를 의미하지 않는다.

## standalone 패키징

Node 버전은 package.json의 engines를 따른다. 빌드 시 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY를 목적 환경에 맞춰 제공한다. 공개 환경 변수는 빌드 산출물에 고정된다.

```sh
NEXT_OUTPUT=standalone npm run build
cp -R public .next/standalone/public
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static
HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

런타임에는 SUPABASE_SERVICE_ROLE_KEY 등 서버 환경 변수를 별도로 전달한다. 서비스 키와 SMTP/LLM 비밀값을 공개 디렉터리에 넣지 않는다. 외부 URL은 NEXT_PUBLIC_APP_URL로 지정한다. API·SMTP·AI의 활성 조건과 값은 .env.local.example 및 설정 카탈로그를 따른다.

## 잡(스케줄) 실행

잡의 정본은 `src/lib/jobs/registry.ts` 다. Vercel 은 `vercel.json` 의 `crons`(레지스트리에서 `npm run jobs:write` 로 생성)가 돌리고,
자체호스트는 `vercel.json` 을 읽지 않으므로 **같은 URL 을 systemd timer 나 cron 이 같은 헤더로** 친다.

- 인증은 전부 `Authorization: Bearer <CRON_SECRET>` 하나다(스케줄 `GET`·수동 `POST` 공통). `CRON_SECRET` 이 없으면 잡 라우트는 전부 404,
  값이 다르면 401, 잡의 활성 플래그가 꺼져 있으면 404 다.
- 스케줄은 UTC 다. 아래 값은 Vercel Hobby(하루 1회 한도)에 맞춘 것이고, 자체호스트에서는 색인·위키 워커를 더 자주(예: 5~10분) 돌려도 된다 — 잡은 멱등이다.
- 배포 환경은 `APP_ENV=production` 을 런타임 env 로 준다(사용 기록 수집 기본값이 이 값을 본다).

| 잡 id | 메서드·경로 | 기본 스케줄(UTC) | 활성 조건 | 수동 `POST` 의 `mode` |
|---|---|---|---|---|
| `inbox-retention` | `GET /api/cron/inbox-retention` | `0 19 * * *` | 항상 | 없음 |
| `form-templates-gc` | `GET /api/cron/form-templates-gc` | `30 19 * * *` | 항상 | 없음 |
| `minutes-attachments-gc` | `GET /api/cron/minutes-attachments-gc` | `0 20 * * *` | 항상 | 없음(dry-run 점검은 `npm run minutes:sweep -- --target local`) |
| `ai-index` | `GET /api/cron/ai-index` | `0 18 * * *` | `CHAT_V2_INDEX_WORKER_ENABLED=true` 그리고 `CHAT_V2_ENABLED=true` | `worker`·`consistency`·`backfill`·`repair` |
| `wiki-worker` | `GET /api/wiki/worker` | `30 18 * * *` | `WIKI_WORKER_ENABLED=true` | `worker` |

systemd 예(잡마다 service + timer 한 쌍. 시크릿은 권한 600 인 env 파일에 둔다):

```ini
# /etc/systemd/system/dflow-job@.service
[Service]
Type=oneshot
EnvironmentFile=/etc/dflow/jobs.env        # CRON_SECRET=…  APP_URL=http://127.0.0.1:3000  (chmod 600)
ExecStart=/usr/bin/curl -fsS --max-time 300 -H "Authorization: Bearer ${CRON_SECRET}" "${APP_URL}%I"

# /etc/systemd/system/dflow-job-ai-index.timer
[Timer]
OnCalendar=*:0/10                          # 10분마다(UTC 기준이 필요하면 OnCalendar 끝에 UTC 를 붙인다)
Unit=dflow-job@-api-cron-ai\x2dindex.service   # systemd-escape --path /api/cron/ai-index 의 결과
[Install]
WantedBy=timers.target
```

cron 예(`/etc/cron.d/dflow`, 서버 시간대가 UTC 일 때 — 시크릿을 명령줄에 적지 않도록 `curl -K` 설정 파일을 쓴다):

```
# /etc/dflow/curl-job.conf (chmod 600):  header = "Authorization: Bearer <CRON_SECRET>"
0 19 * * *   dflow  curl -fsS -K /etc/dflow/curl-job.conf http://127.0.0.1:3000/api/cron/inbox-retention
30 19 * * *  dflow  curl -fsS -K /etc/dflow/curl-job.conf http://127.0.0.1:3000/api/cron/form-templates-gc
0 20 * * *   dflow  curl -fsS -K /etc/dflow/curl-job.conf http://127.0.0.1:3000/api/cron/minutes-attachments-gc
*/10 * * * * dflow  curl -fsS -K /etc/dflow/curl-job.conf http://127.0.0.1:3000/api/cron/ai-index
*/10 * * * * dflow  curl -fsS -K /etc/dflow/curl-job.conf http://127.0.0.1:3000/api/wiki/worker
```

수동 실행 예: `curl -fsS -X POST -K /etc/dflow/curl-job.conf -H 'Content-Type: application/json' -d '{"mode":"consistency","domain":"wbs","dryRun":true}' http://127.0.0.1:3000/api/cron/ai-index`.
위 systemd·cron 예는 문서 예시이며 이 리포에서 실제 호스트로 리허설하지 않았다.

## 첫 부트스트랩 — 첫 플랫폼 관리자와 첫 워크스페이스

빈 원격 DB(마이그레이션만 적용된 상태)에는 로그인할 계정이 없다. 로컬은 `npm run dev:bootstrap`(`.env.local` 이 로컬일 때만 돈다)이 맡고,
원격·자체호스트는 **별도 스크립트** `npm run remote:bootstrap` 이 맡는다. 그 뒤의 워크스페이스는 화면(`/admin/workspaces`)에서 플랫폼 관리자가 만든다.

```sh
# Supabase 클라우드: ref 만 주면 주소는 https://<ref>.supabase.co
PROD_REF=<프로젝트 ref> npm run remote:bootstrap -- --target prod

# 자체호스트 Supabase: API 주소를 직접 준다. PROD_REF 에는 그 주소에 들어 있는 호스트 이름을 적는다(이름 붙인 대상과 실제 주소가 어긋나면 멈춘다)
PROD_REF=<Supabase API 호스트 이름> BOOTSTRAP_SUPABASE_URL=https://<Supabase API 호스트 이름> npm run remote:bootstrap -- --target prod
```

- 대상은 `--target staging|prod` 뿐이고 `scripts/lib/targets.mjs` 로 해석한다. 원본 리포의 DB ref(금지 목록)는 어떤 값으로 들어와도 멈추며, 그 검사를 끄는 인자·환경 변수는 없다.
  주소는 https 만 받는다(service_role 키를 평문으로 보내지 않는다) — 내부망의 http 주소뿐이면 TLS 를 끝내는 프록시나 SSH 터널을 앞에 둔다.
- **멱등**: 플랫폼 관리자가 한 명이라도 있으면 아무것도 하지 않고 0 으로 끝난다(다시 돌려도 안전하다). 그 수를 읽지 못하면 만들지 않고 멈춘다.
- **비밀값**: service_role 키와 비밀번호는 환경 변수(`BOOTSTRAP_SERVICE_ROLE_KEY`·`BOOTSTRAP_PASSWORD`)나 입력이 보이지 않는 프롬프트로만 받는다.
  명령 인자로 받지 않고, 파일에 쓰지 않으며, 출력에 싣지 않는다. 환경 변수로 줄 때는 셸 기록에 남지 않게 한다(예: 앞에 공백을 두는 `HISTCONTROL=ignorespace`, 또는 권한 600 인 파일을 `source`).
- 그 밖의 입력은 프롬프트로 묻거나 환경 변수로 받는다: `BOOTSTRAP_EMAIL`, `BOOTSTRAP_WORKSPACE_SLUG`(소문자·숫자·하이픈 2~63자), `BOOTSTRAP_WORKSPACE_NAME`,
  `BOOTSTRAP_MODULES`(쉼표 목록 — 없으면 비core 전부, 빈 문자열은 core 만), `BOOTSTRAP_TIMEZONE`(IANA 이름 — 줬을 때만 쓴다).
- 실행 전에 대상과 할 일을 출력하고 대상 ref 를 다시 입력받는다. 무인 실행은 `--yes` 로 그 질문만 생략한다(대상 검사는 생략되지 않는다).
- 중간에 실패하면 만든 계정을 지운다(워크스페이스 행은 멱등이라 남는다). 계정 삭제까지 실패하면 그 사실을 알린다 — Supabase 대시보드(Authentication)에서 그 계정을 지운 뒤 다시 실행한다.

**미검증**: 원격이 아직 없어 이 스크립트를 실제 대상에 돌려 보지 못했다. 자동 테스트가 덮는 것은 인자·대상 해석(금지 대상 거부 포함)·멱등 판정·입력 검증뿐이다
(`tests/scripts/bootstrap-remote.test.ts`). 첫 실행은 스테이징에서 하고 결과를 이 절에 기록한다.

## 비밀번호 재설정 메일

로그인 화면의 "비밀번호를 잊으셨나요?"는 **앱의 메일 발송 설정(SMTP_*)이 있을 때만** 보인다(없으면 "관리자에게 문의" 안내 그대로). 재설정 메일 자체는 앱이 아니라 Supabase Auth 가 보내므로, 켜려면 두 곳을 같이 맞춘다.

- Supabase Auth 의 SMTP: 클라우드는 대시보드 Authentication → Emails → SMTP Settings, 자체호스트는 GoTrue 의 `GOTRUE_SMTP_*`. 기본 내장 발송기는 시간당 발송 수가 매우 적어 운영에 쓸 수 없다.
- 돌아올 주소: Auth 의 Site URL 을 `NEXT_PUBLIC_APP_URL` 과 같은 호스트로 두거나 Redirect URLs 에 `<NEXT_PUBLIC_APP_URL>/login/reset` 을 더한다. 맞지 않으면 링크가 Site URL 로 돌아오고, 로그인 화면이 재설정 조각을 알아보고 새 비밀번호 화면으로 넘긴다(같은 호스트일 때만).
- 요청 제한은 Auth 의 발송 제한(`rate_limit.email_sent`, 같은 주소 재요청 간격)에 기댄다. 앱 계층의 요청 제한은 없다.
- 로컬 개발은 SMTP 설정 없이도 링크가 보인다 — 로컬 Supabase 가 인증 메일을 자기 메일함(inbucket — `supabase status` 의 Mailpit/Inbucket 주소)으로 받는다.

## 헬스체크

`GET /api/health` — 인증 없이 친다. 로드밸런서·가동 감시·systemd 의 생존 확인에 쓴다. 응답은 캐시되지 않는다(`Cache-Control: no-store`).

| 요청 | 하는 일 | 응답 |
|---|---|---|
| `GET /api/health` | 프로세스가 요청을 받는지만(DB 를 건드리지 않는다) | 200 `{"ok":true}` |
| `GET /api/health?deep=1` + `Authorization: Bearer <CRON_SECRET>` | DB 를 한 번 읽는다 | 200 `{"ok":true,"db":"ok"}` / 실패 503 `{"ok":false,"db":"unavailable"}` |
| `GET /api/health?deep=1`(시크릿 없음·불일치·`CRON_SECRET` 미설정) | 얕은 점검으로 내려간다 — 익명 요청이 DB 조회를 만들지 못하게 | 200 `{"ok":true}` |

깊은 점검이 실제로 돌았는지는 응답의 `db` 칸으로 안다(없으면 얕은 점검이었다). 응답에는 오류 문구·버전·환경 값을 싣지 않는다 — 503 의 원인은 서버 로그의 `[health]` 줄에 있다.

```sh
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS -K /etc/dflow/curl-job.conf 'http://127.0.0.1:3000/api/health?deep=1'   # 잡과 같은 시크릿 설정 파일
```

## 오류 참조 ID

화면이 렌더 중 오류로 깨지면 오류 화면("화면을 불러오지 못했습니다")에 **참조 ID** 가 보이고 복사 버튼이 있다. 이 값은 Next.js 가 서버 오류마다 붙이는 `digest` 다.
서버는 같은 오류를 표준 오류 출력에 남기면서 그 `digest` 를 함께 적는다 — 사용자가 알려 준 참조 ID 로 서버 로그를 찾는다:

```sh
journalctl -u dflow --since '1 hour ago' | grep -F '<참조 ID>'      # systemd 로 띄운 경우(유닛 이름은 예시)
```

오류 메시지와 스택은 화면에 보이지 않는다(프로덕션 빌드에서 Next 가 서버 오류 메시지를 가린다). 참조 ID 가 없는 오류 화면은 브라우저에서만 난 오류다 — 서버 로그에 대응하는 줄이 없다.
서버 액션이 돌려주는 실패(저장 실패 등)는 이 화면이 아니라 그 자리의 안내 문구로 나오고 참조 ID 가 붙지 않는다. 로그 보관 기간·수집기는 호스트가 정한다(이 리포는 정하지 않는다).

## 응답 보안 헤더

모든 응답에 `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`(카메라·마이크·위치 등 차단),
`Content-Security-Policy: frame-ancestors 'none'` 이 붙는다(구성은 `src/lib/http/securityHeaders.ts`). `Strict-Transport-Security` 는 `APP_ENV=production` 일 때만 붙는다 —
TLS 를 앞단 프록시가 끝내는 구성에서도 브라우저가 https 로 받은 응답이면 적용된다.

나머지 콘텐츠 보안 정책은 **보고 전용**(`Content-Security-Policy-Report-Only`)이다: 어긋나는 자원을 막지 않고 브라우저 콘솔에만 위반을 남긴다. 정책의 Supabase 출처는
빌드 때의 `NEXT_PUBLIC_SUPABASE_URL` 에서 나온다. 강제 전환은 배포된 화면에서 콘솔 위반이 0 인 것을 확인한 뒤의 일이고 아직 하지 않았다(화면이 깨져도 자동 테스트가 잡지 못한다).
앞단 프록시가 같은 이름의 헤더를 따로 붙이면 값이 겹치므로 한쪽에서만 붙인다.

## 백업·복구

`docs/runbook-backup.md` 에 따로 적었다(pg_dump 주기·보관, Storage 버킷, 복구 리허설, 복구 뒤 `settings:verify`).

## 출시 수용 기록

**상태 낱말.** `로컬 검증(자동 테스트)` = 개발 PC 의 단위·RLS 테스트가 통과했다. `로컬 검증(수동)` = 개발 PC 에서 사람이 한 번 띄워 확인했다.
어느 항목도 **실제 호스트(폐쇄망·운영 서버)에서 검증하지 않았다** — 맨 위 문장("로컬 리허설만 진행 중")과 같은 뜻이고, 아래 "실호스트" 열이 그것을 항목마다 적는다.
근거 열의 건수·번호는 기록 시점(2026-10-06, 마이그레이션 0039 까지)의 것이다. 그 뒤의 마이그레이션(0040 이후)은 이 표에 다시 기록하지 않았다.

| 항목 | 상태 | 실호스트 | 근거·남은 확인 |
|---|---|---|---|
| R1 스키마 | 로컬 검증(자동 테스트) | 미검증 | 격리 스택 0039까지 reset 및 RLS 916건 전수 통과. 메인 DB 0038/0039 적용 및 사후 검증 통과(개발 PC 의 로컬 스택). 남은 확인: 실호스트 Postgres 에 기준선부터 적용 |
| R2 Auth | 로컬 검증(자동 테스트) | 미검증 | 세션 전환·워크스페이스 격리·쿠키 세션(RLS 55개 파일 전수 초록). 앱은 `getClaims()` 로 세션을 검증하고 **비대칭 서명(ES256, JWKS)** 을 전제로 한다(`src/middleware.ts`·`src/lib/authz/index.ts`) — 대칭(HS256) 키면 `getClaims()` 가 GoTrue 왕복으로 폴백해 동작은 같지만 요청마다 왕복이 붙는다. 남은 확인: 실호스트 Supabase 의 서명 방식 |
| R3 Storage | 로컬 검증(자동 테스트) | 미검증 | 회의록 파일 업로드·첨부 정책·저장소 경로(tests/domain/storage-path.test.ts). 남은 확인: 실호스트 Storage 의 업로드·서명 URL |
| R4 Realtime | 로컬 검증(자동 테스트) | 미검증 | WBS 및 사용자 필드 Realtime 통지·수신(tests/domain/wbs-realtime.test.ts, RLS). 남은 확인: 실호스트의 WebSocket 경로(프록시 업그레이드 헤더) |
| R5 로컬 AI | 로컬 검증(자동 테스트) | 미검증 | 색인 잡·도구 컨텍스트·임베딩 차원 일관성(tests/actions/cron-ai-index.test.ts). 남은 확인: 실호스트의 로컬 LLM·임베딩 엔드포인트 연결 |
| R6 잡 | 로컬 검증(자동 테스트) | 미검증 | AI 색인 잡 스코프(0038) 및 크론 잡(tests/actions/cron-ai-index.test.ts). 남은 확인: 위 systemd·cron 예를 실호스트에서 돌리기(같은 절에 "리허설하지 않았다"고 적혀 있다) |
| R7 standalone | 로컬 검증(수동) | 미검증 | 개발 PC 에서 standalone 빌드 및 포트 3183 단독 기동, 서버 액션 왕복 및 체크리스트 이어하기. 남은 확인: 실호스트 Node·프록시 뒤 기동 |
| R8 외부 연동 | 로컬 검증(자동 테스트) | 미검증 | PAT 발급·검증, 에이전트 자격증명 S1–S5 및 작업 게이트(tests/actions/ 120건). 남은 확인: 실호스트 주소로 외부 도구 연결 |
| R9 SMTP | 로컬 검증(자동 테스트) | 미검증 | 메일 발신명·환경설정 연결 및 초대 링크 호스트. 남은 확인: 실호스트 SMTP 서버로 실제 발송 |
| R10 기록 | 문서 기록 | 해당 없음 | runbook-selfhost.md, HANDOFF.md, docs/settings-catalog.md 기록. 이 표의 상태 낱말은 2026-10-09 에 "통과"에서 위 구분으로 고쳤다(근거가 로컬 검증뿐이라) |

마이그레이션은 먼저 격리 스택에서 검증한다. 기존 사용자 DB를 reset하지 않는다. 사용자 DB 적용 전에는 백업·적용 목록·롤백 범위 및 리허설 결과를 제시한다.
