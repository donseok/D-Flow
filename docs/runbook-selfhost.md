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
- 요청 제한은 둘이다: Auth 의 발송 제한(`rate_limit.email_sent`, 같은 주소 재요청 간격)과 앱의 요청 제한(같은 IP 의 요청 수 — 아래 '요청 제한').
- 로컬 개발은 SMTP 설정 없이도 링크가 보인다 — 로컬 Supabase 가 인증 메일을 자기 메일함(inbucket — `supabase status` 의 Mailpit/Inbucket 주소)으로 받는다.


### 비밀번호 재설정 뒤의 세션

재설정이 성공하면 그 사용자의 다른 로그인은 끊긴다. 길마다 수단이 다르다.

| 길 | 끊는 수단 | 남는 세션 |
|---|---|---|
| 메일 재설정(`/login/reset`) | 화면이 `signOut({ scope: 'others' })` 를 부른다 + Auth 가 비밀번호 변경 때 다른 세션을 지운다 | 방금 재설정한 브라우저 |
| 관리자 재설정(멤버·초대 화면) | Auth 의 관리자 비밀번호 변경이 그 사용자의 세션·갱신 토큰을 모두 지운다(앱의 별도 호출 없음 — 사용자 id 로 세션을 지우는 admin API 가 없다) | 없음 |
| 본인 변경(계정 화면) | Auth 가 비밀번호 변경 때 다른 세션을 지운다 | 바꾼 브라우저 |

- **한계 — 최대 `jwt_expiry` 동안은 통과한다.** 끊기는 것은 갱신 토큰이다. 이미 발급된 access token 은 앱이 서명만 로컬 검증(`getClaims()`·JWKS)하므로
  만료 전까지(기본 3600초) 다른 기기에서 계속 쓸 수 있고, 만료 뒤 갱신이 거절되면서 로그아웃된다. 이 창을 줄이려면 Auth 의 JWT 만료 시간을 줄인다
  (갱신 왕복이 그만큼 잦아진다). 즉시 차단이 필요한 사고라면 그 계정을 Auth 에서 잠그는(ban) 조치를 같이 한다 — 잠금도 access token 만료까지는 같은 한계다.
- 관리자 재설정의 세션 정리는 Auth 서버 버전에 기댄다. 배포 점검에서 한 번 확인한다: 대상 계정으로 다른 브라우저에 로그인 → 관리자가 재설정 →
  `jwt_expiry` 뒤(또는 그 브라우저의 쿠키에서 access token 을 지운 뒤) 새로고침하면 로그인 화면으로 가야 한다.
- 메일 재설정에서 다른 세션을 끊지 못하면 완료 화면이 "기존 로그인 세션을 끊지 못했습니다"를 보이고 브라우저 콘솔에 남는다. 비밀번호는 바뀐 상태다.


## 요청 제한

로그인 없이 닿는 길에는 앱이 IP 별 요청 제한을 건다(`src/lib/http/rateLimit.ts` — 한도는 그 파일의 `RATE_RULES` 한 곳).

| 대상 | 세는 것 | 한도 | 막혔을 때 |
|---|---|---|---|
| 초대 확인·수락(`/invite/<토큰>`) | 틀린 토큰(형식 아님·없는 초대) | 10회 / 10분 | 화면에 "요청이 너무 많습니다" |
| 회의록 공유 링크(`/share/minutes/<토큰>`) | 틀린 토큰(형식 아님·없거나 꺼진 공유) | 10회 / 10분 | 같은 안내(404 대신) |
| 재설정 메일 요청 | 모든 요청(성공·실패를 가르면 가입 여부가 드러난다) | 10회 / 10분 | 같은 안내 |
| 외부·에이전트 API(`/api/v1/**`) | 토큰 인증 실패(401) | 30회 / 10분 | `429` + `Retry-After`, `code: "rate_limited"` |

- 성공한 요청은 세지 않는다. 막힌 동안에는 맞는 토큰도 같이 거절된다(토큰을 확인하지 않는다 — 유효 여부를 드러내지 않으려고).
- **카운터는 프로세스 메모리다.** 인스턴스별이라 서버리스·다중 인스턴스에서는 한도가 (한도 × 인스턴스 수)까지 느슨해지고, 재시작·콜드 스타트로 사라진다.
  몰아치는 시도를 늦추는 장치이지 차단 장치가 아니다 — 엄격한 제한이 필요하면 앞단(WAF·프록시의 rate limit)에 건다.
- **IP 는 `X-Forwarded-For` 의 첫 값이다**(없으면 `X-Real-IP`). 앞단 프록시가 이 헤더를 **덮어써야** 한다. 받은 값 뒤에 덧붙이기만 하면
  (nginx 의 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) 첫 값은 클라이언트가 고르는 값이라 요청마다 바꿔 제한을 피한다.
  nginx 라면 `proxy_set_header X-Forwarded-For $remote_addr;` 로 둔다. Vercel 은 덮어쓴다.
- 같은 IP 를 쓰는 사무실(NAT)은 한 통을 나눠 쓴다. 회수된 토큰으로 계속 물어보는 에이전트가 있으면 같은 IP 의 다른 에이전트도 10분 동안 429 를
  받는다 — 서버 로그의 401 을 보고 그 에이전트의 토큰을 고친다.
- `RATE_LIMIT=off` 는 로컬 개발(`APP_ENV=development` 또는 `next dev`)과 단위 테스트에서만 듣는다. 배포된 서버에서는 꺼지지 않는다.

## 회의록 외부 업로드의 폴더 자동 정리

외부 업로드(`POST /api/v1/minutes`)가 요청의 `folder_path` 대로 회의록을 폴더에 넣을지는 **프로젝트 설정** `minutes.auto_file_by_path`
(프로젝트 설정 화면 '회의록' 범주, 기본 **켬**)가 정한다. 예전에는 배포 env `MINUTES_FOLDER_PATH_ENABLED=true` 일 때만 켜졌다.

우선순위(위가 이긴다):

1. 배포 env `MINUTES_FOLDER_PATH_ENABLED=false`(정확히 이 값) — 배포 전체에서 끈다. 운영자 차단 스위치로 한 단계만 남긴 호환 장치다.
2. 그 프로젝트의 설정 값(저장값이 없으면 기본 켬).
3. 프로젝트에 속하지 않은 회의록은 설정할 프로젝트가 없다 — 켬.

- env 를 비우거나 `true` 로 두면 "켬"이 아니라 "설정을 따른다"는 뜻이다. **env 를 지정하지 않고 쓰던 배포는 이 판부터 기본이 켬으로 바뀐다** —
  연동 프로그램이 이미 `folder_path` 를 보내고 있었다면 다음 업로드·재전송부터 그 경로로 회의록이 들어가고, 폴더에 넣지 않은 회의의 재전송(`[]`)은
  여기서 손으로 옮겨 둔 회의록을 팀 폴더로 되돌린다. 원하지 않으면 올리기 전에 env 를 `false` 로 두거나 그 프로젝트의 설정을 끈다.
- 끄면 `folder_path` 를 받지 않은 것처럼 다룬다(형식 검사도 하지 않는다). 이미 옮겨진 회의록은 되돌아가지 않는다.
- 일괄 재정리(`POST /api/v1/minutes/folder`)와 보관 상태 조회는 이 설정·env 와 무관하게 동작한다.
- 설정을 읽지 못하면 업로드는 500 으로 멈춘다(편철 여부를 추측하지 않는다). 저장값이 손상이면 편철하지 않는 쪽으로 동작하고 서버 로그에 남는다.
- 계약 문서: `docs/design/dflow-minutes-upload-api-spec.md` §4.8.

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

모든 응답에 `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`(카메라·마이크·위치 등 차단)가
붙고, 프레임 차단(`frame-ancestors 'none'`)은 언제나 강제된다(구성은 `src/lib/http/securityHeaders.ts`). `Strict-Transport-Security` 는 `APP_ENV=production` 일 때만 붙는다 —
TLS 를 앞단 프록시가 끝내는 구성에서도 브라우저가 https 로 받은 응답이면 적용된다. 앞단 프록시가 같은 이름의 헤더를 따로 붙이면 값이 겹치므로 한쪽에서만 붙인다.

### 콘텐츠 보안 정책(CSP)

정책은 경로에 따라 두 갈래다. 정책의 Supabase 출처는 빌드 때의 `NEXT_PUBLIC_SUPABASE_URL` 에서 나온다.

| 경로 | 누가 붙이나 | `script-src` |
|---|---|---|
| 로그인 뒤의 앱 화면(미들웨어가 도는 경로) | `src/middleware.ts` — 요청마다 nonce 를 새로 만든다 | `'self' 'nonce-…' 'strict-dynamic'`(해시 허용 없음 — 앱이 직접 넣는 인라인 스크립트가 없다) |
| `/login`·`/invite/**`·`/share/**`·`/api/**`·정적 자산(미들웨어 제외 경로) | `next.config.ts` 의 정적 헤더 | `'self' 'unsafe-inline'`(nonce 를 만들 코드가 돌지 않는다) |

나머지 지시어는 두 갈래가 같다: 스타일은 `'unsafe-inline'` 유지(인라인 style 속성), 그림은 자체·`data:`·`blob:`·Storage 와 **`https:` 전체**(마크다운 본문의 외부 그림),
연결은 자체와 Supabase(https·wss), 프레임은 자체·`blob:`·Storage.

**기본은 강제(enforce)다.** `CSP_MODE` 는 되돌리는 스위치다 — 정확히 `report` 일 때만 보고 전용이고, 값이 없거나 그 밖의 값(오타·대문자 포함)이면 강제한다
(모르는 값이 보호를 풀지 않게). 값은 **빌드 때 굳는다**: 바꾸면 다시 빌드하고 다시 띄운다. 런타임 env 만 바꿔서는 바뀌지 않는다.

| 모드 | 응답 헤더 | 동작 |
|---|---|---|
| 강제(기본 — 값 없음·`enforce`·그 밖의 값) | `Content-Security-Policy: <정책>` | 정책 밖의 스크립트·그림·연결을 막는다 |
| `CSP_MODE=report` | `Content-Security-Policy-Report-Only: <정책>` + `Content-Security-Policy: frame-ancestors 'none'` | 막지 않는다. 위반을 보고만 한다 |

**위반 보고 보는 법.** 브라우저가 `POST /api/csp-report`(무인증)로 보낸다. 저장하지 않고 서버 로그에 한 줄씩 남긴다 — 지시어와 차단된 주소(쿼리스트링 제거)뿐이다:

```bash
journalctl -u dflow --since '1 day ago' | grep -F '[csp] 위반 보고'      # 유닛 이름은 예시
# [csp] 위반 보고 directive=img-src blocked=https://example.com/a.png
```

같은 IP 의 보고는 10분에 120건까지만 받는다(넘으면 429 — 요청 제한과 같은 프록시 전제, 위 '요청 제한'). 브라우저 확장 프로그램이 끼워 넣는 스크립트도 보고로 온다
(`blocked=chrome-extension` 같은 줄 — 앱의 위반이 아니다). 브라우저 콘솔에도 같은 위반이 찍힌다(강제 모드는 `Refused to …`, 보고 모드는 `[Report Only]`).
정상 상태에서는 앱이 낸 줄이 0 이다 — 줄이 생기면 그 지시어·주소가 막히고 있다는 뜻이다(강제 모드에서는 실제로 화면의 그 부분이 동작하지 않는다).

**문제가 생겼을 때 되돌리기.** 강제 때문에 화면 일부가 동작하지 않으면(스크립트·그림·연결이 막힌다) `CSP_MODE=report` 로 **다시 빌드**해 띄운다.
정책은 그대로 보고만 하므로 위 로그로 무엇이 걸렸는지 본 뒤 정책(`src/lib/http/securityHeaders.ts`)을 고치고, `CSP_MODE` 를 지워 다시 빌드해 강제로 돌아온다.
데이터에는 영향이 없다. 프레임 차단은 되돌린 동안에도 강제된다.

**원격 호스팅 첫 배포 때 확인할 것**(자동 테스트가 잡지 못한다 — 어긋나면 화면이 조용히 깨진다):

1. 문서 응답의 CSP 헤더가 **하나**인지 — 로그인한 화면의 문서 응답(개발자 도구 네트워크 탭)에 `Content-Security-Policy` 가 한 줄만 있고 그 `script-src` 에 `'nonce-…'` 가 있다.
   두 줄이면(정적 헤더와 미들웨어 헤더가 함께 나간 것) 호스팅의 헤더 병합이 자체호스트와 다르다는 뜻이다 — 화면은 뜨지만(nonce 스크립트는 두 정책을 모두 통과한다) 기록해 둔다.
   `curl -sI https://<호스트>/login | grep -i content-security` 는 정적 경로의 정책(`'unsafe-inline'`)을 보인다.
2. nonce 가 **요청마다 바뀌는지** — 같은 화면을 두 번 새로 고쳐 헤더의 `'nonce-…'` 값이 다르고, 페이지 소스의 `<script nonce>` 가 그 값과 같다.
3. **HTML 을 캐시하는 프록시·CDN 이 없는지** — 캐시된 HTML 의 nonce 는 다음 응답의 헤더와 맞지 않아 화면이 뜨지 않는다. 문서 응답은 캐시하지 않게 둔다(정적 자산 `/_next/static/**` 만 캐시).
4. 서버 로그의 `[csp] 위반 보고` 가 (확장 프로그램 것을 빼고) 0 인지 — 아래 미확인 항목의 화면을 포함해 한 번 돈 뒤 본다.

**확인된 것 / 확인하지 못한 것**(2026-10-10, 개발 PC 에서 `CSP_MODE=enforce` 로 빌드한 서버 — 실호스트 아님):

| 항목 | 상태 | 내용 |
|---|---|---|
| 로컬 E2E | 확인됨 | 68단계 통과 |
| 화면 순회 | 확인됨 | 27개 화면 + 전역 검색·보고서 모달에서 콘솔 CSP 위반 0, 페이지 오류 0 |
| nonce 부착 | 확인됨 | 문서의 스크립트 96개 전부 nonce(nonce 없는 인라인 0) |
| 서버 위반 보고 | 확인됨 | `[csp]` 로그 0 |
| mermaid 다이어그램 | 확인됨 | 렌더 정상 |
| 본문의 외부 https 그림 | 확인됨 | 로드 정상 |
| 원격 호스팅의 헤더 병합 | **미확인** | 정적 헤더와 미들웨어 헤더가 한 줄로 합쳐지는지는 호스팅마다 다를 수 있다 — 위 1번 |
| 첨부 미리보기 iframe | **미확인** | Storage 서명 URL 을 싣는 iframe(`frame-src`) — 회의록 첨부를 열어 본다 |
| 옛 브라우저의 `'strict-dynamic'` | **미확인** | 지원하지 않는 브라우저는 `'self'` + nonce 로 내려간다(설계상 동작) — 실제 옛 브라우저에서 띄워 보지 않았다 |

정책을 바꾸면 이 표의 확인을 다시 한다. 앱이 직접 넣는 인라인 스크립트는 없다 — 라이트 전용 결정(2026-10-10)으로 테마 깜박임 방지 스크립트와 그 해시 허용을 지웠다
(위 표는 그 전에 확인한 것이다 — 스크립트·해시가 빠진 뒤의 순회는 **다시 확인할 것**). 인라인 스크립트를 새로 넣으면 엄격한 정책에서 조용히 막힌다.
화면은 모두 요청 때 그려져야 한다(루트 레이아웃의 `connection()`) — 빌드 때 굳은 HTML 에는 Next 가 nonce 를 붙이지 못한다.

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
