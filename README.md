# D-Flow

범용 프로젝트 관리 플랫폼(가칭) — 원본 리포의 [포크](docs/fork-policy.md). WBS·간트, 대시보드, 칸반,
이슈, 주간업무 시트(실시간 동시편집), 회의 달력·회의록(AI 어시스턴트 RAG 검색), 위키, 공지,
근태, 프로젝트 멤버 초대, 슈퍼유저/프로젝트 관리자/멤버 3단 권한, 외부 에이전트 연동 API,
한/영 i18n을 포함한다.

## 로컬 시작

원격 스테이징·운영·Vercel 프로젝트는 아직 없다 — 개발·검증은 전부 로컬에서 완결한다. Docker
런타임(Docker Desktop 또는 colima)과 Supabase CLI가 필요하다.

```bash
npm ci
npm run db:start                                   # 로컬 Supabase 기동(Docker)
npm run db:reset && npm run env:local && npm run dev:bootstrap
                                                     # 기준선+마이그레이션+seed 적용 → .env.local 생성 → 첫 슈퍼유저 생성
npm run dev                                         # http://localhost:3000
```

`dev:bootstrap` 은 이메일·비밀번호(8자 이상)·팀 코드를 프롬프트로 묻거나 `BOOTSTRAP_EMAIL`/
`BOOTSTRAP_PASSWORD`/`BOOTSTRAP_TEAM`(기본 `운영`) env 로 받는다 — 비밀번호는 파일에 남기지 않는다.
스키마를 바꿨거나 `db:reset`을 다시 돌렸으면 계정도 함께 지워지므로 `dev:bootstrap`을 다시 실행한다.

그 외 로컬 개발 규칙(브랜치·커밋·pre-push 훅 G1~G4 등)은 `CLAUDE.md`가 정본이다.

## 환경 변수

`.env.local.example`을 참고한다. `npm run env:local`이 `supabase status` 결과로 필수 3종
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)을
채운 `.env.local`을 생성한다.

- **`NEXT_PUBLIC_BRAND_NAME` / `NEXT_PUBLIC_BRAND_TAGLINE` / `NEXT_PUBLIC_BRAND_COPYRIGHT`**
  (`src/lib/branding.ts`) — 비우면 기본값(제품명 D-Flow)으로 동작한다. 빌드 시 클라이언트
  번들에 인라인되므로 비밀을 넣지 않는다.
- **`GEMINI_API_KEY`** — AI 어시스턴트(회의록·위키 RAG 챗봇)용 Google AI Studio 키. 없어도
  봇은 구조화 질의 기반 결정형 답변으로 자동 폴백해 동작한다. OpenAI 호환 엔드포인트로
  전환하는 `AI_PROVIDER=openai` 계열 변수도 `.env.local.example`에 예시가 있다.
- **`ASSISTANT_MIN_SIMILARITY`** — 의미검색 유사도 하한(0~1, 기본 0.35). 이보다 먼 결과는
  답변 근거에서 제외한다.
- **`INVITE_ALLOWED_DOMAINS`** — 프로젝트 초대를 허용할 이메일 도메인(쉼표·공백 구분,
  `*`는 전체 허용). **비우면 초대가 전부 거부된다** — 빈 값이 "제한 없음"이 아니다.
- **`SMTP_USER` / `SMTP_PASS` / `MAIL_FROM_NAME`** — 회의 안내 메일 발송(Gmail SMTP). 미설정이면
  발송 액션이 throw하지 않고 `{ ok: false }`를 반환한다(로컬 정상 동작).
- 회의록 업로드 외부 연동(`MINUTES_API_ENABLED`, `MINUTES_API_SECRET` 등)은
  `docs/design/dflow-minutes-upload-api-spec.md` 참고. 두 값이 모두 설정돼야 관련 라우트가
  열리고, 미설정이면 전 라우트가 404다.

## 자주 쓰는 명령

```bash
npm run dev            # 개발 서버
npm run build           # 프로덕션 빌드
npm run lint
npm run test             # Vitest 단위 테스트
npm run db:reset        # 기준선+마이그레이션+seed 재적용 — 스키마 변경 검증
npm run db:diff:baseline # 기준선(0001)까지만 재적용해 운영 카탈로그와 대조 → 나머지 마이그레이션 적용(뒤에 dev:bootstrap)
npm run db:stop          # 로컬 Supabase 정지
```

`db:reset`·`db:diff:baseline` 이 `GET /storage/v1/bucket` 502 로 끝나면 Kong 이 재시작된 storage·realtime
컨테이너의 옛 IP 를 붙든 것이다 — `docker restart supabase_kong_d-flow` 뒤 다시 돌린다
(`docs/baseline/sp0-e2e.md` 9절. CI 는 같은 경우 최대 3회 재시도한다).

## CI

`.github/workflows/ci.yml` — `main`·`staging`·`sp0/**`·`ui/**` push 와 모든 PR 에서 `lint` → `test` →
`build`(더미 env로 접속 없이)를 돌리는 `test` 잡과, 로컬 Supabase를 기준선(0001)까지만 `db reset` 해 운영 카탈로그·커밋된 `0000`과의
드리프트를 검사한 뒤 나머지 마이그레이션을 `migration up` 으로 적용하는 `db` 잡이 병렬로 돈다.

## 데이터베이스

`supabase/migrations/`의 `0000_baseline.sql`(포크 컷오프 시점 스키마) 뒤 번호순 마이그레이션(현재 0001·0002)을
적용한다. 새 마이그레이션에는 대응하는 `supabase/rollbacks/NNNN_*_rollback.sql`을
함께 만든다. 시드(`supabase/seed.sql`)는 의도적으로 비어 있다 — 팀·프로젝트는 앱에서 만든다.

## 프로젝트 구조

```
src/
  app/
    (app)/
      admin/             # 관리자 — 계정 생성/일괄생성/리셋, 팀 관리, LLM 설정
      agents/            # 외부 에이전트 허브(워크스페이스 단위)
      meetings/          # 전사 회의 달력(내 회의)
      minutes/           # 회의록 보관함 (AI 어시스턴트 RAG)
      portfolio/         # 프로젝트 포트폴리오 뷰
      projects/          # 프로젝트 목록/생성
      usage/             # 사용 현황(슈퍼유저 전용)
      p/[projectId]/
        agents/          # 프로젝트별 에이전트 오피스
        announcements/   # 공지사항
        attendance/      # 근태현황
        dashboard/       # 대시보드
        gantt/           # 간트
        issues/          # 이슈 트래커
        kanban/          # 칸반 보드
        meetings/        # 프로젝트별 회의
        members/         # 멤버 관리
        settings/        # 프로젝트 설정(멤버·공휴일·임포트)
        wbs/             # WBS 보드
        weekly/          # 주간업무 시트(실시간 동시편집)
        wiki/            # 위키
    actions/             # 서버 액션 (project, wbs, weekly, minutes, meetings, issues 등)
    api/
      v1/agent/          # 외부 에이전트 연동 API — docs/design/dflow-agent-work-api-spec.md
      v1/minutes/        # 회의록 업로드 API — docs/design/dflow-minutes-upload-api-spec.md
      chat/              # AI 어시스턴트 챗봇 API
      export/            # 엑셀/PPT 내보내기
      import/            # 엑셀 임포트
      wiki/              # 위키 색인/질의
    login/               # 로그인
  lib/
    ai/          # AI 어시스턴트·회의록 RAG (임베딩, 검색, LLM 프로바이더, 폴백)
    agent/       # 외부 에이전트 작업 오더 도메인 로직
    authz/       # 권한 가드(requireSuperuser 등)
    domain/      # 순수 도메인 로직 (진척·롤업·영업일·트리·authz 판정 등) — 테스트 대상
    data/        # DB 조회 + 도메인 조립
    excel/       # 엑셀 파싱/검증 — 순수, 테스트 대상
    issues/      # 이슈 도메인
    report/      # 주간보고 PPT/Excel 생성
    wiki/        # 위키 색인·검색
    i18n/        # 한/영 사전 + 서버 헬퍼
    prefs/       # 계정별 UI 설정 동기화
    supabase/    # 서버/브라우저 클라이언트
    branding.ts  # 제품 브랜드 단일 출처
    auth.ts      # 세션/멤버십 조회
  components/    # 화면별·공용 컴포넌트 (ui/ 가 공용 프리미티브)
supabase/
  migrations/    # 0000_baseline.sql(포크 컷오프 스키마), 0001_storage_realtime.sql
  rollbacks/     # 각 마이그레이션의 역방향 SQL
  seed.sql       # 의도적으로 비어 있음
tests/
  actions/ ai/ domain/ excel/ lib/ minutes/ report/ ui/   # Vitest 단위 테스트
```

## 포크 계보

이 리포는 원본 리포의 한 시점 사본이며 이후 독립 진화한다. 컷오프 좌표·금지 DB
ref·업스트림 보안 픽스 절차는 `docs/fork-policy.md` 참고.
