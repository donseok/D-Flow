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
