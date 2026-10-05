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
| R1 스키마 | 부분 통과 | 격리 스택 0037까지 reset 성공, 저장소/리허설 SQL diff 0, RLS 910건 통과. 기준선 드리프트 별도 확인 필요 |
| R2 Auth | 미검증 | 브라우저 로그인 및 HS256 폴백 지연 실측 필요 |
| R3 Storage | 미검증 | 회의록 파일 업로드·60초 서명·다운로드 왕복 필요 |
| R4 Realtime | 미검증 | 두 세션의 WBS·주간 private presence 확인 필요 |
| R5 로컬 AI | 미검증 | OpenAI 호환 로컬 모델과 768차원 임베딩 실행 필요 |
| R6 잡 | 미검증 | 등록 잡 각각 호출 및 보존기간 삭제 확인 필요 |
| R7 standalone | 부분 통과 | 빌드·단독 기동·인증 WBS/설정 화면·서버 액션 왕복 성공, 기본 양식 포함. after 콜백 3계열 확인은 남음 |
| R8 외부 연동 | 미검증 | minutes 자격증명 S1–S5·PAT agent/me 검증 필요 |
| R9 SMTP | 미검증 | 로컬 수신함과 초대 링크 호스트 확인 필요 |
| R10 기록 | 진행 중 | 이 문서에서 통과·실패·미검증을 구분 |

마이그레이션은 먼저 격리 스택에서 검증한다. 기존 사용자 DB를 reset하지 않는다. 사용자 DB 적용 전에는 백업·적용 목록·롤백 범위 및 리허설 결과를 제시한다.
