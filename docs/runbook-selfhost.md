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

## 출시 수용 기록

| 항목 | 상태 | 근거·남은 확인 |
|---|---|---|
| R1 스키마 | 통과 | 격리 스택 0039까지 reset 및 RLS 916건 전수 통과. 메인 DB 0038/0039 적용 및 사후 검증 통과 |
| R2 Auth | 통과 | 세션 전환·워크스페이스 격리·HS256/쿠키 세션 검증 완료 (RLS 55개 파일 전수 초록) |
| R3 Storage | 통과 | 회의록 파일 업로드·첨부 정책·저장소 경로 검증 완료 (tests/domain/storage-path.test.ts 통과) |
| R4 Realtime | 통과 | WBS 및 사용자 필드 Realtime 통지·수신 검증 완료 (tests/domain/wbs-realtime.test.ts, RLS 통과) |
| R5 로컬 AI | 통과 | 색인 잡·도구 컨텍스트·임베딩 차원 일관성 검증 완료 (tests/actions/cron-ai-index.test.ts 통과) |
| R6 잡 | 통과 | AI 색인 잡 스코프(0038) 및 크론 잡 정상 실행 확인 (tests/actions/cron-ai-index.test.ts 통과) |
| R7 standalone | 통과 | standalone 빌드 및 포트 3183 단독 기동 성공, 서버 액션 왕복 및 체크리스트 이어하기 검증 완료 |
| R8 외부 연동 | 통과 | PAT 발급·검증, 에이전트 자격증명 S1–S5 및 작업 게이트 검증 완료 (tests/actions/ 120건 통과) |
| R9 SMTP | 통과 | 메일 발신명·환경설정 연결 및 초대 링크 호스트 검증 완료 |
| R10 기록 | 통과 | runbook-selfhost.md, HANDOFF.md, docs/settings-catalog.md 전 항목 기록 및 동기화 완료 |

마이그레이션은 먼저 격리 스택에서 검증한다. 기존 사용자 DB를 reset하지 않는다. 사용자 DB 적용 전에는 백업·적용 목록·롤백 범위 및 리허설 결과를 제시한다.
