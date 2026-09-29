# SP3b — 워크스페이스 셸·IA·디자인 기반 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-09-29 |
| 상태 | **승인** — 2026-09-29. 초안(`.superpowers/sp3b/spec-draft.md`)에 비평 네 편(fidelity·feasibility·lanes·ui-risk — `.superpowers/sp3b/critique-*.md`, blocking 8 · important 36)을 반영하고 사전 승인 규칙(2026-09-27 사용자 지시, SP3a 스펙 §1.1 P-1)으로 승인했다. 반영 기록과 반영하지 않은 것은 `.superpowers/sp3b/spec-report.md`. §10 사용자 확인 항목은 권고 기본값으로 진행하고, 각 항목은 적힌 기한 전까지 바꿀 수 있다 |
| 상위 정본 | 개정 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` 의 §5 전체(5.0~5.12 — 디자인 시스템·IA 정본), §2.8.1(`portal.widgets`)·§2.8.2(`views.default`)·§2.8.5(개인 키)·§2.11 SP3b 행, §5.8.5(로컬 초안 키), §6.1-1·-3·-4·-5·-6, §6.2 SP3b 블록, §6.3 조건부 행, §6.4 R25, §6.5.4·§6.5.6·§6.5.9, §8.1 #5·#6·#7·#8·#9·#20·#21. 정본 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` 의 §3.2.5(메뉴 원천 표)·SP3 분할 문단·§8 #10·#16. 짝 스펙 SP3a `docs/superpowers/specs/2026-09-27-sp3a-settings-engine-design.md` 의 §1.2(D11·D19·D28·D30·D32·D39)·§2·§4.5·§5·§7.4·§10.1. SP3a Phase B 계획 `.superpowers/sp3a/plan-b-scratch/plan-b.md`(과제 7 `navFor`, 과제 11 페이지 관문 불변식, 과제 20 세션 라우트, 과제 23 `moduleSetFor`, 과제 27 성능, 판정 P12·P13·P14·P18·P20·P22·P28). 이 문서는 그 결정을 옮겨 적고 **이 리포에서 실제로 할 일**(파일 경로·순서·경계 동작·테스트)을 더한다. 상위 문서가 정확한 정의를 가진 곳(토큰 값·치수·문구)은 절만 가리킨다 |
| 선행 | G0-1~G0-7·G0-9 — SP3a 스펙 머리 표와 같다(충족)<br>G0-8 — 이 문서(SP3b 스펙)<br>SP3a Phase A — main `b4283c0`(태그 `sp3a-a-done`, 마이그레이션 `0000`~`0012`). `src/lib/nav/ids.ts`·`src/lib/settings/{accent,accentTokens,brandingPath,catalog-meta}.ts` 가 main 에 있다. `src/lib/nav/registry.ts`(`navFor`)·`moduleSetFor` 는 아직 main 에 없다(B 산출물)<br>UI-2a·UI-2b 이후의 선행은 §2.2 게이트 표 |
| 마이그레이션 | 1개 — D9(계정 범위 개인 설정의 새 표 `public.account_preferences`). 개발 중 파일명은 `supabase/migrations/0013_account_preferences.sql` + `supabase/rollbacks/0013_account_preferences_rollback.sql`(+ 리허설 seed `supabase/rehearsal/0013_account_preferences_seed.sql`). 번호는 개정 §6.3 조건부 행대로 **머지 순서**로 확정한다 — UI-2 창(D46 ③)에 들어가기 직전 main 의 마지막이 `0012` 면 그대로, 레인 A 가 `0013` 이상을 먼저 넣었으면 다음 빈 번호로 rename 하고 재리허설한다(§5.6). 레인 A 의 이월(CR-1 트리거 재생성·`people.email` 칼럼 권한 회수·CR-6 필수 키 unset 거부)은 담지 않는다 |
| 실측 근거 | 2026-09-29 읽기 전용 실측 5편 — `.superpowers/sp3b/survey-{canon,shell,routes,tokens,bounds}.md` — 과 비평 4편(`critique-{fidelity,feasibility,lanes,ui-risk}.md` — Next 15.5.19 소스·Tailwind 4.3.1 컴파일 실측 포함). 코드 줄 번호는 레인 B 워크트리 `/Users/jerry/D-Flow-wt/lane-b` 의 `b4283c0` 기준이다. 개정 문서의 줄 인용은 H1 이후 여러 곳이 밀렸으므로(§1.3 E1) 이 문서는 **심볼 이름**으로 적고 줄은 참고로만 단다. 이 문서의 `.superpowers/…` 경로는 모두 메인 체크아웃의 절대 경로 `/Users/jerry/D-Flow/.superpowers/…` 다 — 레인 B 워크트리 안의 `.superpowers/` 는 따로 무시되는 다른 폴더다(`.gitignore:56`) |

읽는 순서: 사용자는 §10 을 먼저 읽는다. 표기 — "개정 §N"·"정본 §N"·"SP3a §N" 은 세 상위 문서의 절, "실측 X §N" 은 `survey-X.md` 의 절, "비평 X" 는 `critique-X.md`, "★n" 은 개정 §5.12.3 체크리스트 n번, "①~⑪" 은 개정 §5.12.5 SP3b 행, "B·C·D" 는 SP3a Phase B·C·D, "UI-2" 는 UI-2a·UI-2b 둘을 함께 가리킨다(D45), "창 ①②③" 은 main 쓰기 창(D46)이다.

## 1. 전제와 결정

### 1.1 사용자 결정(SP3b 를 구속하는 것)

| # | 결정(출처) | SP3b 에서의 귀결 |
|---|---|---|
| U-6 | 디자인 결정 번복 — 브리지 폐기·다크 재노출·중립 코발트(개정 §1.2 결정 6, 대장 C9~C11) | 브리지(`isGlobalProjectBridge`)를 지우고 공용 화면을 워크스페이스 전체 범위로 그린다(UI-2). 다크를 새 토큰과 같은 브랜치에서 노출한다(UI-1). 크림·틸을 중립·코발트로 바꾼다(UI-1) |
| #21 | 2026-09-29 — 다크 토글 = **계정 팝오버 3단 선택(system·light·dark) + `/account`**. 전역 바 아이콘 토글은 되살리지 않는다(개정 §8.1 #21 닫힘) | UI-1 이 계정 팝오버에 '화면 테마' 라디오 그룹, `/account` 에 같은 선택을 둔다. 숨겨 둔 다크 버튼(`HeaderChrome` 의 `chrome-icon hidden` Sun/Moon)은 지운다 |
| L-2 | 2026-09-29 — 두 레인 병렬. SP3b 는 레인 B(워크트리 `/Users/jerry/D-Flow-wt/lane-b`)에서 SP3a 와 나란히 돈다. UI-0·UI-1 은 지금, UI-2 는 SP3a Phase B 체크포인트 뒤. 레인 B 는 두 번째 로컬 Supabase 스택(`project_id`·포트를 바꾼 로컬 사본, 필요한 컨테이너만)을 쓴다. 머신 8GB·colima 6GB 라 부하를 관리한다(`.superpowers/sp3a/progress.md:26`) | UI-2 의 **모든** 작업(배선 없는 새 파일 포함)은 B 체크포인트(main) 뒤 착수한다(D1). 결정보다 엄격한 게이트 — UI-2b 는 C 체크포인트 뒤, main 머지는 `sp3a-done` 직후 창 — 는 결정 해석이 아니라 알림이다(§10.1 #1). 스택 절차는 §2.5 |
| R-std | 2026-09-29 — 리뷰 강도 표준: 묶음마다 워크플로 리뷰 1회(관점별 + 반박 검증) → 수정 1회 → 범위 재리뷰 1회. 적대적 탐색은 보안·권한 게이트에만. 수정 라운드 최대 2, 남는 minor 는 이월. Phase 끝 최종 리뷰는 유지 | SP3b 의 "보안·권한 게이트" = 슬러그 판정과 `/w/<B>` 404, 옛 경로 스텁의 대상 해석(특히 `/minutes/[id]`), 현재 워크스페이스 쿠키 검증, 개인 설정 쓰기 경로(D9), `/admin/ui-states` 접근, 좌석표·포트폴리오의 워크스페이스 한정. 나머지 묶음은 적대적 탐색 없이 표준 리뷰 |
| 결정 3·5 | 집계·위험·완료 정책 고정, 국가 공휴일 오버레이 없음(개정 5-D13) | 설정 화면에 '지표·위험' 범주를 두지 않는다. `holiday-band` 는 프로젝트 `holidays` 행에만 쓴다 |
| SP2 U2 | 경로 이동·전환기를 SP3b 로 이관(SP2 스펙 §1.1) | §5 전체 |
| C1 | 결정은 사용자만 개정한다(개정 §1.3 C1) | 사용자 결정·사용자 판단 항목(개정 §8.1 '사용자')의 해석을 바꾸는 것은 §10 에 올린다. 개정의 설계 문언을 실측으로 고치는 것은 §1.3 정정 + §7 반영 지시로 남긴다(SP3a 관례) |
| P-1 | 2026-09-27 — 스펙 사전 승인. 사용자 확인 항목은 권고 기본값으로 진행·보고 | 머리 표 상태 행 |

### 1.2 컨트롤러 기본값

| # | 결정 | 이유 | 사용자가 달리 정하면 |
|---|---|---|---|
| D1 | **UI-2 의 모든 작업(배선 없는 새 파일 포함)은 B 체크포인트(main) 뒤 착수한다**(사용자 결정 L-2 문언). 그 안에서 UI-2a(경로·IA)는 B 뒤 바로 시작하고, UI-2b(셸)의 레이아웃 배선과 C 소유 파일 셋(`(app)/w/[slug]/layout.tsx`·`(app)/projects/page.tsx`·`components/ui/BrandMark.tsx`)을 만지는 커밋은 **C 체크포인트 뒤**다(D45). UI-2b 의 새 셸 컴포넌트(배선 없음)는 B 뒤 UI-2a 와 같은 기간에 만들어도 된다. main 머지는 둘 다 `sp3a-done` 직후 창 ③ 이다(D46) | 결정 문언을 에이전트가 좁혀 읽지 않는다(C1, 비평 fidelity B1). 워크스페이스 셸이 실릴 `(app)/w/[slug]/layout.tsx` 는 C 가 만든다 — main 에는 `(app)/w/` 가 없다(SP3a §2.2 C 행·§5.2). 셸을 `(app)/layout` 에서 먼저 빼면 옮긴 화면이 셸 없이 뜨고, 그 파일을 먼저 만들면 C 와 add/add 충돌이다. D2 를 판정할 스파이크 S-2·S-3·S-6·S-7 도 C 산출물이 있어야 잰다(실측 bounds §3.1 (가), 비평 lanes L-B1·feasibility F-I2). C 뒤·`sp3a-done` 뒤 게이트는 결정보다 엄격한 쪽이라 결정 해석이 아니다 | (가) 화면이 바뀌지 않는 준비 파일(§2.2 '준비' 목록 — main 에 있는 것만 import)을 UI-1 머지 뒤, B **전**에 먼저 만든다(§10.1 #1 의 대안 — 약 0.3주 당김) (나) 워크스페이스 셸을 SP3b 소유의 중첩 그룹 레이아웃 `(app)/w/[slug]/(shell)/layout.tsx` 에 두어 UI-2b 배선을 C 전에 시작한다(레이아웃 한 층 추가, C 의 `settings/**` 를 그룹 안으로 옮기는 rename 커밋, `UI_RE`·CLAUDE.md 에 한 줄, S-6 은 여전히 C 뒤) |
| D2 | **셸을 범위 레이아웃으로 내린다**(UI-2b). 사이드바·전역 바·모바일 드로어·브레드크럼·전환기는 `(app)/w/[slug]/layout.tsx`·`(app)/p/[projectId]/layout.tsx`·새 `(app)/(global)/layout.tsx`(`/account`·`/admin/llm-config`·`/admin/ui-states`)가 각자 서버에서 `navFor` 결과를 계산해 `AppShell` 에 넘긴다. `(app)/layout.tsx` 에는 공급자·`PrefsSync`·`UsageTracker`·스킵 링크·STAGING 배지(env 판독은 이 파일에 남기고 셸에 prop 으로 넘긴다 — C 의 `operational-env` 불변식의 owner)·`AssistantChat`(우측 레일, 범위가 바뀌어도 대화를 잃지 않게)만 남긴다. `(app)/loading.tsx` 는 지우고 범위 레이아웃 **아래**에 `loading.tsx` 와 **`error.tsx`** 를 둔다(세 범위 모두) — 페이지 오류가 범위 셸 안에 뜬다. 범위 레이아웃 **자신**의 오류(슬러그·소속 조회 `unavailable`)만 위로 올라가 `(app)/error.tsx`(셸 없는 화면 전체 오류로 고친다)가 받는다. 스파이크 S-3 이 확인한다(§5.1) | `(app)/layout` 은 자식 경로의 `[slug]`·`[projectId]` 를 모르고, 소프트 이동에서 다시 그려지지 않는다(실측 routes §5 마지막 행). 셸이 거기 있으면 메뉴의 모듈 판정을 클라이언트가 늦게 받아 "메뉴 표시와 서버 판정이 갈라지지 않는다"(개정 §5.3.5)가 과도기마다 깨진다. 범위 레이아웃은 파라미터가 바뀌면 다시 그려지고, 같은 요청의 페이지 관문과 `effectiveModules` 캐시를 나눠 쓴다. Next 의 경계는 `layout > error > loading > page` 순서라 범위마다 `error.tsx` 가 없으면 페이지 오류가 셸째 사라진다 — 지금은 셸이 `(app)/layout` 에 있어 오류 카드가 셸 안에 뜨므로 회귀다(비평 feasibility F-I4) | 셸을 `(app)/layout` 에 두고 `/api/shell` 이 이동마다 메뉴 모델을 돌려준다(초기 SSR 은 미들웨어가 넘긴 경로 헤더로). 프로젝트를 바꾼 직후 한 왕복 동안 앞 프로젝트의 모듈 집합이 보인다 |
| D3 | 현재 워크스페이스: URL 이 정본이다. 쿠키 `dflow-ws`(슬러그, `path=/`, `SameSite=Lax`, 1년, httpOnly 아님)는 **셸이 클라이언트에서** 쓴다(`/w/<slug>` 와 `/p/<pid>` 에 들어가면 그 워크스페이스로). 읽는 곳은 슬러그가 없는 화면 셋 — 루트 리졸버, `(global)` 레이아웃, 목록형 옛 경로 스텁 — 이고, 읽을 때 소속을 다시 확인한다(탈퇴·위조는 무시하고 `prefsWorkspace` 규칙 = 가장 먼저 가입한 소속). `src/middleware.ts` 는 고치지 않는다 | 서버 컴포넌트는 쿠키를 쓸 수 없다(Next 15, `src/middleware.ts:32-33` 주석). `/p/<pid>` 는 조회 없이는 워크스페이스를 모르는데 셸은 이미 안다. 쓰는 곳이 하나면 판정이 갈라지지 않는다. 쿠키는 보안 경계가 아니라 기본값 힌트다 | 미들웨어가 `/w/<slug>` 에서 쿠키를 쓴다(`/p/*` 는 여전히 클라이언트) |
| D4 | 워크스페이스 전환기의 목록과 "2개 이상" 판정은 **소속**(`workspace_members`, `Actor.workspaceRoles`)으로 한다. 플랫폼 관리자가 소속이 아닌 워크스페이스를 URL 로 열면 전환기 자리에 그 이름과 "플랫폼 관리자로 보는 중"을 보이고, 목록에는 넣지 않는다. 전체 워크스페이스 목록 화면은 SP9(개정 §5.3.2 첫 행 `/admin` 목록) | `my_workspace_ids()` 는 슈퍼유저에게 전 워크스페이스를 준다(`0003_org_core.sql:201-206`). 그대로 쓰면 플랫폼 관리자는 늘 전환기를 보고 부트스트랩 계정(플랫폼 관리자)이 E2E "워크스페이스 2개 계정만 전환기"에 걸린다(실측 routes §5·§9.1) | 플랫폼 관리자에게는 전 워크스페이스를 전환기 아래 구획('플랫폼 관리자 — 모든 워크스페이스')으로 보인다(§10 #4) |
| D5 | 옛 경로 스텁은 `page.tsx` 가 아니라 **`src/app/(legacy)/<옛 경로>/route.ts` 의 `GET`** 이다. 응답은 `NextResponse.redirect(url, 307)` + `Cache-Control: no-store`, 쿼리스트링과 하위 경로를 그대로 붙인다. 옛 9경로와 `/p/[projectId]/kanban` 이 대상이다. 스파이크 S-1(§5.1)이 프로덕션 빌드에서 로그인 쿠키로 GET 해 307 과 `Location`(`/login` 이 아닌 기대 대상)을 확인한다 | `(app)` 아래 페이지는 `(app)/loading.tsx` 경계 안에서 렌더돼 `notFound()` 가 이미 200 으로 나온다(`scripts/lib/e2e.mjs:405-408`). `redirect()` 도 같은 경계 안이라 200 + 클라이언트 이동이 될 공산이 크다(실측 routes §4.2). 라우트 핸들러는 레이아웃·로딩 밖이다. Phase B 의 매니페스트는 `src/app/api/**/route.ts` 만 센다 | 개정 문언대로 `page.tsx` 스텁(`gantt/page.tsx` 관례). 307 을 HTTP 층에서 보장하지 못하고 E2E 가 `Location` 을 보지 못한다 |
| D6 | `/minutes/[id]` 스텁은 **회의록 행의 워크스페이스**로 보낸다(세션 클라이언트로 읽히지 않으면 404 — 존재 은닉). 이 스텁은 **영구**다. 저장·외부로 나간 링크 — 색인 `ai_documents.href`, 봇 출처(`deep-links.ts` 의 `minuteHref`·`myMeetingHref`), 외부 업로드 API 응답 `url`, LLM 답변 본문 — 는 옛 형식을 계속 낸다. 화면 안 링크는 슬러그를 아는 곳에서 새 형식을 쓴다(§5.7) | 옛 형식이 DB·외부 클라이언트에 이미 남아 있다(`ai_documents.href` NOT NULL, `api/v1/minutes/route.ts:90,683` → `docs/design/dflow-minutes-upload-api-spec.md:366,373`). 쿠키로 보내면 다중 소속 사용자의 영구 링크가 404 가 된다(실측 routes §3.5·R2) | 외부 계약 v2.9 로 `url` 을 새 형식으로 바꾸고 재색인한다(외부 쪽 반영 필요) |
| D7 | 거부 폴백: 슬러그 워크스페이스의 비소속 = 404(레이아웃과 페이지 둘 다), 소속이지만 권한 없음 = `redirect('/w/<slug>')`, 슬러그가 없는 화면(`/admin/llm-config`·`not-found`·로그인 뒤·초대 합류 뒤) = `/`(리졸버). 지금의 `redirect('/projects')` 9곳과 `router.push('/projects')` 3곳이 모두 이 규칙으로 바뀐다 | `/projects` 가 스텁이 되면 거부가 두 번 이동한다(실측 shell §5 끝). 존재 은닉은 비소속에만 필요하다 | 권한 없음도 404 |
| D8 | `revalidatePath` 는 **파일 경로 패턴 + 종류**로 바꾼다. 패턴은 라우트 그룹을 포함한다 — 회의록 목록 `('/(app)/w/[slug]/minutes', 'page')`, 상세 `('/(app)/w/[slug]/minutes/[id]', 'page')`(전체 목록은 §5.7). 정적 불변식이 옛 전역 접두의 `revalidatePath` 0건과, 첫 인자가 `'/('` 로 시작하면 둘째 인자가 있고 그 경로에 `/page`·`/layout` 을 붙인 파일이 `src/app` 아래 실제로 있음을 본다(파일 대조) | Next 15.5.19 의 암묵 태그는 `routeModule.definition.page` — 라우트 그룹을 포함한 파일 경로(`/(app)/w/[slug]/minutes/page`) — 에서 파생한다. `'/w/[slug]/minutes'` 는 어떤 태그와도 맞지 않는다(`server/lib/implicit-tags.js`·`revalidate.js:61-73`). 이 앱의 페이지는 모두 동적이라 관측 효과는 "액션 응답 뒤 클라이언트 라우터 캐시 전체 무효화"뿐이다(`action-handler.js:100-112`) — 형식이 틀려도 동작 테스트는 통과한다. 그래서 동작 스파이크(초안 S-4)를 두지 않고 파일 대조로 막는다(비평 feasibility F-I1). 기존 `('/p/${…}', 'layout')` 약 33줄도 맞는 태그가 없지만 효과가 같아 SP3b 범위가 아니다(반영 지시 22) | 액션이 슬러그를 받아 구체 경로를 무효화한다(액션 시그니처 38곳 변경 — 관측 효과는 같다) |
| D9 | **계정 범위 개인 설정은 새 표 `public.account_preferences` 로 옮긴다**(개정 §8.1 #5 의 취지를 채택하고 저장 모양을 정정 — E32). 표: `user_id uuid primary key references auth.users(id) on delete cascade`, `prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object')`, `updated_at timestamptz not null default now()`. RLS 자기 행 정책 셋(select·insert·update, `user_id = auth.uid()`), 표 권한은 authenticated 에 `select, insert, update` 만(anon·delete 없음 — H2 규칙 2). 계정 키 = `theme`·`locale`·`sidebarCollapsed`·`dashSections`·`minutesView`·`minuteFontSize`·`minutesExplorerLayout`·`wbsHideDone`·`wbsOutline`·`wbsGanttScale`·`notif`. 워크스페이스 키 = `startPage`·`favoriteProjectIds`·`recentProjects`·`portalHiddenWidgets`·`notifRead`(`user_preferences`, 행 키 `(user_id, workspace_id)`). 개인 밀도 `density` 는 소비처(그리드)가 생기는 SPU2 가 계정 키로 더한다(E33). 마이그레이션은 UI-2a 브랜치 안의 **별도 커밋**(`migrations/`·`rollbacks/` 두 파일, G1)이고 리허설 seed 는 또 다른 커밋이다. 번호는 개정 §6.3 조건부 행대로 머지 순서로 정한다(머리 표·§5.6). 레인 A 의 이월은 흡수하지 않는다 — 레인 A 가 판정 P18 을 닫도록 알린다(판정은 레인 A, §2.4 알림 3) | UI-2a 가 `prefsWorkspaceId` 를 "현재 워크스페이스"로 바꾸는 순간 테마·언어·사이드바가 워크스페이스마다 갈린다(실측 tokens §3.2-2, bounds G-7). 원격 DB 가 없어 지금 옮기면 이행 비용이 0이다. 개정이 권고한 `profiles.ui_prefs` 는 `profiles_read`(`0003_org_core.sql:649-652` — 같은 워크스페이스 동료가 행 전체 SELECT)로 동료가 서로의 설정(`notif`·`dashSections`·테마)을 읽는다. 열 SELECT 를 회수하면 본인 세션 읽기와 `ui_prefs \|\| patch` 갱신도 막혀 읽기·쓰기를 security definer 함수로 옮겨야 한다. 지금의 개인 설정 표 `user_preferences` 가 자기 행만인 것(`0006:289-290`)과 같은 모양이 가장 싸다(비평 feasibility F-I7). 이월을 담으면 권한 RPC 소유(레인 A)와 리허설 책임이 섞인다(실측 bounds §6.2 M-1·M-2) | 마이그레이션 없이 계정 키는 "가장 먼저 가입한 워크스페이스" 행에서, 워크스페이스 키는 현재 워크스페이스 행에서 읽고 쓴다(§10.1 #2 — 첫 워크스페이스에서 탈퇴하면 계정 키가 초기화된다). 또는 개정 문언대로 `profiles.ui_prefs`(동료 노출을 막으려면 읽기·쓰기 모두 security definer 함수) |
| D10 | 테마: `ThemeProvider` 가 **선호**(`'system' \| 'light' \| 'dark' \| null`, null = 미설정)와 **해석값**(`'light' \| 'dark'`)을 따로 낸다. 미설정의 해석은 상수 하나(`src/lib/theme/policy.ts` 의 `THEME_UNSET_DEFAULT = 'light'`)가 정하고 no-flash 스크립트 문자열도 그 상수로 만든다. SP9 가 `'system'` 으로 바꾼다. 테마는 **백필하지 않는다** — 사용자가 고른 값만 저장한다. 계정 팝오버·`/account` 의 라디오는 **마운트 뒤에만** 선택 표시를 한다(첫 렌더는 선택 없음 + `aria-busy` — 선호는 클라이언트에만 있어 서버가 모른다. 테스트가 하이드레이션 경고 0 을 본다). 개정 §5.6 no-flash 행의 '값이 없을 때 `matchMedia`'는 `THEME_UNSET_DEFAULT` 가 `'system'` 이 되는 SP9 뒤에 참이다(E16) | 지금 `computePrefsSync` 는 서버에 없는 키를 로컬 값으로 채우고 `readLocal` 이 테마를 DOM 클래스에서 읽어, 고른 적 없는 사용자도 `theme:'light'` 가 저장된다(`src/lib/prefs/sync.ts`, `tests/lib/prefs-sync.test.ts:7-10`). 그러면 개정 §5.6 의 "선호가 없는 사용자는 COM-6 뒤 `system`"이 적용될 사용자가 없다(실측 tokens §3.2-1). `MarkdownView` 의 mermaid 는 해석값이 필요하다. env 플래그 비교는 불변식이 금지한다(개정 §5.7.3) | 백필을 유지하고 SP9 에서 저장값 `'light'` 를 일괄 `null` 로 되돌린다 |
| D11 | 원색 변수는 `--p-<이름>`(예 `--p-cobalt-600`)으로 `@theme` 밖 `:root` 에 둔다 | `--color-gray-*` 로 두면 Tailwind 기본 팔레트 변수를 unlayered 로 덮고, `ink-d*` 는 UI-6 `no-legacy-tokens` 의 `ink-*` 금지 정규식에 걸린다(실측 tokens §8.3-4) | 개정 표기 그대로 `--color-*` |
| D12 | 개정 §5.5.4 에 없는 토큰을 더한다: `today-fg`(L `#FFFFFF` · D `#111B35`), 상태 채움 전경 `success-fg`·`warning-fg`·`danger-fg`·`progress-fg`(L `#FFFFFF` · D `#111B35` = `cobalt-950`), `category-1..8-weak`(같은 hue, 라이트 L 0.96·C 0.03 · 다크 L 0.25·C 0.04 — 개정 §5.11.2 의 `soft` 규칙), `phasebar-fill`(L `#97A3B6` 계열 · D `#56627A` 계열 — 막대 위 대비 3.0 이상), `critical-weak`(`critical` 의 soft 규칙). 값은 UI-1 이 `accent.ts` 의 OKLCH 함수로 계산해 `globals.css` 에 적고 `contrast-tokens` 가 고정한다. 채움 배경 + `text-white` 인 줄(실측 약 31줄 — 실측 tokens §3.3)은 UI-1 이 `*-fg` 로 바꾼다 | 새 다크 채움색은 밝아서 흰 글자가 2.07~2.30:1 로 떨어진다. 개정은 `action-fg` 만 정의했다. `team-N-weak`·`phasebar-fill`·`critical-weak` 는 대응이 없다(실측 tokens §1.1·§8.3) | 상태 채움을 금지하고 weak 배경 + 본색 글자만 허용한다(호출부 31줄을 다른 모양으로 바꾼다) |
| D13 | 어두운 히어로는 **UI-1 에서 밝은 표면으로** 바꾼다. `hero-ink`·`hero-ink-muted`·`hero-line` 은 `fg`·`fg-secondary`·`border` 의 별칭이 되고 `.hero-card`·`.hero-glow` 는 평면 `surface` + `border` 가 된다. 값으로 안 되는 마크업(`bg-white/*`·`border-white/*`·어두운 배경 기준 hex)을 실측의 7곳 가운데 **C 소유 파일을 뺀 곳**에서 고친다(§4.4). `(app)/projects/page.tsx`·`BrandMark.tsx`(C)는 UI-1 이 고치지 않고 별칭으로만 밝힌다 — 마크업 정리는 UI-2b 의 이동 커밋이다(비평 lanes L-I3). 이름 삭제는 개정대로 UI-5 끝 | `.hero-card` 는 `--gradient-dark` 를 쓰므로 그라데이션만 지우면 `text-hero-ink`(`#f4efe7`)가 새 canvas 위 1.07:1 로 사라진다. 개정 §5.5.5 의 "어두운 hero 전제 마크업은 UI-1 에서 함께"가 가리키는 범위는 `projects/page.tsx` 두 줄보다 넓다(실측 tokens §5.2) | UI-1 은 `.hero-card` 를 단색 어두운 표면(`night-900`)으로 두고 UI-5 가 화면마다 걷는다 |
| D14 | 글자 크기는 **의미 유틸을 새로 둔다** — `text-title`(24/32·600)·`text-title-sm`(22/30)·`text-section`(16/24·600)·`text-body`(14/22)·`text-control`(14/20)·`text-meta`(12/18)·`text-kpi`(28/34·600)·`text-doc`(16/26). Tailwind 기본 `text-xs`·`text-sm` 의 행간은 바꾸지 않는다. UI-1 은 공용 클래스 넷(`.eyebrow`·`.chip`·`.badge`·`.lvl-badge`)과 공용 컴포넌트 다섯(`KpiCard`·`SectionCard`·`Modal` 머리·`InboxPanel`·`PageHero`)의 12px 미만·uppercase·넓은 자간만 고친다. 나머지 368건은 화면 소유 SP 가 그 화면을 만질 때 지운다(개정 §6.1-4 '옛 패턴으로 새 화면 금지' — E22, 반영 지시 18) | `text-xs`·`text-sm` 행간을 바꾸면 875건이 한꺼번에 바뀌어 표·간트 행이 넘친다. 목표 7단계 가운데 기본 유틸과 같은 것은 셋뿐이다(실측 tokens §6.2) | 기본 유틸 행간을 바꾸고 표·간트 회귀를 UI-1 에서 전부 본다 |
| D15 | 팀 색의 다크 공백: UI-1 이 `--color-team-N`·`--color-team-N-weak` 를 `category-N`·`category-N-weak` 의 **별칭**으로 바꾼다(두 테마). 팀 토큰 15줄의 삭제·`teamColor.ts` 이행은 SP4(`ui/sp4-teams`) | UI-1 이 다크를 노출하는 순간 팀 본색이 다크 표면 위 2.60~3.24:1 이다. `category-1..5` 라이트 값은 `team-1..5` 본색과 같다(실측 tokens §7) | 다크 팀 칩의 대비 미달을 SP4 까지 둔다 |
| D16 | `/admin/ui-states` 는 `requireSuperuser()` 를 부르지 않는다. `getActorForView()` + 새 술어 `canViewUiStates(actor)`(`src/lib/authz/uiStatesAccess.ts`, 플랫폼 관리자만)로 판정하고 거부는 `notFound()` 다. 페이지 관문 불변식(B `tests/invariants/module-page-gates.test.ts`)의 제외 목록에 사유 "플랫폼 진단 — 모듈 밖"으로 넣는다(B 와 UI-1 가운데 나중에 머지하는 쪽) | `tests/invariants/platform-guards.test.ts` 가 `requireSuperuser(` 호출 위치를 정확히 11곳(`EXPECTED`)으로 고정하고 CLAUDE.md 도 "플랫폼 11곳"이다. 기존 플랫폼 페이지 `/admin/llm-config` 가 같은 모양(`getActorForView` + `canManageLlmConfig`)이다 | `requireSuperuser()` 를 쓰고 `EXPECTED` 를 12곳으로, CLAUDE.md 를 같은 커밋에서 고친다 |
| D17 | 반응형 안전망 테스트(`tests/css/breakpoint-safety-net.test.ts`)는 고치지 않는다. 그 테스트가 보지 않는 display 캐스케이드 함정 넷을 새 테스트 `tests/css/display-cascade.test.ts` 가 막는다: ① 임의 브레이크포인트 display(`min-[…]:`·`max-[…]:`·`[@media…]:`)와 안전망 클래스(`(sm\|md\|lg\|xl\|2xl):<display>`)를 한 className 에 섞지 않는다 ② 안전망 클래스를 가진 className 표현식에서 display 토큰(`hidden`·`flex`·`grid`·`block`·`inline*`·`table`·`contents`)은 안전망 클래스와 **같은 정적 문자열 리터럴 안에만** 있다 — 조건부 문자열(`&&`·삼항·`cn()` 의 다른 인자·템플릿 보간)의 display 토큰은 실패. 기존 위반(`WikiSearchResults.tsx:169`)은 착수 때 허용 목록에 사유와 함께 넣고 UI-2b 에서 조건부 렌더로 고친다 ③ `brand-logo-light`·`brand-logo-dark` 를 가진 className 에 display 토큰이 없다 ④ 안전망 테스트의 `VARIANT` 에 없는 변형(`aria-[`·`empty`·`not-*`·`in-*`·`pointer-*`·`motion-*`·`*`·`**`·`invalid`·`required`·`placeholder-shown`·`inert`·`starting`·`forced-colors`·`contrast-more`)의 display 를 금지한다 | done_when 이 "파일 수정 없이 초록"이다. 조건부 `hidden` 은 1024 이상에서 unlayered 안전망 클래스(`.lg\:inline-flex`)가 레이어 안 `.hidden` 을 이겨 숨김이 무시된다 — 이미 `WikiSearchResults.tsx:169` 가 그렇다. 새 셸은 탐침 결과·배지 null·저장 바에 따른 숨김을 많이 부른다. 임의 규칙은 레이어 안이라 조용히 진다(실측 tokens §4.2-4, 비평 ui-risk I3) | 안전망 테스트 정규식을 넓히고 done_when 을 고친다 |
| D18 | `PageHero`·`ProjectPageShell` 은 UI-2 에서 **어댑터**가 된다. `PageHero` 는 지금처럼 `title` 만 그리되 모든 뷰포트에서 보이는 h1 이다(`PageHeader` 의 제목 부분). 지금 받고 버리는 props(eyebrow·badge·description·actions·aside·heroKpis)는 계속 버린다 — 표시가 새로 생기지 않는다. `ProjectPageShell` 은 `PageFrame` 의 어댑터다(`hero` → 머리, `pinned` → 고정 도구 줄, 새 prop `variant`). props 대조 이관(개정 §5.4.4)은 SP3b 가 소유한 화면(§6)과 대표 3화면만 하고, 나머지는 화면 소유 SP(UI-5) | `PageHero` 호출은 23건/21파일이고 18개 화면이 `ProjectPageShell` 을 쓴다(실측 shell §5). 한 브랜치에서 모두 옮기면 B 가 관문 줄을 넣은 페이지 22개와 전부 겹친다. 어댑터면 ④(h1 정확히 1개, 컴팩트 포함)와 스크롤 단일화를 페이지 수정 없이 얻는다. **예외 — `AgentFrame`**: `hero` 로 `PageHero` 가 아니라 `AgentHero`(28px h1 + 누적 막대 + 560px 열 타일 격자)를 넘기고, 컴팩트에서만 탭을 `pinned` 로 올린다(`src/components/agent-hub/AgentFrame.tsx:62-75`). 어댑터가 컴팩트 분기를 지우면 390·768·1280×720 에서 헤더가 넘치고 탭이 두 번 나온다. UI-2b 가 `AgentFrame` 을 고쳐 컴팩트에서는 `AgentHero` 대신 `PageHero title` 만 넘기고(타일·막대는 조건부 렌더) 탭은 `pinned` 한 곳에만 둔다(비평 feasibility F-I5) | 23건을 UI-2 에서 전부 `PageHeader` 로 옮긴다(+0.5주, B 관문 줄과 충돌 증가) |
| D19 | 스크롤: `main` 이 문서형 화면의 유일한 세로 스크롤이다. 세로 스크롤과 gutter 는 **유틸이 아니라 `.app-main` 클래스 본문**(`@layer components` — `overflow-y: auto; scrollbar-gutter: stable`)에 두고, `main` 에는 overflow·scrollbar 유틸을 달지 않는다. `main` 은 세로 flex 이고 `DegradedNotice` 는 그 첫 자식(`shrink-0`)이다. 채움형(`PageFrame variant="fill"`, 표지 `data-frame="fill"`)은 UI-2b 에서 **`/p/*/wbs` 하나**다 — 같은 층, `.app-main` 규칙 뒤의 `.app-main:has([data-frame="fill"]) { overflow: hidden; scrollbar-gutter: auto }` 가 `main` 을 닫고 프레임이 남은 높이를 쓴다. 주간 시트·근태·회의록 탐색기는 UI-2b 에서 문서형이다. 스크롤 주체가 셸 영역에서 `main` 으로 옮겨 가므로 페이지 안 `sticky top-0` 은 도구 줄 아래로 내린다(D54). 채움형으로 바꾸는 것은 그 화면을 소유한 SP(SP4·SP5)가 스크롤 계약 테스트의 닫힌 목록에 한 줄을 더하며 한다 | `/agents` 사고(`agents/page.tsx:15-16` "보기마다 스크롤바가 생겼다 사라지며 조작 줄이 밀린다")는 스크롤바 폭 변화가 원인이라 gutter 고정으로 문서형에서도 막힌다. `main` 에 `overflow-y-auto` 유틸이 있으면 utilities 층이 `@layer components` 의 채움 규칙을 이겨 `main` 이 계속 스크롤하고(`overflow-y` 는 다른 longhand), `scrollbar-gutter: stable` 은 `overflow: hidden` 에도 자리를 남긴다(비평 ui-risk I9·feasibility m13). `DegradedNotice` 가 h-full 페이지 위에 얹히면 바깥 스크롤이 생긴다(실측 shell §4) — flex 첫 자식이면 채움형은 남은 높이만 쓴다. 주간(`WeeklySheetView`)·근태(`AttendanceView`)는 세로 스크롤 주체가 없어(가로 `overflow-x-auto` 만) 채움형으로 바꾸면 그 화면 파일을 고쳐야 한다 — 화면 소유 SP 의 파일이다(개정 §6.1-4) | 넷(작업 계획·주간·근태·회의록 탐색기)을 UI-2b 에서 모두 채움형으로 바꾼다(SP4·SP5 화면 파일을 SP3b 가 먼저 고친다) |
| D20 | UI-2a 는 `/w/[slug]`(홈 v0)와 `/w/[slug]/my-work`(내 업무 v0)를 **빈 링크 없이** 낸다(E34). 홈 v0 = `PageHeader`('홈') + '지금 처리할 일'(`getMyWork` 첫 20행) + '진행 중인 프로젝트'(`getProjectRows`) + **'공지'**(`getWorkspaceAnnouncements` 5행 — D28 의 대체 표면). 내 업무 v0 = `getMyWork` 전체 목록(50행 쪽 나눔) + 종류 칩(작업·이슈·검토·회의). 포털 v1(요약 수치·위젯 레지스트리·`portal.widgets`·부분 실패 카드 시각)은 UI-3, 내 업무의 탭·인스펙터·알림 탭은 SPU2 | `ws.my_work` 는 `SHELL_NAV` 의 needs null 항목이라 늘 보이는데 화면은 SPU2 다. 루트 리졸버는 UI-2a 에서 `/w/<slug>` 로 보낸다(실측 bounds G-3·G-4). 티커를 지우는 UI-2b 와 포털 공지 위젯(UI-3) 사이에 main 의 워크스페이스 공지 표면이 비지 않게 홈 v0 가 공지를 싣는다(비평 fidelity m8). 사용자 눈확인 게이트(UI-3)가 사람 대기라 UI-2·UI-3 을 한 머지로 묶지 않는다 | '내 업무'를 SPU2 까지 내비에서 거른다(개정 §5.3.5 "숨김 설정 없음"과 부딪힌다) |
| D21 | `/w/[slug]/usage` 는 SP8 전까지 **플랫폼 전체 수치**를 보이고 머리에 범위 칩 '플랫폼 전체(워크스페이스 구분은 SP8)'를 단다. `/w/[slug]/portfolio` 는 로더에 워크스페이스 인자를 더해 그 워크스페이스로 한정하고, `/w/[slug]/agents` 의 좌석표도 그 워크스페이스의 프로젝트로 한정한다(`canViewAgents` 의 워크스페이스 밖 명단 문제 — SP2 스펙 `:50`) | `usage_events` 에 `workspace_id` 가 없다(SP8). 노출 판정은 현행 그대로(`canViewUsage` = 플랫폼 관리자)라 보는 사람은 플랫폼 관리자뿐이다. 포트폴리오·좌석표는 지금 전 워크스페이스를 읽는다(`getPortfolioInputs()` 무인자, `seatmapProjectIds` 슈퍼유저 = null)(실측 routes §5) | 사용 현황을 SP8 까지 '플랫폼 운영' 그룹으로 옮긴다(B `NAV_GROUP_OF` 수정) |
| D22 | `/w/[slug]/admin/accounts`·`/w/[slug]/admin/teams` 는 **슬러그 워크스페이스의 관리자**(플랫폼 관리자 포함)가 연다. 플랫폼 전용 조작(`resetPassword`·`setPlatformAdmin`)은 이 화면 안에서 플랫폼 관리자에게만 렌더한다(개정 §5.3.2). 판정은 기존 워크스페이스 관리자 술어를 `*Access.ts` 로 감싼 것이고 액션 가드(`requireWorkspaceAdmin`)는 그대로다 | 두 화면의 로더 액션은 이미 `requireWorkspaceAdmin(wid)` 이다. 페이지만 슈퍼유저 전용이라 `ws.members`·`ws.teams`(needs `isWorkspaceAdmin`)의 메뉴와 어긋난다. SP3a §10 이 "페이지 게이트 정리"를 SP3b 로 넘겼다 | 두 화면을 플랫폼 관리자 전용으로 두고 `navFor` 소비에서 caps 를 좁힌다 |
| D23 | accent 는 범위 레이아웃이 유효한 저장 세트(`branding.accent.{light,dark}`)만 `<style>` 한 블록으로 `:root`·`.dark` 의 여섯 변수(`action`·`action-fg`·`action-hover`·`action-pressed`·`action-soft`·`border-focus` = `AccentSet` 의 `bg·fg·hover·pressed·soft·focus`)에 덮는다. **두 세트의 열두 값이 모두** `^#[0-9a-f]{6}$` 일 때만 `:root{…}` 를 먼저, `.dark{…}` 를 뒤에 내고, 하나라도 아니면 빈 문자열(제품 기본 코발트)을 낸다. 손상된 값은 로그를 남긴다(SP3a D39). UI-1 은 `/admin/ui-states` 의 미리보기 컨테이너(`data-theme-scope`, §4.6)에만 적용한다 | 저장 세트의 여섯 키와 `action` 계열 여섯이 1:1 이다(실측 tokens §8.3-6). 워크스페이스를 아는 곳은 UI-2b 의 범위 레이아웃이다. 주입 `<style>` 과 `globals.css` 의 `.dark` 는 둘 다 unlayered·같은 특이성이라 문서 순서로 갈린다 — 라이트 세트만 내면 다크에서도 라이트 accent 가 `.dark` 값을 덮어 대비가 무너진다(비평 ui-risk m2) | 컴포넌트 층 변수(`--button-primary-bg` 등)만 덮는다 |
| D24 | 로고의 라이트·다크 전환은 조건부 렌더가 아니라 `globals.css` 의 전용 클래스 둘(`.brand-logo-light`·`.brand-logo-dark`, `.dark` 아래 규칙으로 서로 숨김)이다. `dark:` display 유틸은 쓰지 않고, 두 클래스를 단 요소에는 display 유틸(반응형 포함)을 달지 않는다 — 크기별 전환은 바깥 래퍼에서 한다(`display-cascade` ③). utilities 층과 unlayered 안전망 클래스가 `@layer components` 의 숨김 규칙을 이기기 때문이다(비평 ui-risk I3(b)·feasibility m14) | 안전망 테스트 ⑥이 `dark:` 뒤 display 를 금지한다. 해석 테마로 조건부 렌더하면 첫 그림에서 깜빡인다(실측 tokens §4.2-2) | 해석 테마로 조건부 렌더 |
| D25 | `portal.widgets`(workspace, 소유 모듈 core `settings`)·`views.default`(project, 소유 모듈 `wbs`)는 **`sp3a-done` 뒤 UI-3** 이 등록한다. 편집기는 워크스페이스 설정 '메뉴' 범주의 '홈 위젯' 구역(`PortalWidgetsEditor`)과 프로젝트 설정 '모듈·메뉴' 범주의 '작업 계획 기본 보기' 구역(`ViewsDefaultEditor`)이다 | SP3a done_when 이 "14키만 등록"이다(SP3a §8, `tests/settings/registry.test.ts:21`). 네 연결(개정 §6.1-3)의 편집 UI 가 C 의 설정 화면 안이다(실측 bounds §3.3) | 편집기를 따로 두지 않고 서버 액션으로만 바꾼다(네 연결 미충족 — 개정 규칙 위반) |
| D26 | "세션 유일 워크스페이스" 판정을 워크스페이스 인자로 바꾼다: `/w/[slug]/**` 페이지의 관문은 `requireModulePage({ workspaceId }, id)`, 그 화면이 부르는 액션(`fetchMyMeetings`·회의록 목록·폴더 넷·`refreshSeatmap`·`createMinute`)과 세션 라우트(프로젝트 없는 챗·`/api/track`)는 워크스페이스를 인자로 받고 소속을 검증한다. 액션은 UI-2a, 세션 라우트는 UI-2b 다 — 요청을 보내는 `AssistantChat`·`UsageTracker` 가 범위(`ShellScope`)를 알게 된 뒤라야 `workspaceId` 를 실을 수 있고, 그 전에 바꾸면 프로젝트 없는 챗이 400 이 된다. `api/v1/*` 는 SP7 | Phase B 는 전역 경로를 `requireSessionModule(null, …)`·`requireModulePage(null, …)`·`aiAvailable(null)` 로 판정한다(판정 P13·P28). 이름이 달라 done_when 의 `resolveSoleWorkspaceId` grep 에 걸리지 않지만 같은 판정이다(실측 shell §6, bounds §3.2). 다중 소속 사용자가 SP3a 뒤 닫히는 화면(SP3a R15)을 여기서 연다 | grep 대상을 `resolveSoleWorkspaceId` 하나로 둔다(R15 가 실제로 닫혔는지 기계로 보지 못한다) |
| D27 | 메뉴 키 파생: `usageMenu.resolveMenuKey`·`PROJECT_SEGMENT_KEYS`·봇 `inferDomain`·`DOMAIN_PATH` 를 레지스트리의 `segment` 에서 파생한다. `/w/<slug>/<seg>` 와 옛 `/<seg>` 는 같은 키다. 새 키는 `ws-home`·`my-work` 둘이다. 봇 페이지 문맥(`PageContextV1`)에 `workspaceId` 를 더한다 | 안 고치면 모든 워크스페이스 화면이 `unknown` 으로 조용히 집계된다(실측 routes §3.4). `inferDomain` 은 지금 `issues` 를 몰라 `/p/x/issues` 가 `unknown` 이다(기존 결함). SP3a §10 이 정본 §3.2.5 의 5·6·9행을 SP3b 로 넘겼다 | 경로 표를 손으로 늘린다 |
| D28 | 공지 티커는 UI-2b 에서 전역 바에서 뺀다. 워크스페이스 공지는 홈 v0 의 '공지' 섹션(UI-2a, D20)과 포털 공지 위젯(UI-3)이, 프로젝트 공지는 개요의 공지 띠(H1 과제 9 의 `AnnouncementStrip`)와 알림 배지가 맡는다. UI-2a·UI-2b 는 같은 창(③)에서 차례로 머지하므로 main 에 공지 표면이 없는 순간이 없다 | 전역 바 가운데는 찾기 상자 자리다(개정 §5.4.3). 개정 §8.1 #7 권고 기본값이고 UI-3 게이트에서 사용자가 확인한다. 개정 §5.4.3 은 "빼고 … 공지 띠가 맡는다"(동시 대체)다 | 티커를 포털 머리 아래로 옮긴다(§10.1 #7) |
| D29 | 눈확인 주체: **UI-1·UI-2b·UI-3 은 사용자가 본다**(개정 §6.5.9·R21 — 사람 게이트). 에이전트가 먼저 D48 의 방법으로 그 행렬을 전부 찍어 대조표(`/Users/jerry/D-Flow/.superpowers/qa/sp3b/<단계>-sheet.html`, 리포 밖)와 `docs/baseline/sp3b-ui.md` 를 준비하고, 사용자는 main push 확인 자리(어차피 사람 확인이다)에서 대조표를 훑고 레인 B 서버(`http://127.0.0.1:3201`, 새 브라우저 프로필 — §2.5)에서 표본(단계마다 여섯 안팎)을 조작해 본다. UI-0(기준선)과 UI-2a(옛 셸 + 새 경로)는 에이전트만 본다. UI-2a·UI-2b 는 같은 창에서 머지하므로 사용자 확인은 UI-2b push 때 두 단계를 함께 본다 | UI-1(`globals.css` 토큰 전면 교체·다크 노출)과 UI-2b(셸 전면 교체)는 2026-07-27 사고와 같은 파일군이고, SP3a §9 #10 의 에이전트 눈확인 승인은 SP3a 화면(설정 편집기)에 한정됐다(비평 fidelity I6). 대조표 + 표본으로 사람 부담을 줄인다(비평 ui-risk m7) | SP3a §9 #10 처럼 UI-0·UI-1·UI-2 는 에이전트만, UI-3 만 사용자(§10.1 #3) |
| D30 | 기존 라벨 문구는 UI-2b 가 바꾼다: `nav.dashboard` '개요', `nav.wbsGantt` '작업 계획', `nav.myMeetings` '회의 일정', `nav.meetings` '회의', `nav.agents` '에이전트 현황', `nav.projectAgents` '에이전트', `nav.issues` '이슈', `nav.weekly` '주간보고', `nav.members` '팀 구성', `nav.myWork` '내 업무', `nav.wsMembers` '멤버·초대', `nav.wsTeams` '공용 팀', `nav.llm` 'LLM 설정', `nav.uiStates` '컴포넌트 상태 점검'. 키는 바꾸지 않는다(B `registry.ts` 무수정) | B 과제 7 이 새 키 다섯을 넣고 "기존 라벨 문구는 SP3b UI-2 가 바꾼다"로 넘겼다. 개정 §5.3.3·§5.3.4 의 IA 라벨과 지금 문구가 다르다(실측 shell §3.1 #11) | 레지스트리의 `labelKey` 를 새 키로 바꾼다(B 파일 수정) |
| D31 | 슬래시가 든 `segment`(`p.agents` = `agents/office`)의 활성 판정은 첫 조각(`agents`)의 접두 일치다. 아이콘은 레지스트리의 lucide 이름이 정본이고 `src/components/app/navIcons.ts` 가 이름 → 컴포넌트 표를 갖는다(지금 사이드바와 다른 2개 — `minutes` `FileText`, `ws.meetings` `CalendarClock` — 는 레지스트리를 따른다) | B 과제 7 주석이 "활성 판정은 소비처가 첫 조각으로 파생"을 넘겼다. 레지스트리 주석과 실제 사이드바 아이콘이 둘 어긋난다(실측 shell §3.3) | 레지스트리 아이콘 이름을 사이드바에 맞춘다(B 파일 수정) |
| D32 | 성능(R25): 판정 기준은 **SP2 기준선(`h2-done`) 대비 +20%** 다(개정 §6.4 R25 문언 — `docs/baseline/sp2-perf.md` 와 같은 경로·페르소나). UI-2b 체크포인트에서 레인 B 스택으로 ① `h2-done` ② `sp3a-done` ③ `ui/sp3-menu` 를 차례로 재서 ②→③ 증가분도 적는다(원인 분리). 러너는 `ui/sp3-menu` 머리의 `scripts/perf-baseline.mjs` **하나**다(B 과제 27 의 "두 쪽 모두 고친 러너" 관례). 사용자 조회 DSN 을 `LOCAL_DB_URL` 우선으로 하는 한 줄은 B 과제 27 이 같은 파일을 고치므로 레인 A 에 넣어 달라고 요청하고(알림 11), 넣지 않으면 SP3b 가 B 뒤 한 줄을 고친다. UI-0 은 새 `scripts/perf-grid.mjs`(1만 행 합성 WBS, 헤드리스)로 기준선만 잰다 | SP3a(+20% 허용) 위에 SP3b(+20%)가 쌓이면 SP2 대비 최대 +44% 까지 통과한다 — R25 가 SP2 를 적은 것은 누적을 막는 뜻이다(비평 fidelity I1). `perf-baseline.mjs` 는 사용자 조회를 상수 `LOCAL_DSN`(54322 — 레인 A DB)에 붙여, 수정 전 러너로 재면 두 DB 가 섞인다(실측 bounds §8, 비평 lanes L-I8) | SP3a 가 이미 +20% 가까이 썼으면 §10 에 "R25 누적 한도 재조정"을 올린다(판단: 사용자). 또는 레인 A 가 쉬는 시간에 레인 A 스택으로 잰다 |
| D33 | 전역 바 AI 진입: 1024 이상에서는 FAB 를 없애고 전역 바 아이콘 버튼으로 우측 레일을 연다. 아이콘도 챗 위젯 탐침(B 판정 P12)이 404 면 그리지 않는다. 1024 미만은 FAB 를 유지하되 저장 바·가상 키보드가 보이는 동안 숨긴다(개정 §5.4.3) | `AssistantChat.tsx` 는 B 소유이고 탐침을 더한다. 아이콘과 FAB 가 같은 탐침 결과를 봐야 모듈을 끈 워크스페이스에 진입점이 남지 않는다 | FAB 를 모든 크기에 유지 |
| D34 | `/api/shell` 계약: 파라미터는 `?ws=<wid>&project=<pid>`(브리지 의미의 `menu` 폐기), 응답은 프로젝트 배지(공지 안읽음·결재 대기)와 워크스페이스 배지('내 업무' 검토 대기 합계)다. 한 왕복을 유지한다. 배지 조회 실패는 `0` 이 아니라 `null`(배지를 그리지 않고 로그)이다 | 지금 `getUnreadAnnouncementCount(menu).catch(() => 0)` 이 실패를 0 으로 삼킨다(`api/shell/route.ts:27`, 에러 처리 원칙 ①). 브리지를 지우면 `menu` 는 뜻이 없다. 개정 §5.3.3 이 공용 화면 배지를 '내 업무' 합계로 옮겼다 | 배지 실패를 0 으로 둔다 |
| D35 | 새 셸 컴포넌트는 `src/components/app/` 에 둔다(G2 가 잡는다). 상태·입력 컴포넌트(`Button`·`IconButton`·`Field`·`StatusMessage`)는 `src/components/ui/` 에 둔다(UI 위험 파일 밖 — 트레일러는 관례로 단다) | 개정 §5.12.2. `StatusMessage` 는 개정 SP3b 블록 소유 파일 목록의 경로다 | — |
| D36 | **칸반의 처분은 UI-3 이다**(보기 전환과 한 과제 — 비평 feasibility F-B1). UI-3 이 작업 계획 안에서 보드를 그리는 커밋(`ViewSwitch`·`KanbanBoard` 의 `group` 쿼리·`WbsRealtimeRefresh` 이관), `kanban/page.tsx`·`kanban/loading.tsx` 삭제, `(legacy)/p/[projectId]/kanban/route.ts` 스텁, 진입점(`ProjectNav` 는 `kanban.nav = null` 이라 항목 없음, `InboxPanel.tsx:84`·`verifier.ts:31`·`deep-links.kanbanHref`)의 새 형식, `tests/ui/kanban-realtime.test.ts` 의 대상 변경을 한 과제로 한다. UI-2 는 `kanban/page.tsx` 를 그대로 둔다(B 관문 줄 포함). 스텁은 칸반의 `view` 를 `group` 으로 옮긴다: `?view=phase\|owner\|progress\|status` → `/p/<id>/wbs?view=board&group=<값>`, 나머지 쿼리(`team` 등)는 그대로. `KanbanBoard` 는 묶음 기준을 `group` 에서 읽고, `view` 는 WBS 보기 값(`sheet\|timeline\|board`)만 뜻한다. `kanbanHref` 는 `/p/<id>/wbs?view=board&group=&team=` 을 낸다 | 지금 `wbs/page.tsx:85` 는 `?view=board` 를 표로 그리고 보드는 `kanban/page.tsx` 만 그린다. UI-2 가 칸반 페이지를 지우면 UI-2 머지 ~ UI-3 머지(사람 게이트 뒤) 사이 main 에서 보드에 들어갈 길이 없다 — "체크포인트 = main 배포 가능"을 깬다. 칸반의 `view` 는 보기 전환이 아니라 묶음 기준이라(`KanbanBoard.tsx` 의 `searchParams.get('view')`) 개정 §5.3.2 "기존 쿼리 보존"을 문자 그대로 하면 `wbs?view=board&view=phase` 가 된다(§1.3 E27) | UI-2 가 `wbs/page.tsx` 에 `view=board` 최소 렌더(`KanbanBoard` 그대로)를 먼저 넣고 `ViewSwitch` 모양만 UI-3. 또는 묶음 기준 딥링크를 버린다(봇 출처가 칸반 묶음을 잃는다) |
| D37 | 명단의 실효 역할(P7-6.3)은 `roleIn` 의 ⑤⑥ 단계를 순수 함수 `inheritedProjectRole(wsRole, accessRole)` 로 뽑아 `roleIn` 과 명단 화면이 **같은 함수**를 부르게 한다(`roleIn` 시그니처는 `tests/authz/guard-signatures.test.ts` 대로 불변). 행의 워크스페이스 역할은 세션 클라이언트로 `workspace_members`(RLS `is_ws_member`)를 한 번 읽는다. 조회 실패는 열 전체를 '확인 불가'로 그린다(명단 역할로 위장하지 않는다). 계정 없는 외부 인력은 명단 역할 그대로다. 플랫폼 관리자 행은 따로 표시하지 않는다 | 판정은 `domain/authz.ts`·`lib/authz/**` 두 곳에서만 한다(CLAUDE.md). 다른 사람의 `Actor` 는 만들 수 없으므로 `roleIn` 을 직접 부를 수 없다 — 단계 함수를 공유해야 두 판정이 갈라지지 않는다. `platform_admins` 는 세션으로 읽히지 않고, 개정 done_when 도 워크스페이스 관리자 상속만 요구한다 | 명단 화면 전용 판정 함수를 따로 둔다(두 판정이 어긋날 수 있다) |
| D38 | 범위는 두 길로 흐른다. ① **동기 컨텍스트** — 범위 레이아웃이 `ScopeContext.Provider value={{ workspace: { id, slug, name }, projectId }}` 로 자기 자식을 감싼다. 화면 안 링크·`wsHref` 를 쓰는 클라이언트 컴포넌트는 `useScope()` 만 읽는다(SSR 에도 값이 있다). ② **게시 저장소** — 범위 레이아웃이 그리는 클라이언트 컴포넌트 `ShellScope` 가 효과로 `{ workspace, projectId, projects: { id, name }[] }` 를 `(app)/layout` 의 `ShellScopeProvider` 저장소에 게시한다. 이것은 범위 레이아웃 **위**의 소비처(`AssistantChat`·`ShellStateProvider`·`BotPageContextProvider`)만 읽고, 첫 게시 전 값 `null` 을 '범위 없음'(프로젝트 목록·배지 없음)으로 그린다. 프로젝트 레이아웃은 1차 병렬에 `workspaceRefById(wid)`(세션 클라이언트 `workspaces.select('id, slug, name').eq('id', wid)`, React `cache`)를 더해 슬러그·이름을 얻는다. 서버 컴포넌트는 `/w` 에서 `loadWorkspaceScope`, `/p` 에서 같은 `workspaceRefById` 를 쓴다 | D2 로 셸은 범위 레이아웃에 있지만 AI 레일(대화 보존)·알림 실시간 구독(1왕복 유지, R25)·봇 문맥은 범위가 바뀌어도 살아 있어야 한다. 자식 레이아웃의 값은 부모로 흐르지 않으므로 게시 저장소가 필요하다. 그러나 효과는 SSR·첫 렌더 뒤에 돌아, 화면 안 링크(`WikiShared`·`minuteSourceHref` 소비처·`MeetingDetailModal`·`OfficeNav`·`MinuteViewer`·`AccountsManager`)가 저장소를 읽으면 SSR HTML 에 링크가 없거나 틀린다(비평 feasibility F-I3). `actor.projectWorkspace` 는 id 만 알고, 소속이 아닌 워크스페이스의 프로젝트를 보는 플랫폼 관리자는 `listMyWorkspaces()` 에도 없다 | 세 공급자를 범위 레이아웃 안에 두고 범위가 바뀔 때 다시 마운트한다(챗 대화·알림 구독이 끊긴다) |
| D39 | 여러 프로젝트에 걸친 읽기(포털·내 업무·'내 업무' 배지)의 모듈 판정은 새 파일 `src/lib/modules/effectiveMany.ts` 의 `effectiveModulesMany(workspaceId, projectIds)` 하나로 한다 — 워크스페이스 설정 1회 + 프로젝트 설정 `in()` 1회. 결과는 프로젝트마다 `effectiveModules` 를 부른 값과 같아야 한다(동치 테스트 — 기준은 **B 뒤의** `effectiveModules` 이고, 프로젝트의 워크스페이스가 인자와 다르면 던지는 CR-5 의미(`6892183`)를 픽스처 하나로 둔다). 읽기 실패는 그 원천의 부분 실패다. 파일은 B 뒤 main 에서 만든다(`@/lib/nav/registry`·CR-5 가 B 산출물 — 비평 lanes L-I1). 로더는 '로더당 1왕복'이 아니라 '로더당 상수 왕복(최대 3, 프로젝트 수와 무관)'이다(E35) | 프로젝트마다 `effectiveModules` 를 부르면 N+1 이다(개정 §5.9.1 "로더당 1왕복"). A·B 파일(`effective.ts`·`gate.ts`)을 고치지 않으려고 새 파일로 둔다 | `effective.ts`(A)에 함수를 더한다(레인 A 파일 이어 고치기) |
| D40 | '내 업무' 배지와 포털 `approval` 원천은 "내가 승인할 수 있는 보고됨 주문"이다. 세션 클라이언트로 그 워크스페이스의 `agent_work_orders`(status `reported`, `agents` 가 effective 인 프로젝트)를 읽고, 0건이면 끝낸다. 관리자가 아닌 프로젝트가 남으면 그 프로젝트들의 `wbs_items(id, parent_id, assignee_member_id)` 를 `in()` 으로 한 번 더 읽어 현행 순수 함수 `countApprovable` 로 센다 — 최대 2왕복. 항목 조회는 `.range()` 로 끝까지 읽는다(`fetchAllPages`) — PostgREST `max_rows = 1000`(`supabase/config.toml:18`)에서 잘린 배열로 세지 않는다(비평 feasibility F-I6, 원칙 ①). 프로젝트 내비의 `p.agents`(결재 대기)·`p.announcements`(안읽음) 배지는 그 프로젝트 기준으로 남긴다 | 개정 §5.3.3 은 공용 화면의 배지를 '내 업무' 합계로 옮겼고 §5.9.1 은 service_role 전역 조회 신설을 금지한다. 현행 `getPendingApprovalCount` 는 프로젝트 하나를 service_role 로 읽는다(`src/lib/data/agentApprovals.ts`) — 그 방식으로 합계를 내면 전역 조회가 된다. 주문 읽기 RLS 는 프로젝트 멤버에게 열려 있다(`read_agent_work_orders`) | 합계 배지는 관리자인 프로젝트만 센다(1왕복, 하위 관리자의 결재가 빠진다) |
| D41 | 프로젝트 전환의 '같은 모듈 유지'는 새 세션 라우트 `GET /api/nav/switch-target?project=<pid>&path=<현재 경로>&query=<현재 쿼리>` 가 판정한다. 순수 함수 `switchTarget()`(`src/lib/nav/switchTarget.ts`)이 경로를 접고 쿼리를 거르며, 대상의 모듈 집합은 B 의 `moduleSetFor({ projectId })` 로 읽는다. 응답은 `{ href, fallbackModule: ModuleId \| null }` 이고 클라이언트가 이동한 뒤 `fallbackModule` 이면 토스트를 띄운다(`ToastProvider` 는 루트 레이아웃이라 이동 뒤에도 남는다). 대상이 숨김(`isHiddenProject`)이면 404 다. 이 라우트는 B 매니페스트(`tests/gates/manifest.ts`)에 `{ guard: 'session', module: null }` 로 넣고, 모듈이 null 인 라우트의 닫힌 목록 `CORE_ROUTE_ALLOW`(B 판정 P14)에도 넣는다. `moduleSetFor` 는 실패하면 core 만 돌려주므로(P22) 대상 판정에는 3값(`moduleState`) 또는 `effectiveModules` 를 직접 받아, 모듈 집합을 읽지 못하면 `{ href: '/p/<B>/dashboard', fallbackModule: null, degraded: true }` 와 토스트 '설정을 불러오지 못해 개요를 열었습니다'를 낸다 — 판정 실패를 '사용하지 않는 모듈'로 위장하지 않는다(비평 lanes L-m3). B 과제 23(`moduleSetFor`) 머지 뒤 착수한다 | 대상의 모듈 집합을 알아야 하는데, 대상 페이지로 바로 가면 꺼진 모듈은 페이지 관문이 404 로 끝낸다. 레이아웃이 워크스페이스 전 프로젝트의 집합을 싣는 방법은 매 이동에 비용을 더한다(R25) | 레이아웃이 `effectiveModulesMany` 로 전 프로젝트 집합을 내려 클라이언트가 판정한다(이동마다 왕복 1 추가, 페이로드 증가) |
| D42 | `NavCaps` 는 `src/lib/authz/navCaps.ts` 의 `navCapsFor(actor, { workspaceId, projectId })` 한 곳에서 계산한다: `isPlatformAdmin` = `isSuperuser`, `isWorkspaceAdmin` = `isWorkspaceAdmin(actor, wid)`, `isProjectAdmin` = 프로젝트 범위면 `isProjectAdmin(actor, pid)`, `canViewUsage`·`canViewPortfolio` = 현행 술어, `canCreateProject` = `isWorkspaceAdmin(actor, wid)`. actor 가 null(열화)이면 전부 false 다. 계정 메뉴의 역할 라벨도 범위 기준이다(워크스페이스 범위는 `workspaceRoleIn`, 프로젝트 범위는 `roleIn`) | 지금 caps·라벨은 레이아웃에서 흩어져 계산되고 워크스페이스와 무관하다(`isAnyWorkspaceAdmin`·`isAnyProjectAdmin` — 실측 shell §1). 어포던스도 fail-closed 여야 한다 | — |
| D43 | `views.default` 는 `{ wbs: 'sheet' \| 'timeline' \| 'board' }` 로 등록한다. 프로젝트 기본 밀도는 소비처(WBS 행 높이 40/32·개인 밀도)를 만드는 SPU2 가 **별도 키**(예 `views.density`)로 더한다 — 같은 키에 필드를 나중에 더하는 것은 개정 §2.6.2 R5(형태 변경은 제자리 금지 — 새 키 + 이행 + 은퇴)에 걸린다. 두 키 모두 R1(키 추가, 제품 기본값 = 현행 동작)이라 `SETTINGS_SCHEMA_VERSION` 과 데이터 이행이 없다. 저장 때 `board` 는 그 프로젝트에서 `kanban` 이 effective 일 때만 받고(아니면 `CONFIG_INVALID` 필드 오류), 읽을 때 `kanban` 이 꺼져 있으면 `sheet` 로 그린다(기본값이라 안내는 띄우지 않는다 — 안내는 URL 로 `?view=board` 를 요청했을 때만) | 소비처 없는 필드는 네 연결 위반이다(개정 §6.1-3). 지금 WBS 그리드에는 밀도가 없고(`WbsGanttSheet` 의 `compact` 는 뷰포트 판정이다) 행 높이는 SPU2 그리드 모델 범위다 | SP3b 가 WBS 행 높이 40/32 를 구현하고 `{ wbs, density }` 로 등록한다(+0.3주, SPU2 가상화와 겹친다) |
| D44 | `startPage`(워크스페이스 키)는 `/account` 의 '현재 워크스페이스' 구역에서 고친다(쿠키 워크스페이스의 이름을 함께 보인다). 리졸버의 해석은 `home` → `/w/<s>`, `my_work` → `/w/<s>/my-work`(UI-2 v0 가 있으므로 접근 가능), `projects` → `/w/<s>/projects`, `last_project` → `recentProjects` 가운데 지금 접근 가능한 첫 프로젝트의 `/p/<id>/dashboard` 이다. 알 수 없는 값·접근 불가는 `home` 이다 | 개정 §2.8.5·§5.3.2. 실측 canon O-8 의 "`my_work` 는 SPU2 전 접근 불가"는 D20 의 v0 로 닫힌다 | — |
| D45 | **UI-2 를 두 Phase 로 나눈다**(한 브랜치 `ui/sp3-menu`, 체크포인트 빈 커밋 둘). **UI-2a 경로·IA**(B 뒤): 워크스페이스 해석·`loadWorkspaceScope`·`navCaps`·`active`·`switchTarget`·`effectiveMany`, C 소유가 아닌 여덟 화면의 `/w/[slug]` 이동과 스텁 여덟·루트 리졸버·홈 v0·내 업무 v0, 화면 안 링크·`revalidatePath`·액션 시그니처(D26)·워크스페이스 한정(§5.8), 개인 설정 분리와 마이그레이션(D9), 메뉴 키·봇 문맥 파생(D27), 개요 교차 모듈 표시·회의록 `?project=`(D53). 이 동안 옛 셸은 고치지 않는다 — `/w/<s>/…` 는 브리지 판정(`isGlobalProjectBridge`) 밖이라 프로젝트 문맥 없이 그려지고(목표 모양과 같은 방향), 옛 손목록 링크는 스텁을 거친다(`route-literals` 허용 목록에 옛 셸 파일을 사유 'UI-2b 가 파일째 다시 씀'으로). UI-2a 체크포인트 커밋은 "옛 셸 + 새 경로"로 main 배포 가능한 상태다. **UI-2b 셸**(C 뒤): 범위 레이아웃 셸·`error.tsx`·`navFor` 소비·전환기·드로어·레일·PageHeader/PageFrame 어댑터·스크롤 단일화·브리지 삭제·`/api/shell` 계약·`(global)` 이동·`/projects` 이동과 아홉째 스텁·`BrandMark`·로고/accent/파비콘·위키 초안 키(D52) | UI-2 한 덩어리는 Phase B 의 과제당 비율로 2.5~3주라 개정 §6.1-1 의 상한(3주)에 걸린다(비평 feasibility F-I10). 경로·IA 는 C 의 레이아웃 없이 페이지의 첫 await(`loadWorkspaceScope`)로 404 를 내므로 C 를 기다릴 필요가 없고, 셸은 C 의 레이아웃에 실린다(D1). 나눠야 C 가 도는 동안 레인 B 가 쉬지 않는다 — 사용자가 두 레인 병렬을 고른 이유(시간)와 맞는다 | UI-2 한 Phase(한 체크포인트) — 3주 상한에 걸리고, C 를 기다리는 동안 준비·조사만 한다 |
| D46 | **main 쓰기 창.** 레인 A 의 Phase 체크포인트는 `sp3a/phase-*` → main ff 를 전제한다(SP3a §2.3, B 계획 과제 28). 레인 B 는 **레인 A 체크포인트가 main 에 들어간 직후, 레인 A 가 다음 브랜치를 자르기 전**에만 main 에 넣는다 — ① B 직후: SP3b 스펙·UI-2 계획·UI-0 기록과 스크립트·UI-1(끝났으면) ② C 직후(또는 D 직후): UI-1(아직이면) ③ `sp3a-done` 직후: UI-2a → UI-2b 차례로(목표 1영업일). `sp3a-done` 뒤에도 레인 A(SP4)가 ff 체크포인트로 도는 동안의 main 쓰기(UI-3·마감)는 같은 규칙이다. 창은 컨트롤러가 열고 닫으며 두 레인 원장에 시각을 적는다. 레인 B 브랜치는 창 직전 최신 main 으로 rebase 하고, 체크포인트 증거(공통 묶음·E2E·성능·눈확인·트레일러 일시)는 그 rebase **뒤** 트리에서 새로 만든다 | 레인 B 가 창 밖에서 main 에 한 커밋만 넣어도 레인 A 는 진행 중인 Phase 브랜치(10~30커밋)를 rebase 하고 원장·리뷰 범위·`docs/baseline/sp3a-*.md` 의 해시와 공통 묶음을 다시 만들어야 한다. 레인 A 는 이 의무를 모른다(비평 lanes L-I2) | 창 밖 머지 — 레인 A 가 rebase 를 받아들이거나 그 체크포인트만 `--no-ff` 로 머지할 때만 |
| D47 | **SP4 경계.** `sp3a-done` 뒤 main 에 가장 먼저 들어가는 것은 UI-2(창 ③)다. 레인 A 의 SP4 는 스펙·계획·마이그레이션·도메인 과제를 `sp3a-done` 직후 시작해도 되지만, `src/app/(app)/layout.tsx`·`src/app/(app)/p/[projectId]/layout.tsx`·`src/components/app/*`·`src/app/(app)/p/[projectId]/**/page.tsx` 의 화면 이행을 고치는 과제는 **UI-2 머지 뒤의 main 에서** 브랜치를 자른다(`p/[projectId]/layout.tsx` 가 `UI_RE` 에 들어가므로 `ui/` 브랜치와 트레일러 — 알림 4·6) | SP4 의 `TeamsProvider`·프로젝트 팀 주입·주간/WBS 화면 이행이 UI-2 가 다시 쓰는 파일과 같다(실측 bounds §2.4). 순서가 없으면 어느 쪽이 먼저든 셸 파일 전체를 다른 쪽 위로 rebase 한다(비평 lanes L-I5) | SP4 셸 과제를 먼저 머지하고 UI-2 가 그 위로 rebase 한다(창 ③ 이 길어진다) |
| D48 | **캡처·눈확인 방법.** 기준선과 모든 눈확인은 리포의 결정적 스크립트 `scripts/ui-capture.mjs`(UI-0 소유, `package.json` 무변경 — Playwright 는 `npx --yes playwright@1`, 대비 검사는 `node_modules/axe-core/axe.min.js`(전이 의존 — 없으면 멈추고 알린다))로 **프로덕션 빌드**(`next build` → `next start -p 3201`)에서 찍는다. 같은 시드(`ui-capture.mjs seed`)·같은 조건(deviceScaleFactor 1·`ko-KR`·`Asia/Seoul`·reducedMotion·새 컨텍스트·글꼴 확인·실시간 영역 가림)으로 **(그 브랜치의 merge-base, 브랜치 머리)** 쌍을 새로 찍어 픽셀 차이율로 비교한다. sha256 은 파일 식별용이다. 캡처 전제로 `SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod` 가 초록이다. dev 서버는 판정에 쓰지 않는다 | 2026-07-27 사고는 프로덕션 CSS 에서만 났다(`docs/runbook-rollback.md` 부록). dev 는 CSS 산출이 다르고 개발 표시기·요청 시 컴파일이 캡처에 섞인다. 부트스트랩만 한 빈 DB 에서는 표·배지·상태색·오늘 칩이 기준선에 없다. 해시는 한 픽셀만 달라도 '다름'이다. 스크립트가 리포에 없으면 UI-1~UI-3·SPU2 Q07·SP9 Q01 이 같은 조건으로 다시 찍지 못한다(비평 ui-risk B2) | dev 서버 + sha256(초안) — 비교가 성립하지 않는다 |
| D49 | **범위 레이아웃은 설정 읽기 실패를 받아 처리하고 던지지 않는다**(UI-2b). ① 모듈 집합 실패(`ConfigUnavailableError`·`ConfigKeyError`) → `effective = CORE` — 비core 항목을 숨긴다(어포던스 fail-closed, 비core 페이지는 B 관문이 자기 상태를 낸다) ② `navigation.menu` 손상·조회 실패 → `{ order: [], labels: {} }`(레지스트리 순서) ③ `branding.*` 손상 → 제품 기본(D23, SP3a D39). 셋 다 로그를 남기고 셸 머리에 `StatusMessage kind="partial_error" compact` '설정을 불러오지 못해 메뉴 일부를 숨겼습니다'(관리자에게는 설정 링크)를 싣고 `children` 은 그대로 렌더한다. 오류 경계로 보내는 것은 슬러그·소속 조회 실패뿐이다 | B 의 `effectiveModules` 는 해석기 실패·손상을 그대로 던진다(`effective.ts` 머리 주석, CR-5 `6892183`). 레이아웃이 받지 않으면 설정 하나가 손상돼도 그 범위의 모든 페이지가 오류 화면이 되고, 손상된 키를 고칠 `/p/<pid>/settings`·`/w/<s>/settings` 도 같은 레이아웃 아래라 열리지 않는다 — B 판정 P2·Phase A 눈확인 A-4 가 지킨 '설정을 불러오지 못했습니다' 상태가 무너진다(비평 lanes L-B3) | 레이아웃이 던지고 `error.tsx` 가 받는다(복구 경로는 SQL 뿐) |
| D50 | `globals.css` 의 전역 규칙(`:focus-visible`·`::selection`·스크롤바·`body`·`*`), 원색 `:root`, 다크 `.dark`, 비색 토큰, 인쇄 블록은 **지금처럼 `@layer` 밖**(unlayered)에 둔다. `:focus-visible` 은 값만 `var(--color-border-focus)` 2px + 2px offset 으로 바꾼다. §4.1 표에 층 열을 두고 `tests/css/global-rule-layers.test.ts` 가 고정한다 | 지금 이 규칙들은 unlayered 라 `outline-none`·`focus:outline-none` 유틸(24곳/20파일 — `Modal.tsx:88`, 회의 목록 행, `WbsGanttSheet.tsx:1004,1556`, `SheetCell.tsx:79`, `MemberPicker.tsx:179` 등)이 붙은 요소에도 포커스 링이 그려진다. `@layer base` 는 utilities 에 지므로 옮기는 순간 24곳의 키보드 포커스 표시가 사라진다(WCAG 2.4.7) — 빌드·jsdom 어디에서도 안 잡힌다(비평 ui-risk B3). `.dark{}` 를 레이어에 넣으면 `@layer theme` 의 라이트 값과 순서 싸움이 되고 D23 주입 `<style>` 과의 우선순위도 바뀐다 | `@layer base` 로 옮기고 그 전에 24곳마다 3:1 이상의 대체 포커스 표시를 확인하는 과제를 둔다 |
| D51 | 1만 행 기준선(UI-0)은 레인 B 스택의 `[api] max_rows` 를 `20000` 으로 올려 잰다(§2.5-1 과 같은 로컬 수정 — 기록에 적는다. R25 측정도 같은 스택이라 세 대상에 같다). `perf-grid.mjs measure` 는 첫 표시 뒤 DOM 행 수가 시드 행 수와 다르면 **실패**한다. 앱의 무범위 조회(`getComputedWbs` 의 `wbs_items`·`item_owners`)는 SP3b 가 고치지 않고 레인 A 에 알린다(소유 SP4/SPU2 — 알림 12). SP3b 의 새 로더는 여러 프로젝트에 걸친 조회를 `.range()` 로 끝까지 읽는다(D40·§5.9) | `supabase/config.toml:18` `max_rows = 1000` 과 `getComputedWbs`(`src/lib/data/wbs.ts:34-35`)의 range 없는 조회 때문에 1만 행 시드가 1,000행에서 200 + 잘린 배열로 끝난다 — 기준선이 1,000행의 측정이 된다. `item_owners` 는 프로젝트 필터도 없어 다른 프로젝트의 담당 배지까지 잘린다(비평 feasibility F-I6, 원칙 ①) | 1,000행 기준선만 남기고 1만 행은 SPU2(쪽 나눔·가상화)로 넘긴다 |
| D52 | **위키 초안 키 이행**(개정 §5.8.5)은 UI-2b 가 한다: `src/lib/drafts/wikiDrafts.ts` 의 키를 `draft:v2:<userId>:<workspaceId>:<projectId>:wiki:<topicId>` 로 바꾼다. `workspaceId` 는 `useScope().workspace.id`(D38). 옛 `wiki-draft:v2:<userId>:<projectId>:<topicId>` 는 편집 진입 때 먼저 읽어 새 키로 옮긴 뒤 지운다(복구·폐기 결정 전에는 지우지 않는다 — 개정 §5.8.5 복구 순서). 로그아웃 정리(H1 과제 12 경로)는 두 접두를 모두 지운다. 일반 초안 정책·`security.local_drafts` 는 SPU1 이다 | 개정 §5.8.5 가 이 이행을 SP3b 에 줬는데 초안은 SPU1 로 조용히 넘겼다(비평 fidelity I2). 클라이언트가 워크스페이스 id 를 동기로 아는 것은 UI-2b 의 범위 컨텍스트부터다 | SPU1 로 넘긴다(§1.3 E-행·반영 지시로 드러낸다) |
| D53 | `/w/[slug]/minutes` 는 `?project=<pid>` 를 받는다(UI-2a) — pid 가 슬러그 워크스페이스의 접근 가능한 프로젝트면 목록·탐색기를 그 프로젝트로 거르고 머리에 칩 '프로젝트: {이름} ×'(× = 쿼리를 지운 링크, 지우면 워크스페이스 전체)를 둔다. 아니면 쿼리를 무시한다(존재 은닉 — 안내도 없다). 프로젝트 개요(`DashboardView`)와 프로젝트 회의 화면(`/p/[projectId]/meetings`)에 '이 프로젝트 회의록' 링크(`wsHref(slug, 'minutes', { project: pid })`, 회의록 모듈이 effective 일 때만)를 둔다 | 개정 §5.3.3 '회의록과 프로젝트' 규칙이다. 브리지를 지우면 프로젝트 문맥에서 회의록으로 가는 길이 사라지는데 초안에는 대체 경로가 없었다(비평 fidelity I4). 지금 회의록 페이지는 `searchParams` 를 받지 않는다 | 회의록 화면 소유 SP5 로 넘긴다(§11 행 + 반영 지시) |
| D54 | `PageFrame` 문서형의 도구 줄은 자기 높이를 CSS 변수 `--frame-sticky-top`(ResizeObserver, 도구 줄이 없으면 0)으로 `PageFrame` 루트에 내리고, 페이지 안 고정 요소는 `top-0` 대신 `top-(--frame-sticky-top)` 를 쓴다. UI-2b 는 `grep -rn "sticky" src/components` 의 13파일(25곳 — `WeeklySheetView`·`AttendanceView`·`MeetingsView`·`MyMeetingsView`·`MinutesView`·`WikiSearch`·`WikiSearchResults`·`WikiTopicDetail`·`RosterBoard`·`DelegationTable`·`MemberPicker` 등)을 과제 목록에 넣고, 고치지 않는 파일은 사유를 적는다. 도구 줄(`--z-sticky`)이 페이지 안 고정 요소보다 위다 — 페이지 안 고정 요소는 `z-10` 이하로 내린다 | 지금 `ProjectPageShell` 은 머리·`pinned` 를 스크롤 영역 밖에 두어 페이지 안 `sticky top-0` 이 고정 머리 아래에 붙는다(`ProjectPageShell.tsx:34-44`). `main` 이 유일한 스크롤이 되면 `WeeklySheetView.tsx:802` 의 `sticky top-0 z-40` 등이 같은 `top: 0` 에 붙어 도구 줄을 덮는다 — 스크롤한 뒤에만 보여 정지 캡처에 안 잡힌다(비평 ui-risk I1·feasibility m15). 토큰 치환 수준이라 화면 소유 규칙의 '만진다'에 들지 않는다(E36) | 어댑터가 `pinned` 를 sticky 가 아닌 머리 아래 비고정 영역으로 옮긴다(스크롤하면 도구 줄이 사라진다) |
| D55 | **첫 페인트 규칙.** Tailwind 기본 경계(640·768·1024·1280·1536)에서 갈리는 표시는 CSS display·폭 유틸로 한다 — 1024 미만 사이드바 없음·햄버거·드로어 진입은 `hidden lg:flex`·`lg:hidden`(안전망이 덮는 모양), 선호 값이 없을 때의 사이드바 접힘(1024~1279 접힘·1280 이상 펼침)은 폭 유틸(`lg:w-16 xl:w-58` 류)과 라벨·그룹 머리의 `hidden xl:inline`(명시 선호가 있으면 서버가 아는 값으로 조건부 렌더). PageHeader 컴팩트의 `description`·`meta` 는 임의 미디어 한 클래스(`[@media(max-width:1279px),(max-height:799px)]:hidden` — 형식은 계획에서 컴파일로 확인, 안전망 클래스와 한 요소에 섞지 않는다)로 숨긴다. 기본 경계가 아닌 것(1400·1440·레일 병치 720)만 `matchMedia` 훅이고, 그 훅은 SSR·첫 렌더에서 **닫힘·오버레이 없음** 값을 낸다(레일은 열린 채로 SSR 하지 않는다). 상태(탐침·권한·저장 바·배지 값)에 따른 표시·숨김은 조건부 렌더나 감싸는 요소로 하고, 반응형 display 클래스가 붙은 요소에 조건부 `hidden` 을 덧붙이지 않는다(D17 ②) | `useCompactViewport` 는 SSR 을 데스크톱으로 그리고 마운트 뒤 보정한다(`useCompactViewport.ts:16`). `matchMedia` 로 사이드바·머리를 정하면 390·1280×720 에서 하드 로드마다 데스크톱 모양이 먼저 그려졌다 바뀐다(CLS). 사이드바 표시가 2026-07-27 사고의 요소(`hidden lg:flex`)이고 안전망이 바로 그 CSS 를 지킨다(비평 ui-risk I6·feasibility m16) | 훅 + 조건부 렌더(초안) — 첫 페인트가 튄다 |
| D56 | **z 대응표와 전체 화면 규칙.** UI-1 이 `docs/baseline/sp3b-ui.md` 에 z 대응표를 둔다 — 지금 값 22종(파일:줄)마다 새 토큰 또는 '화면 내부(스태킹 컨텍스트 안)'. 새 표에 없는 층 둘을 더한다: WBS 전체 화면 = `--z-fullscreen: 120`(overlay 110 위, modal 150 아래), 보관 챗(`ArchiveChatPanel`, 지금 140) = `--z-modal` 계열. UI-2b: WBS 전체 화면이 열려 있는 동안 레일(AI·인스펙터)은 전체 화면 컨테이너 **안**의 레일 자리에 포털한다(`RightRail` 이 포털 대상을 `useRailHost()` 로 고른다) | WBS 전체 화면은 `fixed inset-0 z-[125]`(`WbsGanttSheet.tsx:1085`)다. AI 패널·인스펙터를 `#app-rail`(90/110)로 포털하면 전체 화면에서 그 아래로 숨는다 — 지금 AI 패널은 z-[130](`AssistantChat.tsx:508`)이라 위에 뜬다. `ArchiveChatPanel.tsx:36-37` 주석은 지금 층 순서를 전제한다(비평 ui-risk I2) | 레일 층을 125 위로 올린다(모달·팝오버와의 순서 전제가 다시 흔들린다) |

### 1.3 상위 문서 대비 정정(실측)

| # | 상위 문서의 말 | 실측(근거) | 이 문서의 처리 |
|---|---|---|---|
| E1 | 개정 §5·SP3b 블록의 줄 인용(`HeaderChrome.tsx:192`·`:189`, `Sidebar.tsx:130`, `(app)/layout.tsx:112`, `ProjectNavigationContext.tsx:36-46`, `usageMenu.ts:59-65` 등) | H1 이후 밀렸다 — 다크 토글 `:200`·언어 `:197`, 사이드바 폭 `:134`, main 스크롤 `:115`(`:112` 는 flex 열 div), 브리지 함수 `:37`, `resolveMenuKey` `:59-73` 외 약 25건(실측 shell §13, tokens §10) | 심볼 이름으로 적는다 |
| E2 | 개정 SP3b 블록 "리터럴 95줄·`revalidatePath` 29곳(+ `/projects`)" | `src` 따옴표 접두 리터럴 125줄/39파일(6라우트 96 + `/projects` 29), 비따옴표·정규식 5줄 더해 130줄/42파일. `revalidatePath` 38회(6라우트 33 + `/projects` 5), `redirect('/projects')` 9, `router.push` 5(실측 routes §2, 부록 A) | 실측 표를 과제 목록의 입력으로 쓴다(§5.7) |
| E3 | 개정 SP3b 블록 "`resolveSoleWorkspaceId` 7파일" | 코드 호출은 `(app)` 3·`actions/minutes.ts` 1 이고 `components` 3파일은 **주석**이다. done_when grep 은 주석도 센다. `createMinute` 는 워크스페이스 인자가 없다. Phase B 가 같은 판정을 `requireSessionModule(null)`·`requireModulePage(null)`·`aiAvailable(null)` 로 더 넣는다(실측 shell §6) | D26. 주석도 고친다. done_when 의 grep 을 넓힌다(§9) |
| E4 | 개정 §5.3.2 "옛 `page.tsx` 는 지우지 않고 리디렉션 스텁(`gantt/page.tsx` 관례)" | `(app)/loading.tsx` 경계 안에서는 HTTP 307 이 나오지 않을 공산이 크다(실측 routes §4.2) | D5 — `(legacy)` 라우트 그룹의 `route.ts` |
| E5 | 개정 §5.7.3·SP3b 블록 "`/admin/ui-states`(`requireSuperuser()`)" | `platform-guards` 불변식이 호출 11곳을 고정한다 | D16 |
| E6 | 개정 §5.5.5 `.app-backdrop` 1곳(`layout.tsx`) | 5곳 — `(app)/layout.tsx`·`not-found.tsx`·`invite/[token]/page.tsx`·`ShareViewer.tsx`·`WbsGanttSheet.tsx`(전체 화면 모드)(실측 tokens §5.1) | UI-1 이 다섯 곳을 `bg-canvas` 로 바꾸고 클래스를 지운다 |
| E7 | 개정 §5.4.4 "`PageHero` 호출 22곳을 props 대조로 이관" | 23건/21파일(오류 분기 포함). `PageHero` 는 `title` 만 그리고 나머지 props 를 버린다. 폭 ≥1280 且 높이 ≥800 에서만 보인다(`PageHero.tsx:23`) | D18 — 어댑터. 대조 이관은 SP3b 소유 화면만 |
| E8 | 개정 §5.5.5 어두운 히어로 전제 마크업 = `projects/page.tsx:201,219` | 살아 있는 어두운 표면 7곳 — `PageHero` 제목 띠, `/projects` 히어로(`:202`·`:218` 외), `NewProjectModal` 기본 트리거, `AgentFrame`·`AgentTabs`, `WikiSearch`·`WikiReindexButton`, `AssistantChat`(`--gradient-dark`), 404(`--gradient-primary`). `KpiCard variant="hero"` 29건·`HeroBadge` 는 그려지지 않는 죽은 마크업(실측 tokens §5.2) | D13 |
| E9 | 정본 §3.2.5 #3 `SECTION_LABEL` 12항목 | 14항목(`agents`·`import` 추가)(실측 shell §3.1) | UI-2 가 통째로 지운다 |
| E10 | 개정 §5.3.6 전환기 = `my_workspace_ids()` 2개 이상 | 슈퍼유저에게는 전 워크스페이스(`0003:201-206`) | D4 |
| E11 | SP3a §2.1 끝 줄·사용자 결정 L-2 "UI-2 는 Phase B 체크포인트 뒤" | ★1·★2·★8·★11 의 파일 셋이 C 소유다(SP3a §2.2 C 행). 워크스페이스 셸이 실릴 `(app)/w/[slug]/layout.tsx` 가 main 에 없다 | D1·D45 — 결정 문언대로 UI-2 전부 B 뒤. 셸(UI-2b)은 C 뒤(결정보다 엄격 — §10.1 #1 알림) |
| E12 | 개정 §5.0 5-D11·§6.8 D5-§9 "`portal.widgets`·`views.default` 키는 SP3a" | 개정 §2.8.1·§2.8.2·§6.2 SP3a 블록·§2.10 §9 는 SP3b. SP3a 스펙 E20 이 SP3b 로 판정했고 코드의 `PLANNED_KEYS` 가 `sp: 'SP3b'` 다 | SP3b 가 등록한다(D25). 5-D11·§6.8 문구는 `navigation.menu`·`branding.*` 에만 맞는다 — 반영 지시(§7) |
| E13 | 개정 §5.5.4 토큰 표 | `today` 칩 글자·상태 채움 전경·범주 weak·`phasebar-fill`·`critical-weak` 의 이름이 없다 | D12 |
| E14 | 개정 §6.5.4 UI-1 확인 화면에 '로그인 × 라이트/다크' | 로그인은 토큰을 하나도 쓰지 않는다(임의 hex 17·rgba 26·`bg-white` 14) — 별칭 전환이 로그인에 아무 영향이 없다(실측 tokens §8.3-1) | UI-1 이 로그인(246줄)을 토큰으로 다시 쓴다. 공개 화면의 env 브랜드(이름·로고)는 그대로 |
| E15 | 개정 §5.5.7 `contrast-tokens` 를 "필수로 바꾼다" | 지금 테스트는 `@theme` 첫 블록의 hex 리터럴만 읽고 다크를 읽지 않는다 — 별칭(`var(…)`)이 되면 "토큰 없음"으로 던진다(실측 tokens §8.2) | UI-1 이 라이트·다크를 모두 파싱하고 `var()` 를 풀어 계산하게 다시 쓴다. 대비 함수는 `accent.ts` 의 `contrastRatio` 하나를 쓴다 |
| E16 | 개정 §5.6 기본값 "선호가 없는 사용자는 COM-6 뒤 `system`" | 백필이 모든 사용자에게 `theme:'light'` 를 저장한다. 같은 절 no-flash 행의 "`system` 이거나 값이 없을 때 `matchMedia`"는 기본값 행("선호 없음 = COM-6 전까지 light")과 어긋난다 | D10 — 기본값 행을 따른다. no-flash 행의 '값이 없을 때'는 SP9 뒤에 참이다 — 반영 지시 9 에 '(COM-6 전에는 light)' |
| E17 | 개정 §5.3.2 "`/minutes/[id]` 하위 경로 보존"만 | 영구 링크 넷(색인·봇 출처·외부 API `url`·LLM 답변)이 옛 형식이다 | D6 |
| E18 | 개정 §5.3.2 "`/usage` 노출 판정은 현행 그대로" | 수치 자체가 플랫폼 전역이다(`usage_events` 에 `workspace_id` 없음) | D21 |
| E19 | 개정 §5.3.1 "비소속이면 404" | 레이아웃의 `notFound()` 는 페이지 로더를 멈추지 않는다(`tests/invariants/project-page-gates.test.ts:1-8`). `getSeatmap` 은 service_role 로 읽는다(`lib/data/agentSeatmap.ts:139`) | 옮기는 페이지마다 첫 await 로 슬러그를 판정한다(§5.2) |
| E20 | Phase B 판정 P18 "`people.email` 권한 회수는 SP3b 가 `profiles.ui_prefs` 를 채택하면 그 `0013`" | 레인 A 에 "0012 다음 첫 마이그레이션" 후보가 셋 있고 SP4 가 `0013_weekly_areas` 를 받는다(`.superpowers/sp3a/plan-b-scratch/carries-from-a.md`) | D9 — 흡수하지 않는다. 레인 A 에 알린다(§2.4) |
| E21 | 개정 §5.4.4 "과도기: `ProjectPageShell` 이 컴팩트에서 `sr-only` h1(트리아지 #31)" | 구현되지 않았다. 컴팩트에서 보이는 h1 이 있는 앱 화면은 `/projects`·`/minutes/[id]` 둘뿐이다. `ReportModal` 이 h1 을 하나 더 그린다(실측 shell §5) | D18 로 바로 모든 뷰포트 h1. `ReportModal` 의 h1 은 h2 로 |
| E22 | 개정 §5.5.6 `text-[10px]` 44파일, SP3b 블록 UI-1 "타입 스케일과 10px uppercase 제거" | TS/TSX 43파일(`globals.css` 포함 44). 12px 미만 전체 368건(실측 tokens §5.3) | D14 — UI-1 은 공용 클래스 넷·공용 컴포넌트 다섯만. 나머지 368건은 화면 소유 SP 가 그 화면을 만질 때(§6.1-4) — 반영 지시 18(SP4·SP5·SP5b·SPU3 블록의 화면 이행 항목에 '12px 미만·uppercase 제거' 한 줄) |
| E23 | 개정 §5.12.1 UI-0 "31라우트·스크린샷·핵심 동작" vs SP3b 블록 UI-0 | §5.12.1 은 1만 행 합성 WBS 성능 기준선·설정/권한/편집 API 소비처 조사를 더한다 | §5.12.1 을 따른다(§3) |
| E24 | 개정 SP3b 블록 "`ProjectTabs.tsx` 는 importer 0" | 맞다 — `src`·`tests` 모두 0(실측 shell §2.6) | 지운다(★5) |
| E25 | — | `HeaderChrome` 의 `ChangePasswordModal`·`pwOpen` 은 여는 곳이 없는 죽은 코드다. 팝오버·모바일 메뉴에 Esc·포커스 트랩·복귀가 없다. 셸 레이아웃이 전 워크스페이스의 프로젝트를 읽고 `canCreateProject` 가 워크스페이스 무관(`isAnyWorkspaceAdmin`)이다(실측 shell §14) | UI-1 이 죽은 코드를 지운다. UI-2 가 키보드 계약(개정 §5.10.2)을 새 팝오버·드로어에 넣고, 목록·caps 를 현재 워크스페이스로 좁힌다 |
| E26 | 개정 §5.5.7 `no-raw-color` "새 파일부터" | 기준선: 임의 hex 유틸 58건/11파일, TS hex 204건/25파일, `rgb(a)(` 32건/5파일, `z-[` 30건/14파일, 팔레트 유틸 49건/10파일(실측 tokens §8.2) | 허용 목록의 초기값 = UI-1 이 **마지막으로 rebase 한 main** 의 위반 파일 목록. C 가 먼저 머지돼 C 의 새 파일에 위반이 있으면 UI-1 은 그 파일(C 소유)을 고치지 않고 사유 '주인 C — UI-3 에서 정리(§6.4)'로 목록에 넣는다. "목록은 줄기만 한다"는 그 재기준선 뒤부터다. UI-1 이 먼저면 C 의 새 설정 컴포넌트에도 걸린다 — 레인 A 에 알린다(§2.4 알림 1, 비평 lanes L-I4) |
| E27 | 개정 §5.3.2 "`/p/[id]/kanban` → `/p/[id]/wbs?view=board`, 기존 쿼리 보존" | 칸반의 `view` 쿼리는 묶음 기준(phase·owner·progress·옛 status)이다. 봇 딥링크 `kanbanHref` 가 `?view=&team=` 을 낸다(`deep-links.ts`, 헤더 주석 "kanban `?view=&team=`") | D36 — `view` 를 `group` 으로 옮긴다 |
| E28 | 개정 §2.8.2·§5.11.2 `views.default = { wbs; density }` | WBS 그리드에 밀도 소비처가 없다(`WbsGanttSheet` 의 `compact` 는 뷰포트 판정). 나중에 같은 키에 필드를 더하면 개정 §2.6.2 R5 에 걸린다 | D43 — 밀도는 SPU2 가 소비처와 함께 별도 키로 |
| E29 | 개정 §5.4.2 "채움형 = 작업 계획·주간 시트·근태 매트릭스" | 주간·근태는 세로 스크롤 주체가 없고 셸 영역에 기댄다(실측 shell §4). 채움형으로 바꾸려면 두 화면 파일(SP4·SP5 소유)을 고쳐야 한다 | D19 — UI-2 의 채움형은 작업 계획 하나. 나머지는 화면 소유 SP |
| E30 | 개정 §5.3.6 "대상에서 모듈이 effective 가 아니면 개요 + 토스트" | 대상 프로젝트의 모듈 집합을 클라이언트가 얻는 경로가 정해져 있지 않다. 대상 페이지로 바로 가면 페이지 관문(B)이 404 를 낸다 | D41 — 전환 대상 라우트 |
| E31 | 개정 §5.3.3 "'내 업무' 에 워크스페이스 합계 검토 대기 배지" | 현행 결재 배지는 프로젝트 하나를 service_role 로 센다(`agentApprovals.ts`). 워크스페이스 합계를 같은 방식으로 내면 §5.9.1 이 금지한 전역 조회가 된다 | D40 — 세션 클라이언트 2왕복 |
| E32 | 개정 §8.1 #5 권고·§6.3 조건부 행·SP3b 블록 마이그레이션 행 "`profiles.ui_prefs jsonb`" | `profiles_read`(`0003_org_core.sql:649-652`)가 같은 워크스페이스 동료에게 행 전체 SELECT 를 준다 — 동료가 서로의 개인 설정을 읽는다. 열 SELECT 를 회수하면 본인 읽기·병합 갱신까지 막힌다(비평 feasibility F-I7) | D9 — 새 표 `account_preferences`(자기 행 RLS). 반영 지시 19 |
| E33 | 개정 §2.8.5 `density`(신규 COM-1)·§5.9.4 #18 `/account` '밀도' | 소비처(그리드 밀도)가 SPU2 전에는 없다 — 소비처 없는 키는 네 연결 위반(개정 §6.1-3). §2.8.5 표에는 범위(계정·워크스페이스) 열과 `projectsView`·`notifRead`·기존 표시 키(`dashSections`·`minutesView`·`minuteFontSize`·`minutesExplorerLayout`·`wbsHideDone`·`wbsOutline`·`wbsGanttScale`)가 없다(비평 fidelity m2) | D9 — 개인 `density` 는 SPU2 가 소비처와 함께. 반영 지시 5 |
| E34 | 개정 SP3b 블록 '범위 제외' "내 업무 화면(SPU2)"·§5.9.4 #7·§5.12.1 UI-2 행 | `ws.my_work` 는 늘 보이는 내비 항목이라 SPU2 전까지 빈 링크가 된다(실측 bounds G-3·G-4) | D20 — 내 업무 v0 는 SP3b(UI-2a). 반영 지시 14 |
| E35 | 개정 §5.9.1 "로더마다 1왕복"·§6.4 R25 "위젯당 1왕복" | 모듈 판정(D39 — 설정 2)과 결재 가능 판정(D40 — 최대 2)이 왕복을 더한다 | '로더당 상수 왕복(최대 3, 프로젝트 수와 무관)'. 판정 기준은 §8.4 p95. 반영 지시 11 |
| E36 | 개정 §6.1-4 "어떤 SP 가 화면을 만지면 그 화면에 SP3b 패턴을 적용해서 끝낸다" | SP3b 는 `/p/[id]/members`(열 추가)·옮기는 9화면·`DashboardView`(교차 모듈·링크)·sticky 13파일(D54)을 만지지만 PageHeader 이행은 §5.9.4 적용표의 SP 에 남긴다(비평 fidelity m18) | '만진다' = 화면의 구조·흐름을 바꾸는 작업. 경로 이동·토큰 치환·표시 열 하나·링크 하나 추가는 해당 없음 — 이행은 §5.9.4 적용표의 SP. 반영 지시 20 |
| E37 | 개정 §5.12.5 ③ "`nav-for.test` 모듈×caps×menu"·SP3a §10.1 "같은 파일" | `tests/nav/nav-for.test.ts`(B)는 `.ts`·node 환경(`vitest.config.ts:6`)이고 파일 머리에서 설정 해석기를 mock 한다 — 렌더 케이스(JSX·jsdom)를 넣을 수 없다(비평 lanes L-m1) | 셸 소비 케이스는 새 파일 `tests/shell/nav-consumption.test.tsx`(jsdom)가 `navFor` 와 같은 조합표로 본다. B 파일은 고치지 않는다. 반영 지시 21 |
| E38 | 개정 §5.12.1·SP3b 블록의 UI 단계 "UI-2 한 단계" | UI-2 는 과제당 비율로 2.5~3주(개정 §6.1-1 상한), 셸은 C 의 레이아웃에 실린다(비평 feasibility F-I10·F-I2) | D45 — UI-2a·UI-2b. 반영 지시 23 |
| E39 | 개정 §5.3.2·§5.12.1 UI-2 행 "`/p/[id]/kanban` → `wbs?view=board`"(UI-2) | 보드를 그리는 코드는 UI-3(보기 전환)이다 — UI-2 에서 옮기면 UI-2~UI-3 머지 사이 main 에 보드가 없다(`wbs/page.tsx:85`, 비평 feasibility F-B1) | D36 — 칸반 처분은 UI-3. 반영 지시 1 |

## 2. Phase 구성

개정 §6.1-1 은 SP 노력 상한을 3주로 두고 넘으면 Phase 와 main 체크포인트를 요구한다. SP3b 의 추정은 개정의 "3주(3~4)"를 넘는다(아래 합계). UI 트랙 단계가 이미 브랜치·체크포인트 단위이므로 SP 를 쪼개지 않고 단계를 Phase 로 삼는다. UI-2 는 한 덩어리로 상한에 걸려 UI-2a·UI-2b 로 나눈다(D45). 각 Phase 는 3주 안이다.

### 2.1 Phase 표

| Phase | 목표 | 의존 | 노력(추정) | 브랜치 → main | 체크포인트(main 배포 가능) |
|---|---|---|---|---|---|
| UI-0 — 기준선(COM-0) | 현행 31라우트의 의존 태그·4크기 라이트 캡처·핵심 동작·가시 h1 수, 1만 행 합성 WBS 성능, 설정·권한·편집 API 소비처를 문서로 남긴다. 캡처 도구와 화면 표본 시드(D48)를 리포에 둔다. 제품 코드는 바꾸지 않는다 | 없음 — 지금 | 0.5~0.6주 | `sp3b/ui0` → 창 ① | `docs/baseline/sp3b-ui0.md` + `scripts/{perf-grid,ui-capture}.mjs` 와 단위 테스트 초록 + `lint` |
| UI-1 — 토큰·다크·상태 컴포넌트(COM-1) | 3층 토큰과 옛 이름 별칭으로 전 화면이 중립·코발트가 된다. 비색 토큰(반경·간격·조작 높이·아이콘·모션)·z 대응표·인쇄 블록을 둔다. 테마 3값을 계정 팝오버·`/account` 에서 고른다. 사이드바·히어로가 밝은 표면이다. 로그인이 토큰을 쓴다. `StatusMessage`·`Button`·`Field` 상태 계약과 `/admin/ui-states` 가 있다. 대비·원색·display 캐스케이드·전역 규칙 층 테스트가 필수다 | UI-0 캡처 끝(비교 기준이 먼저) | 1.7~2.2주 | `ui/sp3-tokens` → 창 ① 또는 ② | 공통 묶음(§2.4) + 눈확인 UI-1 행(§8.5 — 전 라우트 회귀·다크·axe 대비, **사용자 확인**) + ⑤·⑨ + `settings:verify`(accent 임계) + `smoke:prod` + 트레일러 |
| UI-2a — 경로·IA(COM-3 앞 절반) | ★1(`/projects` 제외)·★2·★4(파생)·★9. 공용 화면 여덟이 `/w/[slug]/…` 로 옮겨 가고 옛 경로는 307 이다. 루트 리졸버·홈 v0·내 업무 v0 가 있다. 화면 안 링크·`revalidatePath`·액션 시그니처가 워크스페이스를 명시한다. 개인 설정이 계정·워크스페이스로 갈린다. 옛 셸은 그대로다(D45) | **B 체크포인트(main)** | 1.3~1.6주 | `ui/sp3-menu`(체크포인트 커밋 1) → 창 ③ | 공통 묶음 + DB 묶음 + E2E 부분(E1·E2·E4·E6·E8·E9·E11) + 눈확인 UI-2a 행(에이전트) + 트레일러 |
| UI-2b — 셸(COM-3 뒤 절반) | ★1(`/projects`)·★3·★4(내비)·★5·★6·★8·★10·★11. 셸이 범위 레이아웃에서 `navFor` 로 그려진다. 전환기·즐겨찾기·최근 방문·드로어·우측 레일이 돈다. 스크롤 주체가 하나다. 브리지·`ProjectTabs`·티커가 없다 | **C 체크포인트(main)** ∧ UI-2a 체크포인트(브랜치). 새 셸 컴포넌트(배선 없음)는 B 뒤부터 | 1.5~1.8주 | `ui/sp3-menu`(체크포인트 커밋 2) → 창 ③(UI-2a 다음) | 공통 묶음 + DB 묶음 + 로컬 E2E 전체(§8.3) + 성능(§8.4) + 눈확인 UI-2b 행(**사용자 확인**) + ①②③④⑦⑧ + 트레일러 |
| UI-3 — 대표 3화면 | 포털 v1·프로젝트 목록, 작업 계획 보기 전환(칸반 흡수·`views.default`·인스펙터 레일), 설정 두 화면의 시각 패턴. `portal.widgets`·`views.default` 등록(네 연결). 명단 실효 역할 열. `/account` 개인 설정 | UI-2 머지(그러므로 `sp3a-done` 뒤) | 1.4~1.8주 | `ui/sp3-screens` → SP4 체크포인트 직후 창(D46) | 공통 묶음 + DB 묶음 + ⑥ + 눈확인 UI-3 행 + **사용자 눈확인 게이트 ⑪** + 트레일러 |
| 마감 | 로컬 E2E 기록, 성능·노력 실측, 개정 반영 지시 목록, 원장 | UI-3 | — | main(창) | `sp3b-done` |

- 합계 약 6.4~8.0주다(개정 3주, 초안 3.5~4.8주). 비평 feasibility F-I10 이 Phase B 계획의 과제당 비율(28과제 2.5~2.8주)로 다시 셌고, 비평 반영으로 늘어난 일(캡처 도구·시드, 넓힌 눈확인·axe, 범위별 오류 경계, 설정 읽기 실패 처리, sticky 13파일, 위키 초안 키, 회의록 `?project=`, 칸반 흡수)을 더했다. Phase A 실측 비율(추정 2~3주 ≈ 벽시계 약 15시간, `.superpowers/sp3a/progress.md:22`)로는 에이전트 시간 약 35~60시간(중앙 약 45시간)에 사람 확인(UI-1·UI-2b·UI-3)과 레인 A 대기가 더해진다.
- 레인 B 는 임계 경로 밖에서 돈다 — UI-0·UI-1 은 B 동안, UI-2a 는 B~C 동안, UI-2b 는 C~`sp3a-done` 동안. 목표는 `sp3a-done` 때 UI-2 가 창 ③ 에 들어갈 준비가 된 상태다. UI-2b 가 늦으면 SP4 의 셸·화면 과제가 그만큼 기다린다(D47 — SP4 의 DB·도메인 과제는 영향 없음). 체크포인트마다 실측을 원장(`.superpowers/sp3b/progress.md`)에 적고 마감에서 재산정한다(§10.1 #8).
- 합성 수용 게이트(개정 §6.5.8)에서 SP3b 가 켜는 단계는 없다(개정 §6.5.6 SP3b 행 "—").
- `git add -A` 는 쓰지 않는다. 커밋 메시지는 한국어, push 는 사람 확인 뒤다.

### 2.2 두 레인 — 게이트·main 쓰기 창·머지 순서

| 단계 | 착수 조건 | main 머지 | 이유 |
|---|---|---|---|
| UI-0 | 없음 | 창 ①(B 직후) | 코드 무변경. 창 밖에 넣으면 레인 A 의 B 브랜치가 rebase 한다(D46) |
| UI-1 | UI-0 캡처 끝 | 창 ①(끝났으면) 또는 ②(C 직후·D 직후). push 는 사용자 눈확인과 한 자리(D29) | C 의 새 설정 화면이 새 토큰·`StatusMessage` 위에서 만들어지면 좋지만(개정 §6.1-4) 레인 A 를 늦추지 않는다(§10.1 #12). B 와의 교집합은 사전 `common.ts`·`common.en.ts`, 페이지 관문 불변식 제외 목록 한 줄, `AssistantChat.tsx`(B 과제 24 — UI-1 은 그라데이션 세 줄·`text-white`)다. C 와의 교집합은 §2.4 표이고, UI-1 은 C 소유 파일을 고치지 않는다 |
| UI-2a | **B 체크포인트(main)** | 창 ③(`sp3a-done` 직후) | `navFor`·`requireModulePage`·`moduleSetFor`·CR-5·챗 탐침이 B 산출물이다. 워크스페이스 화면의 404 는 페이지 첫 await(`loadWorkspaceScope`)가 내므로 C 의 레이아웃이 없어도 된다 |
| UI-2b | **C 체크포인트(main)** ∧ UI-2a 체크포인트(브랜치). 새 셸 컴포넌트(배선 없음)는 B 뒤부터 | 창 ③(UI-2a 다음) | 셸이 C 의 `w/[slug]/layout.tsx` 에 실린다. S-2·S-3·S-6·S-7 이 C 산출물을 쓴다(D1). `sp3a-done` 뒤 머지라 A 소유 `scripts/e2e-local.mjs`(B·C·D 가 단계를 더함)·D 소유 `actions/accounts.ts` 를 창 직전 한 번만 rebase 한다 |
| UI-3 | UI-2 머지 | SP4 체크포인트 직후 창(D46) + 사용자 눈확인 게이트 | 설정 화면 기능이 C 산출물이고, 두 키 등록이 SP3a 의 "14키" done_when 뒤여야 한다 |

```text
레인 A ─[B]───────────────────[C]────────────[D]──[마감 sp3a-done]──[SP4 스펙·DB·도메인]──[SP4 셸·화면 과제]
          │창①                   │창②             │창③                                     ↑ UI-2 머지 뒤 브랜치(D47)
레인 B [UI-0]─[UI-1 ui/sp3-tokens]┼─[UI-2a 경로·IA + 셸 컴포넌트]┼─[UI-2b 셸·C 파일 과제]─┼[창③ UI-2a→UI-2b]─[UI-3 · 사용자 게이트 · sp3b-done]─[SPU1 …]
```

- **main 쓰기는 창에서만 한다**(D46). 레인 B 브랜치는 창 직전 최신 main 으로 rebase 하고, 체크포인트 증거(공통 묶음·E2E·성능·눈확인·트레일러 일시)는 그 rebase **뒤** 트리에서 새로 만든다. 겹치는 파일은 먼저 머지한 쪽이 기준이고 나중 쪽이 rebase 한다(개정 §6.1-5).
- **C 가 UI-1 보다 먼저 착수·머지되는 경우**(일정상 유력 — 비평 lanes L-I4): ① `no-raw-color` 허용 목록은 UI-1 이 마지막으로 rebase 한 main 에서 다시 잰다 — C 의 새 파일 위반은 UI-1 이 고치지 않고 사유 '주인 C — UI-3 에서 정리(§6.4)'로 넣는다(E26) ② C 의 새 화면은 옛 토큰 이름을 써도 별칭(§4.1 블록 4)으로 새 색이 된다 — UI-1 눈확인 행에 `/w/<s>/settings`·`/p/<pid>/settings` 를 넣는다 ③ C 의 `AccentEditor` 테스트가 시작 임계(20°·0.08) 경계의 색을 표본으로 쓰면 UI-1 의 임계 조정 뒤 깨진다(알림 8).
- **UI-2 준비를 B 전에 하지 않는다**(D1). §10.1 #1 의 대안을 고르면 준비 파일은 main 에 이미 있는 것만 import 한다 — `src/lib/workspace/{resolve,list,current,paths,legacy}.ts`, `src/lib/prefs/split.ts`, `src/lib/data/portal.ts` v0(모듈 판정은 `ReadonlySet<ModuleId>` 인자로 받는 조립부만), `src/components/app/{PageHeader,PageFrame,RightRail}.tsx`, 그 단위 테스트. `@/lib/nav/registry`(`NavCaps`·`NavGroup`·`navFor`)·`moduleSetFor`·CR-5 에 기대는 파일(`authz/navCaps.ts`·`nav/{active,switchTarget}.ts`·`modules/effectiveMany.ts`·전환기·계정 메뉴·드로어·`navIcons.ts`)은 대안에서도 B 뒤다(비평 lanes L-I1).
- **SP4 경계**(D47): SP4 의 셸·레이아웃·화면 과제는 UI-2 머지 뒤 main 에서 브랜치를 자른다.
- `ui/**` push 는 CI 를 돌린다(`.github/workflows/ci.yml:3`). `sp3b/*` 는 CI 가 없다.
- 개정 문서는 SP3b 가 직접 고치지 않는다. 고칠 곳은 마감의 "반영 지시" 목록(§7)으로 모으고, 개정 문서 커밋은 한 번에 한 레인만 한다(실측 bounds §9 끝).

### 2.3 소유 파일

파일마다 주인은 하나다. 주인은 그 파일을 만들거나 SP3b 에서 처음 고치는 Phase 다. 레인 A 가 가진 파일을 SP3b 가 이어 고치는 것은 §2.4 에 적는다. 이 표의 수치(리터럴·테스트 파일 수)는 `b4283c0` 기준이고 C 체크포인트 뒤와 `sp3a-done` rebase 때 다시 잰다(§5.7).

| Phase | 소유 파일 |
|---|---|
| UI-0 | `docs/baseline/sp3b-ui0.md`, `scripts/perf-grid.mjs`, `tests/scripts/perf-grid.test.ts`, `scripts/ui-capture.mjs`·`scripts/ui-capture.routes.json`·`tests/scripts/ui-capture.test.ts`(D48) |
| UI-1 | `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/theme/policy.ts`(새), `src/components/providers/ThemeProvider.tsx`, `src/components/app/{PrefsSync,HeaderChrome,Sidebar,InboxPanel,ShellStateProvider}.tsx`(UI-1 몫 — 테마 선택·밝은 표면·배지 토큰·죽은 코드), `src/lib/prefs/sync.ts`, `src/lib/domain/types.ts`(`UiPrefs.theme`), `src/components/account/AccountView.tsx`, `src/components/minutes/MarkdownView.tsx`, `src/components/ui/{Button,IconButton,Field,StatusMessage}.tsx`(새), `src/components/ui/{StatusPill,KpiCard,SectionCard,Modal,PageHero,Toast,Tooltip}.tsx`, `src/app/login/page.tsx`, `src/app/not-found.tsx`, `src/app/invite/[token]/page.tsx`, `src/components/minutes/ShareViewer.tsx`, 히어로 전제 마크업 파일 가운데 C 소유가 아닌 것(`src/components/home/NewProjectModal.tsx` 한 줄·`src/components/agent-hub/{AgentFrame,AgentTabs}.tsx`·`src/components/wiki/{WikiSearch,WikiReindexButton}.tsx` — §4.4), 채움 배경 + `text-white` 줄과 `hover:-translate` 를 가진 파일 가운데 C 소유가 아닌 것(D12·§4.5 — 착수 때 grep 으로 파일마다 주인을 적어 확정), `src/components/wbs/WbsGanttSheet.tsx`(`.app-backdrop`·오늘 칩·전체 화면 층), `src/components/chat/ArchiveChatPanel.tsx`(층 한 줄 — D56), `src/components/chat/AssistantChat.tsx`(그라데이션 세 줄·`text-white` 만 — 파일 주인은 B), `src/app/(app)/(global)/admin/ui-states/page.tsx`(새 — 레이아웃 없는 라우트 그룹에 처음부터 둔다. UI-2b 가 `(global)/layout.tsx` 를 더할 때 파일 이동이 없다), `src/components/admin/UiStatesShowcase.tsx`(새), `src/lib/authz/uiStatesAccess.ts`(새), `scripts/smoke-prod.mjs`(`FLOOR` 를 건드리면 이유와 함께), `tests/css/{contrast-tokens,no-raw-color,display-cascade,global-rule-layers}.test.ts`, `tests/ui/{theme-write,theme-provider,account-theme,ui-states-page}.test.tsx`, `tests/lib/{theme-policy,prefs-sync}.test.ts`, `tests/minutes/mermaid-render-config.test.tsx`, `tests/authz/ui-states-access.test.ts`, `tests/components/{status-message,button,field}.test.tsx`, `docs/baseline/sp3b-ui.md` |
| UI-2a | 라우트: `src/app/page.tsx`(리졸버), `src/app/(app)/w/[slug]/{page,my-work/page,meetings/page,minutes/page,minutes/[id]/page,agents/page,portfolio/page,usage/page,admin/accounts/page,admin/teams/page}.tsx` 와 옮기는 `loading.tsx`(계정·공용 팀은 `(app)/admin/loading.tsx` 복제), `src/app/(legacy)/{meetings,minutes,minutes/[id],agents,portfolio,usage,admin/accounts,admin/teams}/route.ts`(새, 여덟), 옮기는 옛 `page.tsx` 여덟(삭제), `src/components/workspace/NoWorkspaceView.tsx`(새 — 소속 0 화면), `src/components/app/{PageHeader,PageFrame}.tsx`(새 — 홈 v0·내 업무 v0 가 쓴다. UI-2b 가 이어 고친다). 워크스페이스: `src/lib/workspace/{resolve,current,list,paths,legacy}.ts`(새 — `resolve.ts` 에 `workspaceRefById`), `src/lib/authz/{navCaps,workspaceScope}.ts`(새), `src/lib/authz/{agentsAccess,teamsAccess,accountsAccess}.ts`(`accountsAccess` 는 새 파일 — 지금 계정 화면은 페이지가 `actor.isSuperuser` 를 직접 본다(`admin/accounts/page.tsx:23`)), `src/lib/authz/workspace.ts`(`resolveSoleWorkspaceId` 는 `api/v1` 용으로 남는다). 내비 파생: `src/lib/nav/{active,switchTarget}.ts`(새), `src/app/api/nav/switch-target/route.ts`(새, D41), `src/lib/modules/effectiveMany.ts`(새, D39). 설정: `src/lib/prefs/{prefsWorkspace,split}.ts`, `src/app/actions/{preferences,inbox,notifications}.ts`, `src/app/api/prefs/route.ts`, `src/lib/domain/types.ts`(`UiPrefs` 키), `src/app/(app)/layout.tsx`(`getUiPrefs` → `getAccountPrefs` 몇 줄 — 셸 무변경), `supabase/migrations/0013_account_preferences.sql`·`supabase/rollbacks/0013_account_preferences_rollback.sql`(마이그레이션 커밋), `supabase/rehearsal/0013_account_preferences_seed.sql`(별도 커밋). 데이터·표시: `src/lib/data/portal.ts`(v0), `src/components/dashboard/DashboardView.tsx`(교차 모듈 표시 — B 판정 P20, '이 프로젝트 회의록' 링크 — D53), `src/components/meetings/MeetingsView.tsx`(같은 링크 한 줄), 회의록 목록·탐색기의 `?project=` 거르기(D53). 파생: `src/lib/domain/usageMenu.ts`, `src/lib/ai/chat/{verifier,deep-links}.ts`(두 형식 허용 — `kanbanHref` 는 UI-3), `src/components/minutes/linkify.tsx`. 리터럴: 실측 routes 부록 A 의 파일 가운데 셸 파일(`Sidebar`·`HeaderChrome`·`ProjectNavigationContext`)을 뺀 것(§5.7). 문서: `README.md:24`·`kit/README.md:63,73`(경로 표기). 테스트: `tests/routes/legacy-redirects.test.ts`, `tests/invariants/{route-literals,sole-workspace}.test.ts`, `tests/workspace/*`, `tests/prefs/*`, `tests/nav/{active,switch-target}.test.ts`, `tests/api/switch-target-route.test.ts`, `tests/authz/nav-caps.test.ts`, `tests/data/portal-v0.test.ts`, `tests/modules/effective-many.test.ts`, `tests/domain/usage-menu.test.ts`(다시 씀), `tests/chat/infer-domain.test.ts`, `tests/minutes/minutes-project-filter.test.ts`, `tests/rls/account-preferences.test.ts`, 옛 경로를 단언하는 테스트(약 42파일)의 고침, 페이지를 경로로 import·read 하는 테스트(§5.7). 기록: `scripts/e2e-sp3b.mjs`(임시 — `ui/sp3-menu` 안에서만 쓰고 main 에 넣지 않는다, §8.3) |
| UI-2b | 레이아웃: `src/app/(app)/layout.tsx`(셸 제거·공급자 층), `src/app/(app)/p/[projectId]/layout.tsx`, `src/app/(app)/(global)/{layout,loading,error}.tsx`(새), `src/app/(app)/w/[slug]/{loading,error}.tsx`(새), `src/app/(app)/p/[projectId]/error.tsx`(새), `src/app/(app)/error.tsx`(셸 없는 화면 전체 오류로), `(app)/loading.tsx`(삭제), `(app)/admin/loading.tsx`(삭제 — `(global)/admin/llm-config/loading.tsx` 로), `/account`·`/admin/llm-config` 의 `(global)` 이동. C 파일 과제: `src/app/(app)/w/[slug]/layout.tsx`(C)에 셸, `(app)/projects/page.tsx`(C) → `w/[slug]/projects/page.tsx` + `loading.tsx`, `src/app/(legacy)/projects/route.ts`(아홉째 스텁), `src/components/ui/BrandMark.tsx`(C). 셸: `src/components/app/{AppShell,GlobalBar,WorkspaceNav,ProjectNav,ContextBreadcrumb,RightRail,WorkspaceSwitcher,ProjectSwitcher,AccountMenu,MobileNavDrawer,ShellScope,ScopeContext}.tsx`·`navIcons.ts`(새), `Sidebar.tsx`·`HeaderChrome.tsx`·`ShellStateProvider.tsx`·`ProjectPageShell.tsx`(어댑터)·`DegradedNotice.tsx`·`UsageTracker.tsx`, `ProjectNavigationContext.tsx`·`ProjectTabs.tsx`·`HeaderAnnouncementTicker.tsx`(삭제), `src/components/ui/PageHero.tsx`(어댑터), `src/components/agent-hub/AgentFrame.tsx`(D18 예외), sticky 13파일(D54), `src/components/wiki/WikiSearchResults.tsx`(D17 ② 위반을 조건부 렌더로), `src/components/report/ReportModal.tsx`(h1 → h2). 로고·accent: `src/lib/settings/accentCss.ts`(새, D23), `src/app/{icon,apple-icon}.tsx`(S-6 결과에 따라). 초안 키: `src/lib/drafts/wikiDrafts.ts`, `src/components/wiki/WikiDocumentEditor.tsx`, 로그아웃 정리 경로(D52). 파생 나머지: `src/components/chat/BotPageContextProvider.tsx`(`workspaceId`). 문서·훅: `.githooks/pre-push`(`UI_RE`), `CLAUDE.md`(UI 위험 목록), `scripts/smoke-prod.mjs`('레이아웃 급소' 라벨). 테스트: `tests/invariants/{page-h1,scroll-owner}.test.ts`, `tests/shell/*`(`nav-consumption.test.tsx` 포함 — E37), `tests/api/shell-route.test.ts`, `tests/drafts/wiki-draft-key.test.ts`, 셸 테스트 약 31파일의 재작성·삭제(실측 shell §11), `tests/ui/app-layout-teams.test.tsx`·`tests/authz/project-layout-hiding.test.tsx`(레이아웃 import·2차 조회 mock). 기록: `docs/baseline/sp3b-perf.md` |
| UI-3 | `src/lib/domain/authz.ts`(`inheritedProjectRole` — D37), `src/lib/data/portal.ts`(v1 확장), `src/lib/portal/widgets.ts`(새 — `PORTAL_WIDGETS`), `src/app/(app)/w/[slug]/{page,projects/page}.tsx`(v1), `src/components/portal/**`(새), `src/app/(app)/p/[projectId]/wbs/page.tsx`(보기 전환), `src/components/wbs/ViewSwitch.tsx`(새), 칸반 흡수(D36 — `src/app/(app)/p/[projectId]/kanban/{page,loading}.tsx` 삭제, `src/app/(legacy)/p/[projectId]/kanban/route.ts`(새, 열째 스텁), `src/components/kanban/KanbanBoard.tsx`(`group` 쿼리·프레임 props), `WbsRealtimeRefresh` 이관, `InboxPanel.tsx`·`verifier.ts`·`deep-links.ts` 의 칸반 경로, `tests/ui/kanban-realtime.test.ts`), `src/app/(app)/p/[projectId]/members/page.tsx`(실효 역할 열), `src/components/settings/{PortalWidgetsEditor,ViewsDefaultEditor}.tsx`(새), 설정 두 화면의 시각 패턴(C 파일 이어 고치기 — §2.4), §6.6 의 화면(`/account`·`/w/[slug]/admin/accounts`·`/invite/[token]` — UI-1·UI-2 가 먼저 고친 파일을 이어 고친다), `tests/portal/*`, `tests/wbs/view-switch.test.tsx`, `tests/ui/members-effective-role.test.tsx`, `tests/authz/inherited-role.test.ts`, `tests/settings/{portal-widgets,views-default}-def.test.ts`, `tests/components/settings-status.test.tsx` |
| 마감 | `docs/baseline/sp3b-e2e.md`, `.superpowers/sp3b/progress.md`(원장), 태그 |

### 2.4 이어 고치는 파일·레인 A 에 알릴 것·UI 위험 파일

**레인 A 가 가진 파일을 SP3b 가 이어 고친다**(모두 그 Phase 의 main 체크포인트 뒤, 나중 쪽 rebase):

| 파일(주인) | SP3b 단계와 내용 |
|---|---|
| `src/lib/i18n/dict/common.ts`·`common.en.ts`(B 가 이어 고침) | UI-1 테마 3단 문구, UI-2b 라벨 문구(D30) |
| `tests/invariants/module-page-gates.test.ts`(B, C 가 `w/[slug]/settings` 제외를 더함) | UI-1 — 제외 목록 `admin/ui-states`(B 가 먼저면, 사유 "플랫폼 진단 — 모듈 밖"). UI-2a — ① 관문 앞 허용 호출 목록(B 과제 11 의 `ALLOWED_BEFORE`/`PRE_GATE_OK`)에 `loadWorkspaceScope` 를 더한다(사유: 슬러그 판정 — E19) ② 새 페이지 종류는 만들지 않는다 — `routeOf` 가 괄호 그룹만 떼므로 `/w/[slug]/**` 는 기존 `'row'` 분류(`{ workspaceId }`)다 ③ `PRE_GATE` 키(`(app)/minutes/[id]/page.tsx`)와 `EXCLUDED` 의 옮긴 경로(`existsSync` 로 검사된다)를 **이동 커밋과 같은 커밋에서** 새 경로로 바꾸고, 루트 `page.tsx` 사유를 '리졸버 — 쿠키·소속으로 redirect' 로 바꾼다 ④ `LEGACY_GLOBAL_PREFIXES`·`'global'` 분기·그 단언을 지운다 ⑤ 제외 목록에 `w/[slug]/page.tsx`·`my-work`·`admin/{accounts,teams}`(사유 "셸 — 모듈 밖")를 더한다. UI-2b — `projects`·`(global)/account/**`·`(global)/admin/{llm-config,ui-states}` 로 경로를 옮긴다. 이 불변식이 §5.2 의 "첫 await `loadWorkspaceScope` → B 관문" 순서를 기계로 본다(비평 lanes L-I10·feasibility m7). 이름·모양은 머지된 B 로 계획에서 확인한다 |
| `src/lib/modules/registry.ts`(A, B 가 이어 고침) | UI-2a — 전역 `routePrefixes` 를 워크스페이스 상대 조각으로, `LEGACY_GLOBAL_PREFIXES` 삭제. `tests/modules/registry.test.ts` 의 모양 단언 동반 |
| `src/lib/modules/{gate,pageGate,aiAvailable}.ts`(B) | UI-2a — `null` 스코프 호출부를 명시 워크스페이스로(D26). 함수 자체는 `api/v1`(SP7)을 위해 남긴다 |
| `src/app/actions/{meetings,minutes,agentSeatmap}.ts`, `src/lib/data/{meetings,agentSeatmap,portfolio}.ts`, `tests/gates/manifest.ts`(B) | UI-2a — 워크스페이스 인자(D26·D21), 매니페스트 항목·거부 표본, 새 라우트 `api/nav/switch-target` 등록(D41 — `CORE_ROUTE_ALLOW` 포함) |
| B 과제 20 의 세션 라우트 `src/app/api/{track,chat/context,chat/command,chat,chat/stream,chat/v2/stream,minutes/export}/route.ts`(B) | UI-2b — 요청의 `workspaceId`(§5.8. 보내는 쪽이 `ShellScope` 를 읽게 된 뒤) |
| `src/app/api/shell/route.ts`(B) | UI-2b — 계약 변경(D34) |
| `src/components/chat/AssistantChat.tsx`(B 과제 24) | UI-1 — 그라데이션 세 줄과 `text-white` 15건. UI-2b — FAB·전역 바 아이콘·우측 레일·전체 화면 레일 자리(D56)·현재 워크스페이스의 프로젝트 목록(D33) |
| `src/app/(app)/p/[projectId]/**/page.tsx`(B 관문 줄) | UI-2a — 개요 카드의 교차 모듈 표시(B 판정 P20)·'이 프로젝트 회의록' 링크(D53). UI-2b — 채움형 `variant`. UI-3 — `/kanban` 삭제(D36). 관문 줄의 위치(첫 데이터 await)를 보존한다 |
| `src/app/(app)/w/[slug]/layout.tsx`·`src/app/(app)/projects/page.tsx`·`src/components/ui/BrandMark.tsx`(C) | UI-1 은 고치지 않는다(`projects/page.tsx` 는 `hero-*` 별칭으로만 밝아진다). UI-2b(C 파일 과제) — 레이아웃에 셸(슬러그 조회는 `resolveWorkspaceBySlug` 로), 목록 이동과 마크업 정리(히어로·11px uppercase·hover 이동), 포털 경로 판정 삭제·셸 로고(★8) |
| `src/app/(app)/w/[slug]/settings/**`·`src/app/(app)/p/[projectId]/settings/page.tsx`·`src/components/settings/{SettingsShell,ConfigStateNotice,MenuOrderEditor,…}.tsx`(C·D) | UI-2b — `w/[slug]/settings/page.tsx` 의 첫 await 를 `loadWorkspaceScope` 로(C 가 레이아웃 판정에 기댔으면 — E19), `MenuOrderEditor` 의 "화면 반영은 다음 셸 갱신부터" 문구 삭제(SP3a §9 #6), 설정 저장 바 루트의 `data-save-bar` 속성(C 가 달지 않았으면 — 알림 13). UI-3 — 시각 패턴, `ConfigStateNotice` → `StatusMessage`, 두 키 편집기 |
| `src/components/settings/StageCreditSlider.tsx`·`src/components/home/NewProjectModal.tsx`(A, C 가 이어 고침) | UI-1 — 한 줄씩(`text-white`·히어로 트리거). 나중에 머지하는 쪽이 rebase 한다 |
| `src/lib/settings/{defs/workspace,defs/project,catalog-meta,validateConfig}.ts`, `tests/settings/registry.test.ts`, `docs/settings-catalog.md`(A·C) | UI-1 — `PERSONAL_PREFS` 의 테마 설명 한 줄(C 뒤라면 `npm run catalog:write`). UI-2a — `PERSONAL_PREFS` 에 `startPage`·`favoriteProjectIds`·`recentProjects`·`portalHiddenWidgets` 추가, `heroCollapsed`·`lastProjectId` 삭제, 범위 열. UI-3 — 두 키 등록("정확히 14키" → 16키), `validateConfig.ts`(`validateProjectConfig`)의 `views.default.wbs='board'` ↔ `kanban` 교차 검사와 그 테스트, `npm run catalog:write` |
| `src/lib/settings/accent.ts`·`tests/settings/accent.test.ts`(A) | UI-1 — 거부 임계값 조정·고정(SP3a D30, 알림 8) |
| `src/app/actions/accounts.ts`(D) | UI-2a — `revalidatePath` 넷(D8). D 체크포인트 뒤 rebase 에서 맞춘다 |
| `scripts/e2e-local.mjs`·`scripts/lib/e2e.mjs`·`tests/scripts/e2e.test.ts`(A, B·C·D 가 단계를 더함) | UI-2b 마무리(창 ③ 직전 rebase 뒤) — 옛 경로 호출(15~19곳) 교체, `e2e-sp3b.mjs` 단계 합치기(§8.3), 새 오류 경계 셋을 드리프트 테스트(`e2e.test.ts:326-335`)의 원본 목록에 더한다. `PAGE_MARKERS` 의 표지 문구('화면을 불러오지 못했습니다' 등)가 새 `StatusMessage` 표준 문구와 겹쳐 정상 화면의 부분 실패 카드를 오류로 잡으면 표지를 `data-page-error` 속성으로 바꾼다 |
| `scripts/perf-baseline.mjs`(A, B 과제 27) | 사용자 조회 DSN 을 `LOCAL_DB_URL` 우선으로 — B 과제 27 안에서 넣어 달라고 요청한다(알림 11). 넣지 않으면 UI-2b 가 한 줄(D32) |
| `tests/invariants/project-page-gates.test.ts`(C) | C 가 `PAGES_ROOT` 에 `w/[slug]` 를 넣으므로 UI-2a 의 옮긴 페이지가 C 뒤 rebase 에서 자동으로 들어간다. 판정 모양(`loadWorkspaceScope` 대 `isHiddenProject`)이 맞지 않으면 `workspace-page-gates` 로 나눈다 |
| `CLAUDE.md`(A, B·C·D 가 덧붙임) | UI-2b — UI 위험 목록(`UI_RE` 와 같은 커밋) |
| `tests/nav/nav-for.test.ts`(B) | 고치지 않는다 — 셸 소비 케이스는 `tests/shell/nav-consumption.test.tsx`(E37) |

**레인 A 에 한 줄씩 알린다** — 스펙 승인 **즉시** 원장에 적고 레인 A 컨트롤러에게 전달한다(7·10·11 은 진행 중인 B 과제 26~28 에 걸린다):

1. UI-1 이 C 보다 먼저 머지되면 `tests/css/no-raw-color.test.ts` 가 C 의 새 설정 컴포넌트(`SettingsShell`·`ModuleToggleEditor`·`AccentEditor`·`LogoEditor`·`ConflictCompare`·`ConfigStateNotice`)에도 걸린다 — className 에 `#hex`·`rgb(`·`z-[` 금지. `AccentEditor` 미리보기처럼 계산된 색은 `style` 속성으로 넘긴다(테스트는 className 만 본다). C 가 먼저면 UI-1 이 재기준선에서 그 파일을 사유와 함께 목록에 넣는다(E26).
2. B·UI-1 가운데 나중에 머지하는 쪽이 페이지 관문 불변식 제외 목록에 `admin/ui-states` 를 넣는다.
3. Phase B 판정 P18 의 "SP3b 가 `profiles.ui_prefs` 를 채택하면 그 `0013`" 경로를 레인 A 가 닫아 주기 바란다(판정은 레인 A) — SP3b 는 새 표 `account_preferences` 를 쓰고 이월을 담지 않는다(D9). `people.email` 칼럼 권한 회수는 레인 A 의 다음 마이그레이션(SP3a 마감 또는 SP4 첫 마이그레이션)이 담는다.
4. UI-2b 가 `src/app/(app)/p/[projectId]/layout.tsx` 를 `UI_RE` 에 넣는다. 그 뒤 SP4 의 팀 주입 변경(정본 §3.2.5 끝 문단)은 `ui/` 브랜치와 트레일러가 필요하다.
5. SP5 Phase A 의 워크스페이스 시간대 이행 소비처 목록에 `src/lib/data/portal.ts`('오늘' = `seoulToday`)를 더한다.
6. **SP4 경계**(D47): SP4 는 스펙·계획·마이그레이션·도메인 과제를 `sp3a-done` 직후 시작해도 되지만, `(app)/layout.tsx`·`p/[projectId]/layout.tsx`·`src/components/app/*`·`p/[projectId]/**/page.tsx` 의 화면 이행을 고치는 과제는 UI-2 머지 뒤 main 에서 브랜치를 자른다.
7. **main 쓰기 창**(D46): 레인 B 는 레인 A 체크포인트 직후 창에서만 main 에 넣는다. 레인 A 는 다음 Phase 브랜치를 창이 닫힌 뒤의 main 에서 자른다.
8. UI-1 이 accent 거부 임계값을 표본 10종으로 다시 정한다(SP3a D30). C 의 `AccentEditor`·저장 테스트는 임계 경계에 걸리는 색을 표본으로 쓰지 않는다. UI-1 은 `StageCreditSlider`·`NewProjectModal`·`catalog-meta.ts` 에서 한 줄씩 겹친다.
9. **마이그레이션 번호**: UI-2 가 SP4 의 첫 마이그레이션보다 먼저 머지되면 `0013` 을 받고 SP4 가 한 칸씩 민다(개정 §6.3). SP4 계획의 번호는 머지 직전에 확정하고, 테스트·리허설·문서가 파일명을 번호로 참조하지 않게 한다. 레인 A 가 SP3a 마감에 이월 마이그레이션을 넣으면 SP3b 가 번호를 옮긴다.
10. **무거운 실행 공유 잠금**(§2.5-7): B 과제 19·24·26·27·28 과 C·D 의 같은 종류 실행도 `/Users/jerry/D-Flow-wt/.heavy.lock` 을 쓴다. 레인 A 가 받아들이기 전까지는 컨트롤러가 두 레인의 무거운 과제를 동시에 디스패치하지 않는다.
11. `scripts/perf-baseline.mjs` 의 사용자 조회 DSN 을 `LOCAL_DB_URL` 우선으로 하는 한 줄을 B 과제 27 안에서 넣어 달라(D32).
12. `getComputedWbs`(`src/lib/data/wbs.ts:34-35`)의 `wbs_items`·`item_owners` 무범위 조회가 `max_rows = 1000` 에서 200 + 잘린 배열로 끝난다(원칙 ① 위반, `item_owners` 는 프로젝트 필터도 없다 — 소유 SP4/SPU2). `getPendingApprovalCount`(`agentApprovals.ts:57-58`)도 같은 상한의 잠재 결함이다.
13. C 의 설정 저장 바 루트에 `data-save-bar` 속성을 달아 달라(D33 — FAB 숨김 관찰). C 가 새로 만드는 옛 경로 리터럴(설정 페이지의 비관리자 redirect, '초대' 범주의 공용 팀 링크)은 한 상수로 모아 두면 UI-2 의 교체가 한 곳이 된다.

**UI 위험 파일과 트레일러**(CLAUDE.md, 개정 §6.5.4):

- UI 위험 파일(`globals.css`·`src/app/layout.tsx`·`(app)/layout.tsx`·`src/components/app/*`)을 고치는 커밋은 `ui/sp3-*` 브랜치에만 있다. UI-2b 가 `UI_RE` 에 `src/app/\(app\)/w/\[slug\]/layout\.tsx`(C 가 이미 더했으면 뺀다 — SP3a §10.1)·`src/app/\(app\)/p/\[projectId\]/layout\.tsx`·`src/app/\(app\)/\(global\)/layout\.tsx` 를 더하고 CLAUDE.md UI 위험 목록을 **같은 커밋**에서 고친다(개정 §5.12.2 의 둘 + D2 가 만든 셋째).
- 화면을 바꾸는 커밋(`src/components/**`·`page.tsx`·`layout.tsx`·`globals.css`)은 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>` 을, 화면이 달라지지 않는 커밋은 `Preview-checked: n/a — <사유>` 를 단다(SP3a §2.3 규칙). 체크포인트는 개정 §6.5.4 의 확인 화면을 모두 적은 빈 커밋 하나로 닫는다(`b4283c0` 관례). **체크포인트 빈 커밋은 마지막 rebase 뒤** 만들고 그 `Preview-checked` 시각은 rebase 시각보다 뒤다. rebase 로 다른 레인의 화면 파일이 섞였으면 그 Phase 의 눈확인 행을 rebase 된 머리에서 다시 돌린다(D48 — merge-base 를 새로 찍는다).
- 원격 Preview 가 없으므로 눈확인은 레인 B 의 **프로덕션 빌드 서버**(`http://127.0.0.1:3201`, D48)에서 한다. 반응형 안전망(`globals.css` 끝 unlayered 블록)은 한 글자도 고치지 않고, 새 토큰 블록은 그 **앞**(지금 토큰 자리)에 둔다 — 파일 끝에 붙이면 `smoke-prod` 의 "CSS 꼬리 도달" 전제가 흔들린다(실측 tokens §4.2-1). 상태 변형 display 유틸·컨테이너 쿼리 + 반응형 display 겹침·조건부 `hidden` + 안전망 클래스를 쓰지 않는다(D17). `@theme` 에 `--breakpoint-*` 를 더하지 않는다(1400·1440 경계는 `matchMedia` 훅 — D55).

**공통 묶음**(모든 체크포인트): 레인 B 워크트리에서 래퍼(§2.5-0)로 `npm run test -- --maxWorkers=2`·`npm run lint`·`npm run typecheck`·`npm run build` 초록 → 브랜치 push(사람 확인) → 창에서 main 머지·push(사람 확인) → CI 초록. **DB 묶음**(DB 경로를 건드리는 UI-2a·UI-2b·UI-3): 래퍼로 `db:reset` → `dev:bootstrap` → `test:rls`(건너뜀 0)와 `settings:verify`. 둘 다 무거운 실행이라 공유 잠금(§2.5-7)을 잡는다.

### 2.5 레인 B 두 번째 로컬 Supabase 스택

사용자 결정 L-2 의 스택이다. 원본 DB 금지(`scripts/lib/targets.mjs`)는 그대로다 — `127.0.0.1` 은 포트와 무관하게 local 로 분류된다. 이 절의 명령은 모두 레인 B 워크트리 `/Users/jerry/D-Flow-wt/lane-b` 가 cwd 다. 에이전트 셸은 호출마다 cwd 가 메인 체크아웃(`/Users/jerry/D-Flow` — 레인 A·사용자 :3000·Codex 가 함께 쓰는 스택)으로 돌아가므로, 스택을 가르는 것은 사람의 주의가 아니라 아래 래퍼다(비평 lanes L-B2).

| # | 절차 | 이유 |
|---|---|---|
| 0 | **래퍼.** 레인 B 의 스택·DB·서버 명령은 리포 밖 `/Users/jerry/D-Flow-wt/lane-b-run.sh <명령…>` 로만 돈다. 래퍼는 차례로 ① `cd /Users/jerry/D-Flow-wt/lane-b` ② `supabase/config.toml` 에 `project_id = "d-flow-lane-b"`·`port = 54421`·`port = 54422` 줄이 있는지 ③ `git ls-files -v supabase/config.toml` 의 첫 글자가 `S`(skip-worktree)인지 ④ `set -a; . /Users/jerry/D-Flow-wt/lane-b.env; set +a` 뒤 `RLS_DATABASE_URL`·`LOCAL_DB_URL` 이 `@127.0.0.1:54422/` 를 담는지, `.env.local` 이 있으면 그 `NEXT_PUBLIC_SUPABASE_URL` 이 `:54421` 인지(`env:local` 은 그 파일을 고치는 명령이라 이 한 가지만 건너뛴다) ⑤ 대상 명령이면 공유 잠금(7)을 잡는다 — 하나라도 아니면 `exit 1`, 모두 맞으면 인자를 `exec` 한다. **래퍼를 거쳐야 하는 명령**: `npm run db:start\|db:stop\|db:reset\|env:local\|dev:bootstrap\|dev\|build\|start\|test:rls\|settings:verify\|smoke:prod`, 모든 `supabase …`, `node scripts/{perf-grid,perf-baseline,ui-capture,e2e-sp3b,e2e-local}.mjs`, `docker exec supabase_db_d-flow-lane-b …`. 레인 B 구현자 브리프에 "위 명령을 래퍼 없이 부르지 않는다"를 적는다. rebase·브랜치 전환 뒤에는 `lane-b-run.sh true` 로 ②③ 을 다시 확인한다 | `db:start`·`db:reset`·`db:stop` 은 `supabase start\|db reset\|stop` 이고 대상은 cwd 의 `config.toml` 이 정한다. `cd` 를 빠뜨린 `db:reset` 한 줄이 공유 DB 의 계정과 데이터를 지우고, `db:stop` 은 사용자 스택을 내린다. `RLS_DATABASE_URL` 확인만으로는 supabase CLI·`env:local`·`dev:bootstrap`·`perf-grid`(`resolveTarget('local')` 은 값이 없으면 `LOCAL_DSN` 54322 로 넘어간다)를 막지 못한다. skip-worktree 비트는 checkout·rebase 때 조용히 덮일 수 있다 — 덮이면 ②③ 이 멈춘다 |
| 1 | **준비(1회).** 레인 B 워크트리에서 `npm ci`(`prepare` 가 `core.hooksPath` 를 공유 설정에 같은 값으로 다시 쓴다 — 무해). 메인 체크아웃의 `node_modules` 를 심볼릭 링크하지 않는다. `.env.local` 은 `cp /Users/jerry/D-Flow/.env.local /Users/jerry/D-Flow-wt/lane-b/.env.local` 뒤 래퍼로 `env:local` 을 돌린다(Supabase 세 키와 APP_URL 만 바뀐다 — `mergeEnv`. LLM 키·SMTP 가 남아 AI 레일·탐침의 모습이 메인과 같다) | 레인 B 워크트리에는 `node_modules`·`.env.local` 이 없다. 링크하면 레인 A 가 의존성을 바꿀 때 버전이 갈라지고 Next 의 모듈 해석이 워크트리 밖 실경로를 본다(비평 feasibility m2 — lanes L-m7 의 링크 안은 채택하지 않는다) |
| 2 | 레인 B 워크트리의 `supabase/config.toml` 을 로컬에서만 바꾼다: `project_id = "d-flow-lane-b"`, 포트 +100(api 54421 · db 54422 · shadow 54420 · pooler 54429 · studio 54423 · inbucket 54424 · analytics 54427 · edge_runtime inspector 8183), `[studio]`·`[inbucket]`·`[edge_runtime]` `enabled = false`(analytics 는 이미 꺼짐), `[api] max_rows = 20000`(D51 — 기록에 적는다). 바꾼 뒤 `git update-index --skip-worktree supabase/config.toml`. rebase 가 이 파일을 건드리면 그때만 `--no-skip-worktree` 로 풀고 다시 건다 | 리포 파일이라 dirty 로 커밋에 섞일 수 있다. `git add -A` 금지가 1차 방어, skip-worktree 가 2차, 래퍼 ②③ 이 확인이다. 꺼 둔 서비스의 포트도 옮겨야 디버깅 중 켰을 때 레인 A 스택과 부딪히지 않는다(비평 lanes L-m6) |
| 3 | DB 를 쓰기 시작할 때만 래퍼로 `supabase start -x studio,postgres-meta,mailpit,imgproxy,edge-runtime,logflare,vector,supavisor`(realtime·storage·kong·gotrue·postgrest 는 남긴다 — S-3·로고·첨부), 끝나면 래퍼로 `supabase stop`. 기동 뒤 `docker stats --no-stream` 을 원장에 적는다 | colima 6GB 안에서 두 스택이 서게. `npm run db:start` 는 인자 없는 `supabase start` 다 |
| 4 | 리포 밖 env 파일 `/Users/jerry/D-Flow-wt/lane-b.env`: `RLS_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres`, `LOCAL_DB_URL=` 같은 값, `E2E_BASE_URL`·`NEXT_PUBLIC_APP_URL`·`SMOKE_URL` = `http://127.0.0.1:3201`, B 체크포인트 전에는 모듈 플래그 8개 `=true`. 래퍼가 싣는다. 프로세스 env 는 `.env.local` 보다 앞선다(Next) — `env:local` 이 쓰는 `NEXT_PUBLIC_APP_URL=http://localhost:3000` 을 덮으려면 3201 서버는 래퍼로만 띄운다 | `tests/rls/harness.ts` 는 `RLS_DATABASE_URL` 이 없으면 상수 `LOCAL_DSN`(54322 — **레인 A DB**)에 붙어 픽스처를 쓰고 지운다. `settings:verify` 도 그 DSN 을 쓴다(실측 bounds §8). B 전의 `env:local` 은 모듈 플래그를 쓰지 않아(`a0fc749` 는 B 브랜치에만) 캡처에서 위키·챗 v2 가 꺼진 채 찍힌다(비평 lanes L-m7) |
| 5 | **앱 원점은 `http://127.0.0.1:3201`** 이다(`localhost` 와 다른 쿠키 항아리). 판정용 서버는 프로덕션 빌드(래퍼로 `npm run build` → `npx next start -p 3201`, D48)이고, `next dev -p 3201` 은 개발 중에만 쓴다. `next build` 전에는 3201 dev 를 내린다(같은 `.next`). 성능 비교의 기준 서버는 스크래치 워크트리의 3202(`h2-done`)·3203(`sp3a-done`)이다(§8.4). 3000(사용자·Codex)·3101·3102(레인 A)는 쓰지 않는다. 사용자 눈확인 안내문에는 "새 Chrome 프로필 또는 시크릿 창에서 `http://127.0.0.1:3201` 을 연다 — `localhost:3000` 로그인과 섞이지 않게"를 적는다 | `@supabase/ssr` 의 쿠키 이름은 `sb-<Supabase URL 호스트 첫 조각>-auth-token` 이라 두 스택 모두 `sb-127-auth-token` 이다. 쿠키는 포트를 가리지 않아 같은 브라우저의 `localhost:3201` 로그인이 `localhost:3000` 세션을 덮는다. `dflow-theme`·`dflow-locale`·`dflow-ws` 도 같다(비평 lanes L-I9·ui-risk I7). `e2eBaseUrl` 은 3000 만 거부한다(`scripts/lib/e2e.mjs:64`) |
| 6 | 레인 B 에서 쓰지 않는 것: `npm run db:diff`(`scripts/baseline-diff.mjs:16` 이 컨테이너 `supabase_db_d-flow` 고정), 수정 전 `scripts/perf-baseline.mjs`, `docker exec supabase_db_d-flow …`(레인 B 계획은 `supabase_db_d-flow-lane-b` 로 적는다), **스크래치 워크트리에서의 `supabase` 명령**(그 `config.toml` 은 리포 그대로 레인 A 다 — 비평 feasibility F-I8) | 레인 A DB 를 읽거나 쓴다 |
| 7 | **무거운 실행은 두 레인이 공유하는 잠금으로 직렬화한다.** 잠금은 리포 밖 `mkdir /Users/jerry/D-Flow-wt/.heavy.lock`(원자적)이고 안에 `owner`(레인·과제)·시각·명령을 적는다. 잡지 못하면 60초마다 다시 시도하고, 끝나면 `rm -rf` 로 푼다. 대상(어느 스택이든): `db:reset`·`test:rls`·`settings:verify`·`next build`·`next start` 측정·E2E·성능 seed·measure·헤드리스 캡처 묶음·전체 `vitest run`. 성능 측정은 잠금에 더해 '조용한 기계'를 확인해 결과표에 적는다(`pgrep -fl 'next (dev\|build\|start)\|vitest'` 에 자기 프로세스만). vitest 는 `--maxWorkers=2`. 레인 A 가 받아들이기 전까지(알림 10)는 컨트롤러가 두 레인의 무거운 과제를 동시에 디스패치하지 않는다 | 호스트 8GiB 에 colima 6GiB — Node 계열(dev 서버·`next build`·vitest·Chromium)은 남은 약 2GiB 에서 돈다. 레인 A 의 무거운 실행은 체크포인트 밖에도 있다(B 과제 19·24·26~28). 레인 A 는 레인 B 원장을 읽지 않으므로 원장 시각만으로는 직렬화되지 않는다(비평 lanes L-I7·feasibility m23) |
| 8 | UI-0·UI-1 은 스키마를 바꾸지 않지만 캡처 시드·`settings:verify`(accent 임계)에 데이터가 필요하므로 스택을 쓴다. 마이그레이션(D9)의 G4 트레일러 `Staging-verified: local db reset <일시>` 는 이 스택의 `db:reset` 이 근거다 | CLAUDE.md G4 |

## 3. UI-0 — 기준선(COM-0)

제품 코드(`src/**`)를 고치지 않는다. 결과는 UI-1 이 바꾸기 전의 모습이고, SPU2 의 Q07·SP9 의 Q01 이 비교 기준으로 쓴다(개정 §5.12.1). UI-0 의 캡처는 **기록**이다 — 각 Phase 의 판정은 D48 대로 그 브랜치의 (merge-base, 머리)를 새로 찍어 비교한다.

### 3.1 `docs/baseline/sp3b-ui0.md` 의 구성

| 절 | 내용 | 원천 |
|---|---|---|
| 라우트 표 | `find src/app -name page.tsx` 31개 + SP3b 가 만들 경로(`/w/[slug]`·`/w/[slug]/my-work`·`/admin/ui-states`·`/w/[slug]/settings` 는 C). 열: 경로·파일·패턴(개정 §5.9.4)·태그(W·S·F·P·O)·셸 의존(`ProjectPageShell` 직접·하위 경유·`main`)·현재 게이트·가시 h1 수(1280×720·390)·SP3b 처분(UI-2a·UI-2b·UI-3)·화면 이행 SP | 실측 shell §5 표를 출발점으로 다시 잰다 |
| 캡처 | 31라우트 × 1440×900·1280×720·768×1024·390×844, **라이트**, `scripts/ui-capture.mjs`(§3.4)로 프로덕션 빌드에서. 계정은 화면마다 볼 수 있는 가장 낮은 등급(일반 멤버 → 워크스페이스 관리자 → 플랫폼 관리자). 파일 `/Users/jerry/D-Flow/.superpowers/qa/sp3b/ui0/<경로>-<크기>.png`(리포 밖)와 sha256(식별용)을 표에 적는다. **기준 커밋은 `b4283c0`** 로 전부 찍고, B 체크포인트 뒤 B 가 바꾼 두 화면(챗 위젯이 보이는 화면 하나, `/p/<pid>/settings`)만 다시 찍어 '델타' 절에 붙인다(비평 lanes L-m9) | D48 |
| 핵심 동작 | 라우트마다 1~3줄 — 무엇을 보고 무엇을 하는가(예: "작업 계획: 행 추가·셀 편집·간트 보기·전체 화면"). UI-1~UI-3 눈확인과 SP9 J1~J3 의 회귀 목록이 된다 | 화면 정독 |
| 1만 행 성능 | `scripts/perf-grid.mjs`(아래)로 잰 수치와 기준 장치(칩·메모리·OS)·Chromium·Node 버전·커밋·스택의 `max_rows`(D51) | §3.2 |
| API 소비처 | 화면별로 부르는 설정 쓰기(`updateProjectSettings`·`updateWorkspaceSettings`·`getSettingsCommandOutcome`), 권한 판정(가드·`*Access.ts` 술어), 인라인 편집 저장(WBS 셀·주간 시트·이슈·회의록 등) 액션 표 | SPU1 의 표면별 채택 순서(개정 §5.8.7)가 입력으로 쓴다 |
| 로컬 스모크 | `SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod` 결과(CSS 크기·규칙·커스텀 프로퍼티 수) — UI-1 이 `FLOOR` 를 건드릴 때의 기준 | `scripts/smoke-prod.mjs` |
| 브라우저 미확인 | Safari·Firefox·실기기 터치·IME·200% 확대·스크린리더 — 이번 기준선이 보지 않은 것 | 개정 §5.12.1 |

### 3.2 `scripts/perf-grid.mjs`

- `seed`: 레인 B 스택의 합성 프로젝트 하나에 service_role 로 WBS 1만 행(깊이 4, 팀 5, 담당 20, 날짜·진척 분포 고정 시드)을 만든다. `measure`: 헤드리스 Chromium 으로 `/p/<id>/wbs` 를 5회 열어 ① 이동 시작 → 첫 행 표시(ms) ② 첫 표시까지 긴 작업 합(ms) ③ 1,000행 세로 스크롤 동안 평균 프레임·50ms 넘는 프레임 수 ④ 서버 HTML 시간(ms)의 중앙값을 낸다. 첫 표시 뒤 DOM 의 행 수(가상화가 없으므로 전 행)를 세어 시드 행 수와 다르면 **실패**한다(D51 — `max_rows` 잘림을 측정으로 삼지 않는다).
- 대상 판정은 `scripts/lib/targets.mjs` 의 `resolveTarget('local')` 을 쓰되, `LOCAL_DB_URL` 이 없거나 포트가 54422 가 아니면 `LOCAL_DSN`(54322 — 레인 A)으로 넘어가지 않고 **멈춘다**. 3000 포트는 거부한다. `scripts/perf-baseline.mjs` 는 고치지 않는다(B 과제 27 소유, D32).
- 단위 테스트 `tests/scripts/perf-grid.test.ts`: 시드 생성기가 같은 시드에서 같은 행을 낸다, 중앙값·백분위 계산, 원격 URL·3000 포트 거부, `LOCAL_DB_URL` 없음·54322 거부, 행 수 불일치 실패.

### 3.3 절차

래퍼(§2.5-0)로 레인 B 스택을 띄우고 `db:reset` → `dev:bootstrap` → `node scripts/ui-capture.mjs seed` → `npm run build` → `npx next start -p 3201` → `smoke:prod` → `ui-capture.mjs shoot --label ui0 --theme light` → `perf-grid.mjs seed`·`measure`. 눈확인 계정 넷(플랫폼 관리자·플랫폼 관리자가 아닌 워크스페이스 관리자·일반 멤버·두 워크스페이스 멤버)은 시드가 service_role 로 만들고 비밀번호는 메모리에만 둔다(SP3a §7.5 관례). 문서와 스크립트는 `sp3b/ui0` 브랜치에 커밋하고 창 ①(D46)에서 main 에 넣는다(UI 위험 파일이 없으므로 `ui/` 브랜치가 필요 없다).

### 3.4 `scripts/ui-capture.mjs`(D48)

| 항목 | 내용 |
|---|---|
| 모양 | `package.json` 무변경 — Playwright 는 `npx --yes playwright@1`, 대비 검사는 `node_modules/axe-core/axe.min.js`(전이 의존, 없으면 멈추고 알린다). 하위 명령 `seed`·`shoot --label <l> --theme light\|dark --sizes …`·`diff <기준 label> <대상 label>`·`axe --label <l>`. 대상 판정은 `resolveTarget('local')`(3000 포트 거부, `LOCAL_DB_URL` 54422 가 아니면 멈춤) |
| 라우트 목록 | `scripts/ui-capture.routes.json` — 경로·계정 등급·동적 id 를 시드에서 찾는 규칙·가릴 선택자(실시간·상대 시각). 옛 경로와 새 경로의 짝(UI-2 비교용)을 같은 파일에 둔다 |
| 시드 | `db:reset` → `dev:bootstrap` 뒤 `seed`. 결정적 id, 날짜는 캡처 날 기준 상대값. 워크스페이스 둘, 프로젝트 하나에 WBS 약 60행(완료·지연·진행·오늘 마감·주 경로·팀 5색·깊이 4·전체 화면 가능), 이슈·공지·회의 일정·회의록(mermaid·코드 블록·표 포함)·주간 시트 입력·근태·에이전트 좌석 1, 초대·공유 토큰 각 1, 계정 넷. 모든 Phase 가 같은 시드를 쓴다 |
| 캡처 조건 | `deviceScaleFactor: 1`, `locale: 'ko-KR'`, `timezoneId: 'Asia/Seoul'`, `reducedMotion: 'reduce'`, 테마 행에 맞춘 `colorScheme`(다크는 계정 선호를 `dark` 로 둔 컨텍스트), 새 브라우저 컨텍스트(캐시 없음). 로드 뒤 네트워크 유휴 + `document.fonts.ready` + 500ms. `document.fonts.check('16px "Pretendard Variable"')` 가 거짓이면 그 장을 '무효(대체 글꼴)'로 기록하고 비교하지 않는다. 실시간·상대 시각 영역은 선택자로 가린다(스크립트가 `visibility:hidden` 주입 — 제품 코드 무수정) |
| 비교 | 해시가 아니라 픽셀 차이다. 스크립트가 헤드리스 페이지의 canvas 로 두 PNG 를 읽어 채널 차 > 16 인 픽셀 비율을 낸다(의존성 없음). 비교 쌍은 늘 (그 브랜치의 merge-base, 브랜치 머리)를 같은 시드·같은 스크립트로 새로 찍은 것이다. 앞 레인이 먼저 머지돼 merge-base 가 바뀌면 기준을 다시 찍는다 |
| 대비 검사 | `axe`: 캡처마다 axe-core 의 `color-contrast` 규칙만 주입해 돌리고 라우트 × 테마 위반 수를 표로 남긴다 |
| 단위 테스트 | `tests/scripts/ui-capture.test.ts` — 라우트 목록의 형식, 픽셀 차 계산(합성 이미지), 원격·3000 거부, 가림 선택자 주입 문자열 |

## 4. UI-1 — 토큰·다크·상태 컴포넌트(`ui/sp3-tokens`)

값·대비의 정본은 개정 §5.5.2~§5.5.4(원색 34·의미 20·상태·간트·범주), §5.4.1(반경·아이콘)과 §5.5.6(글자·간격·조작 높이·모션)이다. 이 절은 파일에서 어떻게 두는지와 이행 규칙만 적는다. UI-1 은 C 소유 파일(`(app)/projects/page.tsx`·`BrandMark.tsx`와 C 의 새 파일)을 고치지 않는다(비평 lanes L-I3).

### 4.1 `globals.css` 의 순서와 층

층 열은 CSS 캐스케이드 층이다. unlayered 는 모든 named layer 를 이기므로, 지금 unlayered 인 규칙은 그대로 둔다(D50).

| 순서 | 블록 | 층 | 내용 |
|---|---|---|---|
| 1 | 머리 | — | `@import "tailwindcss"`·`@source not …`·`@custom-variant dark (&:where(.dark, .dark *))`(그대로) |
| 2 | 원색 | unlayered `:root` | `--p-gray-0 … --p-mint-700`(D11). 컴포넌트·페이지가 직접 참조하지 않는다 |
| 3 | 의미 | `@theme`(Tailwind 가 `@layer theme` 로 낸다) | `--color-canvas: var(--p-gray-25); …` — 개정 §5.5.3 의 20개, §5.5.4 의 상태 6종(본색·weak)·`today`·`critical`·`phasebar`·`plan-track`·`weekend`·`holiday-band`·`category-1..8`, D12 의 추가분. 글자 크기 `--text-title` 등(D14) |
| 4 | 옛 이름 별칭 | `@theme inline` | `--color-ink-subtle: var(--color-fg-muted); …` — 개정 §5.5.5 의 이행표. 별칭은 22개, 같은 이름 12개는 값만 바뀐다, `hero-ink`·`hero-ink-muted`·`hero-line` 은 D13, `team-*` 10개는 D15. 죽은 4개(`hero-from`·`hero-via`·`hero-to`·`sheet-gutter`)는 지운다. `sidebar-*` 7개는 사이드바 마크업을 바꾸며 지운다. `@theme inline` 별칭은 변수를 내지 않고 유틸이 대상 변수를 직접 참조하므로 `.dark`·표본 컨테이너 안에서도 다시 풀린다(Tailwind 4.3.1 컴파일 실측) |
| 5 | 다크 | unlayered `.dark`(지금과 같다) | `color-scheme: dark; --color-canvas: var(--p-night-950); …` — 의미 토큰만 재정의. 라이트 값을 반전하지 않는다 |
| 6 | 비색 토큰 | unlayered `:root` | 층 `--z-sticky: 20; --z-shell: 70; --z-rail: 90; --z-popover: 100; --z-overlay: 110; --z-fullscreen: 120; --z-modal: 150; --z-toast: 200; --z-skip: 250`(D56). 그림자 `--shadow-popover`·`--shadow-modal`. 반경 `--radius-control: 8px`(입력·버튼)·`--radius-panel: 12px`(패널 — 상태 pill 만 `rounded-full`, 개정 §5.4.1). 조작 높이 `--control-h: 36px`. 모션 `--motion-fast: 110ms`(hover·focus)·`--motion-menu: 140ms`(메뉴·팝오버)·`--motion-panel: 180ms`(인스펙터·레일)·`--ease-standard`(opacity·transform 전용 — 개정 §5.5.6). 아이콘 `--icon-menu: 18px`·`--icon-toolbar: 16px`·선 굵기 1.75(개정 §5.4.1 — `navIcons.ts` 한 곳에서 적용). 간격은 Tailwind 기본(4px 배수)을 쓰고 새 코드는 4/8/12/16/24/32/48 만 쓴다. 옛 `--shadow-sm`·`--shadow-md` 는 `none`, `--shadow-lg` 는 `var(--shadow-popover)`, `--shadow-xl` 은 `var(--shadow-modal)` 의 별칭이다 — 이것은 `var(--shadow-*)` 소비처(globals 6·TS/TSX 43)에만 든다. Tailwind `shadow-*` 유틸(TSX 54줄)은 값을 인라인하므로 바뀌지 않고 UI-5 몫이며, `@theme` 의 `--shadow-*` 는 고치지 않는다(팝오버·모달 그림자가 함께 사라진다 — 비평 feasibility F-I9). `--gradient-*`·`--shadow-glow`·`--ring-soft` 는 소비처를 단색으로 바꾸며 지운다 |
| 7 | 전역 규칙 | unlayered(지금과 같다 — D50) | `:focus-visible` → `var(--color-border-focus)` 2px 외곽선 + 2px offset(값만 바꾼다), `::selection`·스크롤바·`body` 를 의미 토큰으로. `@layer base` 로 옮기지 않는다 |
| 8 | 컴포넌트 | `@layer components` | 클래스 본문이 **의미 토큰을 직접 참조한다**(중간 컴포넌트 토큰을 두지 않는다 — 둘 때는 `:root, .dark, [data-theme-scope] { … }` 한 셀렉터 목록에 선언한다, 비평 ui-risk I4). `.btn-primary`(단색 `action` + `action-fg`, 그림자 없음, 높이 `--control-h`·반경 `--radius-control`·전환 `--motion-fast`), `.btn-accent`(삭제 — 쓰는 곳 1곳 `WeeklySheetView` 내보내기 버튼은 `.btn`), `.seg-item-active`(`surface-selected` + 체크), `.side-link(-active)`(밝은 표면), `.card`·`.kpi-card`(반경 `--radius-panel`·그림자 없음), `.eyebrow`·`.chip`·`.badge`·`.lvl-badge`(12px 이상·uppercase 없음·자간 기본), `.app-input`·`.app-textarea`(`border-input`, 포커스 `border-focus`, 높이·반경 토큰), `.freeze-edge`(하드코딩 그림자 → 토큰), `.hero-card`·`.hero-glow`(D13 평면), `.panel-soft`(`surface-subtle`), `.brand-logo-light`·`.brand-logo-dark`(D24). `.kpi-tile`(사용 0)·`.app-backdrop`(E6) 은 지운다. UI-2b 가 `.app-main` 본문과 채움 규칙을 이 층에 더한다(D19) |
| 9 | 모션 | unlayered | `prefers-reduced-motion` 블록 유지 |
| 10 | 인쇄 | unlayered, 안전망 앞 | `@media print { :root, .dark { color-scheme: light; <의미 토큰 전부의 라이트 값> } }` — 인쇄는 테마와 무관하게 라이트 값이다. 지금의 `@media print { body { background: #fff } … }`(`globals.css:470-481`)를 이 블록으로 합친다. 다크 선호 사용자가 현황 보고서(`ReportModal` 인쇄 영역 — `text-ink`·`text-ink-muted`·`text-done` 등)를 인쇄하면 흰 종이에 밝은 글자(1.1~2.5:1)가 나오는 회귀를 막는다(비평 ui-risk I5) |
| 11 | 반응형 안전망 | unlayered | **무수정**(파일의 마지막 블록) |

- Tailwind v4 는 쓰이지 않는 `@theme` 변수를 내보내지 않는다. 별칭을 둔 뒤 CSS 모듈·인라인 `style` 의 `var(--color-옛이름)` 74건(TS/TSX 40·`delegationTable.module.css` 20·`seatmap.module.css` 14)이 계속 풀리는지 빌드 산출물로 확인한다(실측 tokens §2.1). 안 풀리면 그 이름을 `:root, .dark, [data-theme-scope] { --color-옛이름: var(--color-새이름) }` 한 규칙에 적는다 — `:root` 에만 적으면 선언 요소에서 풀려 중첩 `.dark`·표본 컨테이너 안에서 라이트 값이 상속된다(비평 feasibility F-I9·ui-risk I4).
- 개정 §5.5.3 의 `accentTokens.ts`(A) 기준 색과 `globals.css` 의 의미 토큰 값이 같아야 한다 — `contrast-tokens` 가 동치를 단언한다(실측 tokens §8.3-5).
- z 대응표(D56)는 `docs/baseline/sp3b-ui.md` 에 둔다. UI-1 이 새 토큰으로 바꾸는 곳은 UI-1 이 이미 고치는 파일(`WbsGanttSheet` 전체 화면 = `--z-fullscreen`, `Modal`·`Toast`·`Tooltip`·셸 색 파일)과 `ArchiveChatPanel`(→ `--z-modal` 계열)이고, 나머지 `z-[` 는 `no-raw-color` 허용 목록에 남는다(화면 소유 SP).
- `hover:-translate` 류 이동은 C 소유 파일을 빼고 UI-1 에서 지운다(`grep -rn 'hover:-translate' src` — 개정 SPU1 블록 "토큰·hover 이동 삭제는 SP3b UI-1"). 호출부의 반경·높이·간격 전면 치환은 화면 소유 SP(UI-5)다.

### 4.2 테마 3값(D10, 사용자 결정 #21)

| 파일 | 바뀌는 것 |
|---|---|
| `src/lib/theme/policy.ts`(새) | `type ThemePref = 'system' \| 'light' \| 'dark'`, `THEME_UNSET_DEFAULT: ThemePref = 'light'`, `resolveTheme(pref: ThemePref \| null, systemDark: boolean): 'light' \| 'dark'`, `noFlashScript(): string`(아래 규칙을 문자열로 만든다 — 상수를 보간한다) |
| `src/app/layout.tsx` | no-flash 스크립트를 `noFlashScript()` 로 바꾼다. 규칙: localStorage `dflow-theme` → 쿠키 `dflow-theme` → 없으면 `THEME_UNSET_DEFAULT`. `'system'` 이면 `matchMedia('(prefers-color-scheme: dark)')`. 결과가 다크면 `html.dark`. 키 이름 유지 |
| `src/components/providers/ThemeProvider.tsx` | 값 `{ preference: ThemePref \| null; resolved: 'light' \| 'dark'; setPreference(p: ThemePref): void }`. `preference === 'system'`(또는 미설정이고 기본이 `'system'`)이면 `matchMedia` change 를 구독한다. `setPreference` 는 클래스·localStorage·쿠키·`queueUiPref({ theme })` 를 갱신한다. localStorage 접근 실패(사파리 사생활 모드)는 쿠키만 쓰고 로그를 남긴다. `toggle` 은 지운다(소비처는 숨긴 버튼뿐) |
| `src/lib/domain/types.ts` | `UiPrefs.theme?: ThemePref` |
| `src/lib/prefs/sync.ts`·`PrefsSync.tsx` | 로컬 테마 = localStorage 의 **선호**(DOM 클래스의 해석값이 아니다). 로컬에 선호가 없으면 서버로 백필하지 않는다. 서버에 선호가 있으면 서버가 이긴다(지금 규칙) |
| `src/components/minutes/MarkdownView.tsx` | mermaid 테마 = `resolved` |
| `src/components/app/HeaderChrome.tsx` | 계정 팝오버에 '화면 테마' 라디오 그룹(`role="radiogroup"`, 시스템·라이트·다크, 방향키 이동, 선택 표시는 체크 + `surface-selected`, 선택 표시는 마운트 뒤 — D10). 숨긴 다크 버튼·숨긴 언어 버튼·`ChangePasswordModal` 죽은 코드를 지운다 |
| `src/components/account/AccountView.tsx` | '화면' 구역: 테마 3단, 언어(`ko`·`en` — 전역 바에서 뺀 언어 선택의 유일한 자리) |
| `src/lib/settings/catalog-meta.ts`(A) | `PERSONAL_PREFS` 의 `theme` 설명을 '시스템·라이트·다크'로 |

### 4.3 밝은 사이드바·전역 바 색

UI-1 은 셸의 **색과 표면**만 바꾼다. 구조(내비 두 층·전환기·브레드크럼)는 UI-2 가 다시 쓴다(같은 파일을 두 브랜치가 연달아 고치는 것은 개정이 받아들인 비용 — 5-D12).

- `Sidebar.tsx`·`HeaderChrome.tsx` 모바일 메뉴: `sidebar-*` 45건을 `surface`·`fg`·`fg-secondary`·`fg-muted`·`surface-selected`·`border` 로. 폭(248/78)은 UI-2 가 바꾼다.
- 프로젝트 상태 점(`STATUS_META` — 원색 `amber/emerald/rose/sky/slate-400`)을 상태 토큰(`warning`·`success`·`danger`·`progress`·`pending`)으로. 흰 표면 위 비글자 3:1 을 넘는다.
- 배지 세 계열(개정 §5.5.4): 알림 수 = `action`, 검토 대기 = `warning`, 긴급 = `danger`. 지금 알림 배지(`bg-accent-secondary text-white text-[9px]`)·결재 배지(`bg-amber-500 text-white` — 라이트에서도 2.15:1)를 바꾸고 글자는 12px 이상.
- 스킵 링크 `bg-brand text-white` → `bg-action text-action-fg`, 층 `--z-skip`.

### 4.4 히어로·로그인·그 밖의 마크업(D13·E6·E14)

| 위치 | 바꾸는 것 |
|---|---|
| `src/components/ui/PageHero.tsx` | 제목 띠 `text-hero-ink` → 별칭으로 밝아진다. 띠 배경을 `surface` + 아래 `border`. 보이는 조건(`≥1280 且 ≥800`)은 UI-2 가 없앤다(D18) |
| `src/app/(app)/projects/page.tsx`·`src/components/ui/BrandMark.tsx`(C) | **UI-1 은 고치지 않는다.** `/projects` 는 `hero-*` 별칭과 `.hero-card` 평면화로만 밝아진다. 히어로의 `border-white/10 bg-white/[0.06]`·`border-white/15 bg-white/10`·11px uppercase 둘·카드 이니셜의 `--gradient-primary`·hover 이동은 UI-2b 의 이동 커밋이 정리한다 |
| `src/components/home/NewProjectModal.tsx`(A, C 가 이어 고침) | 기본 트리거의 `bg-white/10 text-hero-ink` → `.btn-primary`(한 줄) |
| `src/components/agent-hub/AgentFrame.tsx`·`AgentTabs.tsx` | `bg-white/[0.04~0.08]`·`text-[#f2aa4c]`·`hero-line`. 에이전트 타일 색(`lib/domain/agentRoster.ts` hex 9)은 어두운 배경 기준이라 밝은 표면에서 대비를 다시 잰다 — 3:1 미만이면 `category-*` 로 |
| `src/components/wiki/WikiSearch.tsx`·`WikiReindexButton.tsx` | `text-[#3fd8c6]`·`bg-white/[0.06]`·10px uppercase |
| `src/components/chat/AssistantChat.tsx`(B) | `--gradient-dark` 세 줄 → `surface-raised`·`border`. `text-white` 15건은 배경에 맞춰 `fg`·`action-fg` |
| `src/app/not-found.tsx` | `--gradient-primary` 두 곳 → `action`. `.app-backdrop` → `bg-canvas` |
| `(app)/layout.tsx`·`invite/[token]/page.tsx`·`ShareViewer.tsx`·`WbsGanttSheet.tsx`(전체 화면 모드) | `.app-backdrop` → `bg-canvas` |
| `WbsGanttSheet.tsx` 오늘 칩 | `bg-today text-white` 9px → `bg-today text-today-fg` 12px 이상(개정 §5.5.4) |
| 채움 배경 + `text-white` 줄(D12) | `bg-brand`·`bg-delayed`·`bg-done`·`bg-critical`·`bg-accent-secondary` 와 같은 줄의 `text-white` → `text-action-fg`·`text-danger-fg`·`text-success-fg`… |
| `src/app/login/page.tsx` | 임의 hex 17·rgba 26·`bg-white` 14 → 의미 토큰. 방사 그라데이션은 지운다. h1 을 하나로(지금은 브레이크포인트마다 하나씩 둘). env 브랜드(이름·로고·태그라인)는 그대로 |

### 4.5 상태 컴포넌트(COM-1, 개정 §5.7)

| 컴포넌트 | 계약 |
|---|---|
| `src/components/ui/StatusMessage.tsx`(새) | `kind: 'loading' \| 'empty' \| 'needs_setup' \| 'disabled' \| 'partial_error' \| 'conflict' \| 'offline' \| 'permission_changed'`, `title`·`detail?`·`action?: { label; href? ; onSelect? }`(권한에 맞는 다음 행동 하나)·`compact?`. 막는 오류(`partial_error` 가운데 화면 전체·`permission_changed`)는 `role="alert"`, 나머지는 `role="status"`. `loading` 은 레이아웃 높이를 지키는 skeleton 이고 수치를 0으로 그리지 않는다. 문구는 개정 §5.10.3 표준 문구를 쓰고, 복구 약속("자동으로 다시 시도합니다" 등)은 실제 구현이 있을 때만 |
| `src/components/ui/Button.tsx`·`IconButton.tsx`(새) | 높이 `--control-h`·반경 `--radius-control`·전환 `--motion-fast`(opacity·색만 — 이동 없음). 기본·hover·pressed·focus·disabled·busy. busy 는 `aria-busy="true"`·폭 유지·중복 제출 차단. icon-only 는 `aria-label` 필수(타입으로 강제). 사유 있는 disabled 는 옆 글 + `aria-describedby`. 기존 `.btn*` 클래스 호출부 314건은 그대로(UI-5) |
| `src/components/ui/Field.tsx`(새) | 높이 `--control-h`·반경 `--radius-control`. 라벨·설명·오류 배선(`aria-invalid`·`aria-describedby`), readonly(복사 가능)와 disabled 구분, 설명을 placeholder 에만 두지 않는다 |
| `StatusPill.tsx` | tone 토큰(상태 weak 배경 + 본색 글자 + 아이콘)만 바꾼다. 수치는 `tabular-nums`. 해석된 정의 인터페이스 전환은 SP5b(개정 §5.12.5 SP5b ①) |
| `KpiCard.tsx`·`SectionCard.tsx`·`Modal.tsx` 머리·`InboxPanel.tsx` | 10~11px uppercase·넓은 자간 제거(D14), 토큰. `KpiCard` 수치 `tabular-nums`. `Modal` 층 `--z-modal`(중첩 +1)·전환 `--motion-menu`. 팝오버는 `--motion-menu`, 레일은 `--motion-panel`(UI-2b) |
| `Toast.tsx`·`Tooltip.tsx` | 층 `--z-toast`. 토스트 `role="status"` 확인 |

### 4.6 `/admin/ui-states`(D16)

- 파일: `src/app/(app)/(global)/admin/ui-states/page.tsx`(URL 은 `/admin/ui-states`. 레이아웃 없는 라우트 그룹이라 UI-1 에서는 지금 셸 아래 그대로 뜬다. UI-2 가 `(global)/layout.tsx` 를 더한다), 판정 `canViewUiStates(actor)` = `actor?.isSuperuser === true`(`src/lib/authz/uiStatesAccess.ts`), 거부 `notFound()`. env 플래그로 게이트하지 않는다.
- 내용(`UiStatesShowcase`): 개정 §5.7.1 의 복합 상태 — 선택 + 오류 + 포커스 행, dirty + invalid 필드, conflict + busy 버튼 — 와 `StatusMessage` 8종, `StatusPill` tone, 배지 세 계열, `Button` 전 상태, 입력 전 상태를 라이트·다크 두 열로. 열 컨테이너에는 `.dark`(다크 열)와 `data-theme-scope` 를 함께 단다 — 유틸(`@theme inline` 별칭)은 컨테이너 재정의가 먹고, `var()` 로 다른 토큰을 가리키는 비유틸 변수는 `[data-theme-scope]` 선언으로 다시 풀린다(§4.1 블록 8, 비평 feasibility F-I9·ui-risk I4). 눈확인 때 캡처 스크립트가 쇼케이스 다크 열의 `Button`·`.btn-primary`·배지 계산 배경색(`getComputedStyle`)이 페이지 전체 다크(`html.dark` 로 연 같은 화면)의 같은 요소와 같은지 대조해 표에 적는다(jsdom 은 계산하지 못한다).
- accent 표본 10종: 코발트(기본), 빨강 근처 둘, 초록 근처 둘, 아주 밝은 색, 아주 어두운 색, 채도 낮은 회색, 보라, 주황. 서버가 `accent.ts` 로 파생 세트를 계산해 표본 컨테이너(`data-theme-scope`)의 `style` 에 여섯 변수로 넣는다(D23 과 같은 매핑). 거부된 표본은 실패 쌍과 대비값을 보인다.

### 4.7 accent 거부 임계값 조정(SP3a D30, 개정 §8.1 #8)

표본 10종을 보고 hue 거리·채도 임계(시작값 20°·0.08)를 정한다 — 빨강·초록 근처 넷은 거부되고 나머지는 통과해야 한다. 값을 `src/lib/settings/accent.ts` 에 적고 `tests/settings/accent.test.ts` 에 표본별 기대(통과/거부)를 고정한다. 임계가 좁아지면 저장된 세트가 읽을 때 `invalid` 가 되므로 레인 B 스택에서 래퍼로 `npm run settings:verify`(DSN 은 §2.5-4)를 돌린다. C 의 `AccentEditor`·저장 테스트가 임계 경계의 색을 표본으로 쓰면 이 조정 뒤 깨진다 — 레인 A 알림 8.

### 4.8 UI-1 의 오류 처리·권한

- 테마 저장 실패(`/api/prefs`)는 지금처럼 로컬 적용을 유지하고 로그를 남긴다 — 개인 설정은 서버 판정에 들어가지 않는다(개정 §2.8.5 끝, §8.1 의 테스트).
- `/admin/ui-states` 는 actor 가 null(권한 조회 실패)이면 404 다(fail-closed). 조회 실패를 '권한 없음'으로 보이지 않도록 `getActorForView` 가 이미 내는 열화 표시(`DegradedNotice`)를 그대로 둔다.
- UI-1 은 새 서버 액션·라우트를 만들지 않는다.

## 5. UI-2 — 경로·IA(UI-2a)와 셸(UI-2b)(`ui/sp3-menu`)

정본은 개정 §5.3·§5.4 와 ★1~★11 이다. 이 절은 그것을 이 리포에서 어떻게 두는지 적는다. 한 브랜치 `ui/sp3-menu` 에 두 Phase 를 차례로 쌓고 체크포인트 빈 커밋을 둘 둔다(D45). 과제 순서는 다음과 같다.

1. **UI-2a 착수**(B 체크포인트 뒤 첫 묶음): B 산출물 확인(`navFor`·`moduleSetFor`·CR-5·관문 불변식의 실제 이름) → 스파이크 S-1·S-5·S-8(§5.1) → 순수 모듈(`src/lib/workspace/*`·`authz/{navCaps,workspaceScope}.ts`·`nav/{active,switchTarget}.ts`·`modules/effectiveMany.ts`·`prefs/split.ts`)과 그 단위 테스트.
2. **UI-2a 경로·IA**: 여덟 화면의 `/w/[slug]` 이동과 스텁 여덟(같은 커밋 규칙 — 아래), 루트 리졸버, 홈 v0·내 업무 v0(`PageHeader`·`PageFrame` 첫 판), 화면 안 링크 가운데 서버 컴포넌트·`/w` 화면의 것, `revalidatePath`, 액션 시그니처(D26)·워크스페이스 한정(§5.8), 파생(D27 — 사용 현황 키·봇 도메인·verifier·linkify), 개요 교차 모듈 표시·회의록 `?project=`(D53), 개인 설정 분리와 마이그레이션(§5.6), `/api/nav/switch-target`. 옛 셸은 고치지 않는다(D45). 새 셸 컴포넌트(배선 없음)는 이 기간에 함께 만들어도 된다.
3. **UI-2a 체크포인트**: 공통 묶음 + DB 묶음 + E2E 부분(`scripts/e2e-sp3b.mjs` — E1·E2·E4·E6·E8·E9·E11) + 눈확인 UI-2a 행(에이전트) + 빈 커밋. main 에는 아직 넣지 않는다(창 ③).
4. **UI-2b 착수**(C 체크포인트 뒤): 최신 main 으로 rebase → 스파이크 S-2·S-3·S-6·S-7(§5.1 — C 의 레이아웃·파비콘 기록을 쓴다) → C 파일 과제(`w/[slug]/layout.tsx` 에 셸, `/projects` 이동과 아홉째 스텁, `BrandMark`).
5. **UI-2b 셸**: 범위 레이아웃 셋과 오류 경계(D2), `navFor` 소비·전환기·드로어·전역 바·레일, PageHeader/PageFrame 어댑터·스크롤 단일화·sticky(D54), 브리지·`ProjectTabs`·티커 삭제, `/api/shell` 계약, 화면 안 링크 가운데 클라이언트 컴포넌트의 것(`useScope()`), 로고·accent·파비콘, 위키 초안 키(D52), `(global)` 이동.
6. **마무리**(`sp3a-done` 뒤, 창 ③ 직전 rebase): `scripts/e2e-local.mjs` 합치기·`actions/accounts.ts`·마이그레이션 번호 확정·성능 측정·눈확인(사용자)·체크포인트 빈 커밋 둘을 rebase 된 트리에서 다시 만든다 → UI-2a 체크포인트, UI-2b 체크포인트 차례로 main.

같은 브랜치 안에서 옛 경로의 `page.tsx` 를 옮기는 커밋과 그 경로의 `(legacy)` 스텁을 더하는 커밋은 **하나**다 — 같은 URL 에 `page.tsx` 와 `route.ts` 가 함께 있으면 빌드가 실패한다. 페이지 관문 불변식의 `PRE_GATE`·`EXCLUDED` 경로도 그 커밋에서 바꾼다(§2.4).

### 5.1 스파이크

결과를 `.superpowers/sp3b/spike-ui2.md` 에 적는다. 하나라도 "아니면"으로 가면 원장에 적고 컨트롤러 보고에 싣는다(설계 판단의 대안으로 바뀌는 것이다). 서버는 모두 프로덕션 빌드(`next start -p 3201`, D48)다. 초안의 S-4(`revalidatePath` 동작 확인)는 지웠다 — 이 앱에서 관측 효과가 인자와 무관해 판별력이 없다(D8).

| # | 단계 | 확인 | 방법 | 통과하면 | 아니면 |
|---|---|---|---|---|---|
| S-1 | UI-2a | 옛 경로 스텁의 HTTP 상태(D5) | 헤드리스 로그인으로 얻은 쿠키 항아리로 `curl -s -o /dev/null -D - -b <jar> <url>`(GET) — ① 지금의 `/p/<pid>/gantt`(`page.tsx` 의 `redirect()`) ② 시험용 `src/app/(legacy)/<시험 경로>/route.ts`(`NextResponse.redirect(url, 307)`) ③ 루트 `/`(레이아웃·로딩 밖 `page.tsx` 의 `redirect()`). 판정은 상태 코드와 **`Location` 이 `/login` 이 아니고 기대 대상**인 것. 무인증 호출은 대조군으로만 적는다(`/login` 307 이어야 한다) | ② 가 `307` + 기대 `Location`, ③ 이 `307` 이면 D5 와 리졸버 방식 확정. ① 은 기록 | ② 가 307 이 아니면 스텁을 `src/middleware.ts` 본문으로 옮긴다(D5 대안 — matcher 는 그대로, 갱신 쿠키를 싣는 `res` 뒤에 둔다). ③ 이 200 이면 리졸버를 `src/app/route.ts`(GET 핸들러, 307)로 바꾸고 '소속 없음' 화면은 새 페이지 `/welcome` 으로 보낸다. ① 이 307 이 아니면 `/p/[projectId]/gantt` 도 `(legacy)` 라우트로 옮긴다(`?view=timeline`, 나머지 쿼리 보존 — 비평 ui-risk m4) |
| S-5 | UI-2a(시험 페이지) | 채움 규칙(D19) | 시험 페이지에서 `.app-main` 본문 규칙 + `.app-main:has([data-frame="fill"])` 를 두고 캡처 스크립트가 `getComputedStyle(main).overflowY`(채움형 `hidden`, 문서형 `auto`)와 `main.scrollHeight === main.clientHeight`(채움형)를 적는다(Chromium) | 확정 | 범위 레이아웃이 `data-fill` 표지를 클라이언트 효과로 `main` 에 건다 |
| S-8 | UI-2a | 소프트 이동이 스텁을 지나는가 | 헤드리스에서 ① 회의록 본문·챗 답변의 `linkify` 링크(`<Link href="/minutes/<id>">`) ② 남겨 둔 옛 경로 `<Link>` 하나를 눌러 최종 URL 이 `/w/<s>/…` 이고 오류 경계·전체 새로고침 없이 그려지는지(MPA 폴백이면 그 사실을 적는다), RSC 요청(`?_rsc=`)의 `_rsc` 가 대상 URL 에 옮겨 붙지 않는지 ③ (UI-2b 에서) 전환기로 B 로 바꾼 뒤 30초 안에 `/projects` 링크가 `/w/<B>/projects` 로 가는지(`experimental.staleTimes.dynamic: 30`) | 그대로 | ①② 는 `linkify` 와 허용 목록의 화면 안 링크를 `<a>`(하드 이동)로 바꾼다. ③ 은 전환기가 이동 뒤 `router.refresh()` 로 라우터 캐시를 비운다 |
| S-2 | UI-2b | 범위 레이아웃 404 의 HTTP 상태 | `(app)/loading.tsx` 를 지우고 `w/[slug]/loading.tsx` 를 둔 상태에서 비소속 계정 쿠키 항아리로 `/w/<B>` GET | `404` 면 E2E ⑧ 이 HTTP 상태로 단언한다 | `200` + digest 면 기존 `notFoundRendered` 판정(`scripts/lib/e2e.mjs`)을 쓴다 |
| S-3 | UI-2b | 셸 재마운트와 레일 보존(D2·D38) | 헤드리스로 `/w/<s>/minutes` ↔ `/p/<pid>/wbs` 소프트 이동을 다섯 번 되풀이하며 네트워크·DOM 을 본다. 범위를 넘는 이동의 **첫 피드백 시간**(클릭 → 새 화면의 무엇이든 그려질 때까지)을 잰다 | AI 패널의 대화가 남고, 알림 실시간 채널이 1개이며, `/api/shell` 이 이동당 1회, 첫 피드백 300ms 안 | 알림·레일 공급자를 `(app)/layout` 쪽에 더 올리고(D38 확대) 다시 잰다. 첫 피드백이 늦으면 범위 레이아웃의 2차 조회를 `Suspense` 로 감싼 셸 조각(내비·배지)으로 나눈다(비평 feasibility m17) |
| S-6 | UI-2b | 파비콘(★8) | C 의 §5.2 분기 기록(`docs/baseline/sp3a-ui.md` 또는 C 원장)을 읽는다 | "메타데이터가 이긴다"면 범위 레이아웃의 `generateMetadata` 가 마크를 아이콘으로 낸다 | "덮인다"면 루트 파일 아이콘(`src/app/icon.tsx`·`apple-icon.tsx`)을 루트 레이아웃 메타데이터 아이콘(제품 기본)으로 바꾸고 범위 레이아웃이 덮는다 — SP3a §10.1 이 SP3b 로 넘긴 경우다 |
| S-7 | UI-2b | 회의록 탐색기의 높이 의존 | `/w/<s>/minutes` 를 문서형(D19)으로 두고 1440×900·1280×720·768 에서 탐색기 세 영역이 보이는지 본다 | 문서형 유지 | 채움형 닫힌 목록에 `/w/[slug]/minutes` 를 더한다(페이지 파일은 SP3b 가 옮기는 파일이다) |

### 5.2 워크스페이스 해석·현재 워크스페이스·페이지 판정(★1·★2)

| 파일(새) | export | 동작 |
|---|---|---|
| `src/lib/workspace/resolve.ts` | `resolveWorkspaceBySlug(slug): Promise<WsLookup>`(React `cache`) | `WsLookup = { ok: true; ws: WorkspaceRef } \| { ok: false; kind: 'missing' } \| { ok: false; kind: 'unavailable'; error: string }`, `WorkspaceRef = { id; slug; name }`. 슬러그가 `^[a-z0-9][a-z0-9-]{1,62}$`(`0003_org_core.sql` 의 check 와 같은 식)가 아니면 조회 없이 `missing`. 세션 클라이언트로 `workspaces.select('id, slug, name').eq('slug', slug).maybeSingle()` — RLS `workspaces_read` 가 비소속을 0행으로 만든다(존재 은닉). 조회 오류는 `unavailable`(404 로 위장하지 않는다). C 의 `w/[slug]/layout.tsx` 가 같은 조회를 두었으면 C 파일 과제에서 이 함수로 바꾼다. 같은 파일의 `workspaceRefById(id)`(React `cache`, `workspaces.select('id, slug, name').eq('id', id).maybeSingle()`, 같은 결과형)는 프로젝트 화면이 슬러그·이름을 얻는 길이다(D38) |
| `src/lib/workspace/list.ts` | `listMyWorkspaces(): Promise<{ ok: true; rows: (WorkspaceRef & { role: WorkspaceRole; joinedAt: string })[] } \| { ok: false; error: string }>`(`cache`) | `workspace_members.select('role, created_at, workspaces!inner(id, slug, name)').eq('user_id', 나)` 를 `created_at`·`workspace_id` 순으로 — `prefsWorkspaceId` 와 같은 순서라 "가장 먼저 가입한 소속"이 첫 행이다. **소속 행만** 센다(D4) |
| `src/lib/workspace/current.ts` | `readCurrentWorkspace(): Promise<{ ok: true; ws: WorkspaceRef \| null } \| { ok: false; error: string }>` | 쿠키 `dflow-ws` 의 슬러그가 `listMyWorkspaces` 에 있으면 그것, 없거나 탈퇴·위조면 첫 소속, 소속 0 이면 `null`. 읽는 곳은 셋뿐이다: 루트 리졸버, `(global)` 레이아웃, 목록형 옛 경로 스텁(D3) |
| `src/lib/workspace/paths.ts` | `wsHref(slug, segment?, query?)`, `WS_BASE_RE = /^\/w\/([^/]+)(\/.*)?$/` | 화면 안 링크의 유일한 조립 함수. `segment` 는 `navFor` 항목의 조각(`''`·`my-work`·`projects`·`meetings`·`minutes`·`agents`·`portfolio`·`usage`·`admin/accounts`·`admin/teams`·`settings`) |
| `src/lib/workspace/legacy.ts` | `legacyTarget(pathname, search, ctx): { path; search }`(순수), `LEGACY_ROUTES` | 옛 경로 → 새 경로 변환표 하나(§5.3). 스텁 열 개와 `legacy-redirects` 테스트가 이 표를 공유한다 |
| `src/lib/authz/workspaceScope.ts` | `loadWorkspaceScope(slug): Promise<{ ws: WorkspaceRef; actor: Actor \| null; degraded: boolean; role: 'superuser' \| WorkspaceRole \| null }>` | `/w/[slug]/**` 페이지의 **첫 await**. `missing` 이거나 (`!degraded` 이고 `workspaceRoleIn(actor, ws.id) === null`)이면 `notFound()`. `unavailable` 은 던진다(오류 경계 — UI-2b 뒤에는 같은 조회를 먼저 부른 범위 레이아웃이 던져 `(app)/error.tsx` 가 받는다). 권한 조회 실패(degraded)는 404 가 아니고 `actor: null` 로 돌려준다 — 페이지는 이때 service_role 로더를 부르지 않는다(fail-closed). **가드가 아니다** — 이름을 `require*` 로 짓지 않고, 액션은 여전히 네 가드를 쓴다(CLAUDE.md) |
| `src/lib/authz/navCaps.ts` | `navCapsFor(actor, { workspaceId, projectId })` | D42 |

- **쿠키 쓰기**(D3, UI-2b): 범위 레이아웃이 그리는 `ShellScope`(클라이언트)의 효과가 현재 워크스페이스 슬러그와 쿠키 값이 다를 때만 `document.cookie = 'dflow-ws=<slug>; path=/; max-age=31536000; samesite=lax'` 를 쓴다. 서버 컴포넌트는 쿠키를 쓸 수 없다(`src/middleware.ts` 주석). 쿠키는 보안 경계가 아니다 — 읽을 때마다 소속을 다시 본다. UI-2a 동안은 쿠키를 쓰는 곳이 없어 쿠키가 없으면 첫 소속으로 해석한다(UI-2a·UI-2b 는 같은 창에서 머지하므로 main 에서는 이 상태가 없다).
- **레이아웃 404 에 기대지 않는다**(E19): `/w/[slug]/**` 의 모든 페이지는 `loadWorkspaceScope` 를 첫 await 로 부른다. B 의 페이지 관문 불변식이 `loadWorkspaceScope` 를 관문 앞 허용 호출로 받아 "첫 await `loadWorkspaceScope` → B 관문" 순서를 기계로 본다(§2.4 — 비평 lanes L-I10). C 가 `tests/invariants/project-page-gates.test.ts` 의 `PAGES_ROOT` 에 `w/[slug]` 를 넣으므로 그 불변식도 옮긴 페이지를 본다. 판정 모양(`loadWorkspaceScope` 대 `isHiddenProject`)이 맞지 않을 때만 새 `tests/invariants/workspace-page-gates.test.ts` 로 나눈다(같은 walker).
- **거부 폴백**(D7):

| 상황 | 결과 | 지금 |
|---|---|---|
| 슬러그 워크스페이스의 비소속(플랫폼 관리자 제외) | 404(레이아웃과 페이지 둘 다) | — |
| 소속이지만 그 화면 권한 없음(포트폴리오·사용 현황·에이전트 현황·계정·공용 팀) | `redirect('/w/<slug>')` | `redirect('/projects')` 8곳 |
| 슬러그 없는 화면의 거부(`/admin/llm-config`)·전역 `not-found` 버튼·로그인 뒤·초대 합류 뒤 | `/`(리졸버). 초대 합류는 응답의 `projectId` 로 `/p/<pid>/dashboard` | `redirect('/projects')` 1·`href="/projects"` 1·`router.push('/projects')` 3 |
| 관리할 프로젝트 없음(계정 화면 `?project=` 후보 0) | 계정 화면 안의 빈 상태(`StatusMessage kind="empty"`) | `redirect('/projects')` |

### 5.3 경로 이동·옛 경로 스텁·루트 리졸버(★1·★7)

**옮기는 페이지**(모두 `loadWorkspaceScope(slug)` 를 첫 await 로 부르고, B 의 관문 줄은 그 다음 줄로 보존한다)

| 옛 파일 | 새 파일 | 관문·판정 | 로더 변경 | 과제 |
|---|---|---|---|---|
| `(app)/projects/page.tsx` + `loading.tsx` | `(app)/w/[slug]/projects/page.tsx` + `loading.tsx` | 관문 제외(셸 — 모듈 밖). 생성 대상 = 슬러그 워크스페이스, `canCreate` = `isWorkspaceAdmin(actor, ws.id)` | `resolveSoleWorkspaceId` 삭제. 목록은 `getProjectRows(ws.id)`(§5.9) | UI-2b(C 파일 과제). 같은 커밋이 아홉째 스텁 `/projects` 를 더하고 마크업(히어로·11px uppercase·hover 이동)을 정리한다 |
| `(app)/meetings/page.tsx` | `w/[slug]/meetings/page.tsx` | `requireModulePage({ workspaceId: ws.id }, 'meetings')` | `getMyMeetings(ws.id)` — 슬러그 워크스페이스의 회의만 | UI-2a |
| `(app)/minutes/page.tsx` + `loading.tsx` | `w/[slug]/minutes/page.tsx` + `loading.tsx` | `requireModulePage({ workspaceId }, 'minutes')` | `noProjectWorkspace` = `ws.id`, 목록·폴더 로더에 `ws.id`(§5.8). `?project=<pid>` 거르기와 범위 칩(D53) | UI-2a |
| `(app)/minutes/[id]/page.tsx` | `w/[slug]/minutes/[id]/page.tsx` | B 의 행 관문(회의록 행의 워크스페이스) + **행의 워크스페이스 ≠ 슬러그 워크스페이스면 404** | 연결 이슈·위키 영향 카드는 그 모듈이 effective 일 때만(P20) | UI-2a |
| `(app)/agents/page.tsx` | `w/[slug]/agents/page.tsx` | `requireModulePage({ workspaceId }, 'agents')`, 화면 권한 `canViewAgents(actor, ws.id)` | 좌석표는 슬러그 워크스페이스 프로젝트만(§5.8). 손으로 준 `h-full` 틀(`agents/page.tsx:18`)을 지운다 — 문서형 | UI-2a |
| `(app)/portfolio/page.tsx` + `loading.tsx` | `w/[slug]/portfolio/page.tsx` + `loading.tsx` | `requireModulePage({ workspaceId }, 'portfolio')`, 화면 권한 현행(`canViewPortfolio`) | `getPortfolioInputs(ws.id)` | UI-2a |
| `(app)/usage/page.tsx` + `loading.tsx` | `w/[slug]/usage/page.tsx` + `loading.tsx` | `requireModulePage({ workspaceId }, 'usage')`, 화면 권한 현행(`canViewUsage`) | 수치는 플랫폼 전체, 머리에 범위 칩(D21) | UI-2a |
| `(app)/admin/accounts/page.tsx` | `w/[slug]/admin/accounts/page.tsx` + `loading.tsx`(복제) | 관문 제외(셸). 화면 권한 `canManageWorkspaceAccounts(actor, ws.id)`(새 `accountsAccess.ts` — 워크스페이스 관리자, D22) | `?project=` 후보는 그 워크스페이스 프로젝트만. 플랫폼 조작은 `actor.isSuperuser` 일 때만 렌더 | UI-2a |
| `(app)/admin/teams/page.tsx` | `w/[slug]/admin/teams/page.tsx` + `loading.tsx`(복제) | 관문 제외(셸). 화면 권한 `canManageTeams(actor, ws.id)`(시그니처에 워크스페이스를 더한다 — 워크스페이스 관리자, D22) | `resolveSoleWorkspaceId` → `ws.id` | UI-2a |
| `(app)/p/[projectId]/kanban/page.tsx` + `loading.tsx` | 삭제(보드는 `wbs?view=board`) | — | — | **UI-3**(D36 — UI-2 는 그대로 둔다) |
| `(app)/account/**` | `(app)/(global)/account/**` | 관문 제외(개인) | — | UI-2b |
| `(app)/admin/llm-config/**` + `admin/loading.tsx` | `(app)/(global)/admin/llm-config/**` + `loading.tsx` | 현행(`canManageLlmConfig`), 거부는 `/` | — | UI-2b. 원본 `(app)/admin/loading.tsx` 는 이때 지운다(계정·공용 팀은 UI-2a 에서 복제했다) |
| `(app)/loading.tsx` | 삭제. `w/[slug]/{loading,error}.tsx`·`(global)/{loading,error}.tsx`·`p/[projectId]/error.tsx` 새로(`p/[projectId]/loading.tsx` 는 있다). `(app)/error.tsx` 는 셸 없는 화면 전체 오류로(D2) | — | — | UI-2b |

새로 만드는 페이지는 셋이다(UI-2a): `w/[slug]/page.tsx`(홈 v0), `w/[slug]/my-work/page.tsx`(내 업무 v0) — 둘 다 관문 제외(셸) — 와 루트 리졸버(`src/app/page.tsx`, 고침). UI-2a 동안 이 화면들은 옛 셸 아래에 뜬다(D45).

**옛 경로 스텁**(D5·D6·D36) — `src/app/(legacy)/<옛 경로>/route.ts` 열 개: UI-2a 가 여덟(`/meetings`·`/minutes`·`/minutes/[id]`·`/agents`·`/portfolio`·`/usage`·`/admin/accounts`·`/admin/teams`), UI-2b 가 `/projects`(C 소유 페이지를 옮기는 커밋), UI-3 이 `/p/[projectId]/kanban`. 본문은 `legacyTarget()` 과 해석 함수 하나를 부르는 몇 줄이다.

| 옛 경로 | 대상 | 워크스페이스 해석 |
|---|---|---|
| `/projects`·`/meetings`·`/minutes`·`/agents`·`/portfolio`·`/usage`·`/admin/teams` | `/w/<s>/<같은 조각>` + 원래 쿼리 | `readCurrentWorkspace()`(쿠키 → 첫 소속) |
| `/admin/accounts` | `/w/<s>/admin/accounts` + 원래 쿼리 | `?project=<pid>` 가 있고 `actor.projectWorkspace` 에 있으면 **그 프로젝트의 워크스페이스**, 아니면 현재 워크스페이스 |
| `/minutes/[id]` | `/w/<s>/minutes/<id>` + 원래 쿼리(`?block=`·`?version=` 보존) | **회의록 행의 워크스페이스**(세션 클라이언트 `minutes.select('workspace_id, workspaces!inner(slug)')`). 행이 읽히지 않으면 현재 워크스페이스로 보내고 거기서 페이지가 404 를 낸다 — 존재를 드러내지 않고, 표준 404 화면을 쓴다 |
| `/p/[projectId]/kanban` | `/p/<pid>/wbs?view=board` + `view`(묶음 기준)는 `group` 으로, 나머지 쿼리 그대로 | 필요 없음(프로젝트 경로) |

- 응답은 `NextResponse.redirect(url, 307)` + `Cache-Control: no-store` 이고 라우트 파일은 `export const dynamic = 'force-dynamic'` 이다. 308·`permanentRedirect` 는 쓰지 않는다 — 대상이 쿠키·소속으로 달라져 브라우저가 영구 캐시하면 안 된다. `Location` 은 요청 원점(`req.nextUrl`)으로 만들고 `NEXT_PUBLIC_APP_URL` 로 만들지 않는다(호스트가 바뀌면 쿠키를 잃어 로그인 고리가 된다 — 비평 ui-risk I7). `legacyTarget()` 은 RSC 요청의 `_rsc` 를 뺀 쿼리를 붙인다(비평 feasibility m20). 소속이 0 이면 `/` 로 보낸다(리졸버의 '소속 없음' 화면). 조회 오류는 `/`(리졸버가 오류를 그린다) — 스텁은 화면을 그리지 않는다.
- 비로그인은 미들웨어가 먼저 `/login` 으로 보낸다(matcher 는 제외 목록 방식이라 `(legacy)` 경로도 인증 게이트를 지난다 — 무변경). 미들웨어는 원래 경로를 버리므로(`middleware.ts:37-39`, 현행) 로그인하지 않은 사람이 외부 링크(`/minutes/<id>` 등)를 열면 로그인 뒤 리졸버로 간다 — '영구 링크'는 로그인한 사용자에게만 목적지를 보장한다. `next` 복귀는 이번 범위가 아니다(열린 리디렉션 검토 필요). 검색 노출은 해당 없다(앱 경로는 인증 뒤, 스테이징은 `X-Robots-Tag`).
- 스텁은 **영구**다. `/minutes/[id]` 는 저장·외부 링크가 있고(D6), 나머지도 북마크·옛 문서가 남는다. 지우는 SP 를 두지 않는다.
- 스텁은 `page.tsx` 가 아니므로 B 의 페이지 관문 불변식 밖이고, B 의 열거 매니페스트는 `src/app/api/**/route.ts` 만 센다 — 등록이 필요 없다. 스텁은 워크스페이스 해석 조회 말고는 데이터를 읽지 않는다.

**루트 리졸버**(`src/app/page.tsx`, D44, UI-2a). `readCurrentWorkspace()` 가 `null` 이면 `NoWorkspaceView`(h1 "소속된 워크스페이스가 없습니다", 초대 링크를 받아 합류하라는 안내, 로그아웃 버튼. 플랫폼 관리자에게는 "모든 워크스페이스 목록은 준비 중입니다(SP9)"와 `/admin/llm-config` 링크)를 그린다. 있으면 그 워크스페이스 행의 `startPage` 를 D44 로 해석해 `redirect()` 한다. 조회 오류는 `StatusMessage kind="partial_error"`(화면 전체, `role="alert"`)로 그린다 — '소속 없음'으로 위장하지 않는다.

### 5.4 셸(★3·★4·★6·★8·★10)

#### 5.4.1 레이아웃 분담(D2·D38·D49, UI-2b)

| 파일 | 서버에서 하는 일 | 그리는 것 |
|---|---|---|
| `src/app/(app)/layout.tsx` | `getAccountPrefs()` 하나(테마·언어·사이드바 접힘 — §5.6). STAGING 등 env 판독은 이 파일에 남긴다(C 의 `operational-env` 불변식 owner — 새 판독이 필요하면 `src/lib/settings/operational.ts` 의 owner 에 한 줄) | `ShellScopeProvider` > `RightRailProvider` > `BotPageContextProvider` > `ShellStateProvider` > `PrefsSync`·`UsageTracker`·스킵 링크(`--z-skip`)·`{children}`·`AssistantChat`. STAGING 값은 prop 으로 범위 레이아웃의 `GlobalBar` 에 전한다(컨텍스트). 프로젝트 목록·팀·신원은 싣지 않는다 |
| `src/app/(app)/w/[slug]/layout.tsx`(C 가 만들고 UI-2b 가 이어 고친다) | 1차 병렬: `getActorViewState()`·`resolveWorkspaceBySlug(slug)`·`listMyWorkspaces()`·`getDisplayName()`. 2차 병렬(워크스페이스 id 필요): 워크스페이스 설정(SP3a 읽기 — `navigation.menu`·`branding.*`), `effectiveModules({ workspaceId })`, `listWorkspaceProjects(wid)`(§5.9), `getWorkspacePrefs(wid)` — 설정·모듈 읽기 실패는 각각 받아 D49 로 처리한다. 그 뒤 `navFor({ scope: 'workspace', base: '/w/<s>', effective, caps: navCapsFor(...), menu })` | `ScopeContext.Provider`(D38) > `TeamsProvider`(그 워크스페이스의 활성 팀 — SP4 소유 컴포넌트를 쓰기만 한다) > `AppShell scope="workspace"` + `ShellScope` |
| `src/app/(app)/p/[projectId]/layout.tsx` | 1차: `getActorViewState()`. 워크스페이스 id 는 `actor.projectWorkspace.get(pid)`(조회 없음). 2차 병렬: 위 넷 + `effectiveModules({ workspaceId, projectId })` + `workspaceRefById(wid)`(슬러그·이름 — D38). `navFor({ scope: 'project', base: '/p/<pid>', … })`. 숨김 판정(`isHiddenProject`)은 지금 자리 그대로 | `ScopeContext.Provider` > `TeamsProvider`(프로젝트 팀 — 현행) > `AppShell scope="project"` + `ShellScope` |
| `src/app/(app)/(global)/layout.tsx`(새) | `readCurrentWorkspace()` 로 쿠키 워크스페이스를 정한 뒤 워크스페이스 레이아웃과 같은 2차 조회. `navFor({ scope: 'workspace', base: '/w/<쿠키 워크스페이스 slug>', … })` — `NavScope` 는 `'workspace' \| 'project'` 뿐이다(B 과제 7) | `AppShell scope="global"` — 워크스페이스 내비를 그리되 활성 항목이 없다(개정 §5.3.1 계정·플랫폼 행). `ws.llm`·`ws.ui_states` 의 href 는 절대 경로다(과제 7 ③). 소속 0 이면 내비 없이 계정 메뉴만 |

- 열화(`actor` null): 범위 레이아웃은 404 를 내지 않고 `navCapsFor(null)`(전부 false)로 내비를 그리며 `DegradedNotice` 를 싣는다. 프로젝트 범위에서 워크스페이스를 알 수 없으면(열화) 내비 없이 셸만 그린다.
- **설정 읽기 실패**(D49): 모듈 집합 실패는 `effective = CORE`, `navigation.menu` 실패·손상은 레지스트리 순서, `branding.*` 손상은 제품 기본. 셸 머리에 `StatusMessage kind="partial_error" compact` 를 싣고 `children` 을 그대로 렌더한다 — 손상된 키를 고칠 설정 화면이 열려야 한다. 오류 경계로 보내는 것은 슬러그·소속 조회 실패뿐이다.
- 같은 요청의 페이지가 부르는 `resolveWorkspaceBySlug`·`workspaceRefById`·`effectiveModules`·`getActorViewState` 는 React `cache` 로 레이아웃과 조회를 나눈다.
- `AppShell`(클라이언트)이 받는 것은 직렬화 가능한 값뿐이다: `nav: NavGroup[]`, `workspace`·`workspaces`(전환기)·`project`, 전환기용 프로젝트 목록 `{ id, name, status }[]`, 즐겨찾기·최근 방문(교집합 뒤), `identity`(표시 이름·범위 역할 라벨·팀 코드), 브랜드(`productName`·마크·로고 슬롯 유무), `degraded`·`configDegraded` 표지, STAGING 표시.
- DOM(개정 §5.4.1 — 전역 바는 **전체 폭**): `div.flex.h-dvh.flex-col.bg-canvas` > `GlobalBar`(전체 폭, 48) + `div.flex.min-h-0.flex-1` > [`WorkspaceNav` 또는 `ProjectNav`(데스크톱 사이드바)] + [`main#main-content.app-main`(세로 flex, 여백 24/20/16 — 세로 스크롤·gutter 는 `.app-main` 클래스 본문이고 유틸을 달지 않는다, D19) > `DegradedNotice`(shrink-0) + 설정 읽기 실패 알림(D49) + `{children}`] + [레일 자리 `#app-rail`]. `main` 의 z·패딩은 개정 §5.4.1 표를 따른다.
- 범위마다 `error.tsx` 가 있어 페이지 오류는 이 셸 안의 `main` 자리에 뜬다(D2). 새 오류 경계 셋은 E2E `PAGE_MARKERS` 의 'error-boundary' 표지를 그대로 싣고 드리프트 테스트의 원본 목록에 들어간다(§2.4).

#### 5.4.2 내비(★3·★4, D30·D31)

- `WorkspaceNav`·`ProjectNav` 는 `navFor` 결과만 그린다. 손으로 적은 항목·경로가 없다. 아이콘은 `src/components/app/navIcons.ts` 의 `NAV_ICONS: Record<string, LucideIcon>`(레지스트리의 lucide 이름 → 컴포넌트)에서 찾고, 크기(메뉴 18px·툴바 16px)와 `strokeWidth={1.75}` 도 이 파일 한 곳에서 준다(개정 §5.4.1). 표에 없는 이름은 타입 오류다(B 의 `nav-for.test` 가 이름이 lucide 에 있음을 이미 본다).
- 활성 항목은 `src/lib/nav/active.ts` 의 `activeNavItem(pathname, groups): NavItemId \| null` 하나가 정한다. 규칙: base(`/w/<s>`·`/p/<pid>`)를 떼고 첫 조각을 본다. 항목의 `segment` 에 슬래시가 있으면 첫 조각으로 비교한다(D31 — `p.agents` = `agents/office` → `agents`). 내비 항목이 없는 경로는 모듈 레지스트리의 `routePrefixes` 로 소유 모듈을 찾아 그 모듈의 항목으로 본다(`/p/<pid>/import`·`/gantt` → `p.wbs`, `/p/<pid>/wiki/topics/<t>` → `p.wiki`, `/w/<s>/minutes/<id>` → `ws.minutes`). 활성 항목에만 `aria-current="page"` 를 단다. 브레드크럼·사용 현황 키·봇 문맥이 같은 함수를 쓴다(§5.7).
- 워크스페이스 내비의 '프로젝트' 아래: 즐겨찾기 최대 5(`favoriteProjectIds` ∩ 접근 가능), 최근 방문 최대 3(`recentProjects` ∩ 접근 가능, 즐겨찾기 제외), '전체 보기' 링크. 링크일 뿐 현재 범위 강조가 없다(개정 §5.3.3). `caps.canCreateProject` 면 '+ 새 프로젝트'(프로젝트 목록 화면의 생성 대화상자를 여는 링크 `/w/<s>/projects?new=1`).
- 프로젝트 내비의 머리: `← 워크스페이스 홈`(`/w/<s>`)과 `ProjectSwitcher`. `p.settings` 는 그룹 목록 아래 구분선 뒤에 둔다.
- 폭 232/64. 접힘은 계정 키 `sidebarCollapsed` 이고, 값이 없으면 1024~1279 에서 접힘·1280 이상에서 펼침이다(개정 §5.10.1). 첫 페인트 규칙(D55)대로 값이 없을 때의 폭 전환과 1024 미만 숨김(`hidden lg:flex` — 드로어를 쓴다)은 CSS 유틸로, 명시 선호는 서버가 아는 값으로 조건부 렌더한다. 접힌 상태는 아이콘 + 툴팁이고 그룹 머리를 숨긴다. 상태(탐침·권한·배지 값)에 따른 표시는 조건부 렌더다 — 반응형 display 클래스가 붙은 요소에 조건부 `hidden` 을 덧붙이지 않고 상태 변형 display 유틸을 쓰지 않는다(D17).
- 배지: '내 업무' = 검토 대기 합계(D40), 프로젝트 내비 `p.agents` = 그 프로젝트 결재 대기, `p.announcements` = 그 프로젝트 안읽음. 배지 값이 `null`(조회 실패)이면 그리지 않는다. 색 계열은 §4.3.
- 라벨 문구는 D30, 그룹 머리 문구는 새 사전 키 `nav.group.{main,shared,ops,platform,plan,collab,team}` 이다.
- `MenuOrderEditor`(C)의 "화면 반영은 다음 셸 갱신부터" 문구를 지운다(SP3a §9 #6). `navigation.menu` 의 순서·라벨이 이 브랜치부터 셸에 반영된다.

#### 5.4.3 전환기(★6, D4·D41)

- **워크스페이스 전환기**(`WorkspaceSwitcher`): 버튼에 현재 워크스페이스 이름. 소속이 2개 이상일 때만 목록(메뉴 버튼 + `role="menu"` 의 `menuitemradio`)을 연다. 고르면 `/w/<새 slug>` 로 간다 — 프로젝트 id·필터를 가져가지 않는다. S-8 ③ 이 '아니면'이면 이동 뒤 `router.refresh()` 로 라우터 캐시(`staleTimes.dynamic: 30`)를 비운다. 플랫폼 관리자가 소속이 아닌 워크스페이스를 보고 있으면 이름 옆에 "플랫폼 관리자로 보는 중" 칩을 달고 목록에는 넣지 않는다(D4).
- **프로젝트 전환기**(`ProjectSwitcher`): `role="combobox"` 입력(`aria-expanded`·`aria-controls`·`aria-activedescendant`) + 목록 `role="listbox"`. 구획은 즐겨찾기 → 최근 방문 → 전체(상태 칩)다. 입력은 셸이 이미 가진 현재 워크스페이스 프로젝트 목록을 클라이언트에서 거른다(목록은 전환기가 원래 가진 셸 데이터다 — ⌘K 검색과 다르다). ↑↓·Enter·Esc·Home·End. 네이티브 `<select>` 세 곳을 대체한다.
- **같은 모듈 유지**(D41): 고르면 `GET /api/nav/switch-target` 을 부르고 응답의 `href` 로 `router.push`, `fallbackModule` 이 있으면 토스트 "이 프로젝트에서는 {모듈}을 사용하지 않아 개요를 열었습니다."(개정 §5.10.3). 라우트 실패나 `degraded` 응답이면 `/p/<B>/dashboard` 로 가고 토스트 '설정을 불러오지 못해 개요를 열었습니다'를 띄우고 로그를 남긴다(D41 — 판정 실패를 '사용하지 않는 모듈'로 위장하지 않는다).
- `switchTarget({ pathname, search, targetProjectId, targetModules })` 규칙(순수, ⑦ 의 대상): 현재 경로가 `/p/<A>/<조각>/…` 이면 그 조각의 소유 모듈(`active.ts` 와 같은 규칙)을 본다. 대상에서 effective 면 **그 모듈 항목의 href**(동적 하위 경로는 접힌다 — `wiki/topics/<t>` → `wiki`, `agents` 허브 → `agents/office` 는 `p.agents` 의 href), 아니면 `/p/<B>/dashboard` + `fallbackModule`. 워크스페이스 범위에서 고르면 `/p/<B>/dashboard`. 쿼리는 보기 상태 화이트리스트 `view`·`density`·`scale`·`group`(D36)만 남긴다.
- **최근 방문**: `p/[projectId]/layout` 의 `ShellScope` 효과가 진입할 때 `recentProjects` 앞에 `{ id, at }` 를 넣고 중복을 빼 10개로 자른다(그 프로젝트의 워크스페이스 행에 저장 — §5.6). 권한을 잃은 항목은 렌더 때 교집합으로 빠진다.

#### 5.4.4 전역 바·브레드크럼·계정 메뉴(★10, D28·D33)

- `GlobalBar`: 높이 48, 전체 폭, 아래 1px `border`, 그림자 없음, `--z-shell`. 왼쪽부터 햄버거(1024 미만), 브랜드(§5.4.6, `/w/<s>` 링크), `ContextBreadcrumb`, 가운데 **찾기 자리**, 오른쪽 AI 아이콘(1024 이상, D33)·알림 벨(`InboxPanel` 팝오버)·계정 메뉴.
- `ContextBreadcrumb`: `워크스페이스 이름 / 프로젝트 이름 / 화면` 을 한 번만(`nav` `aria-label="현재 위치"`). 화면 이름은 `activeNavItem` 의 라벨이다. `SECTION_LABEL` 은 지운다. 범위가 워크스페이스(`/w/<s>/**`)이면 프로젝트 자리에 누를 수 없는 범위 칩 **'워크스페이스 전체'**(`surface-subtle` + `fg-secondary`, 12px 이상)를 둔다 — 공용 화면에서 이전 프로젝트가 선택된 것처럼 보이지 않게 한다(개정 §5.2·§5.3.3, 결정 6 — 비평 fidelity I3). `(global)` 범위는 칩을 두지 않는다. 찾기 상자의 범위 칩(SPU2)은 이 표시와 별개다.
- 찾기 자리: 가운데 영역을 비워 둔다(`data-slot="search"`). 누를 수 있는 컨트롤을 두지 않는다 — 대화상자가 없는 버튼은 죽은 조작이다. 대화상자·범위 칩·⌘K 는 SPU2 가 이 자리에 넣는다.
- 공지 티커(`HeaderAnnouncementTicker`)는 지운다(D28). 공지는 프로젝트 개요의 `AnnouncementStrip`(현행)과 포털 공지 위젯(UI-3)·알림 배지가 맡는다.
- `AccountMenu`(계정 팝오버): 이름·범위 역할 라벨(D42)·팀 코드, '내 계정'(`/account`), '화면 테마' 라디오 그룹(UI-1), 로그아웃. 관리 링크 셋은 내비의 '운영'·'플랫폼 운영' 그룹으로 옮겼으므로 없다.
- 키보드 계약(개정 §5.10.2, E25): 팝오버(알림·계정·워크스페이스 전환기)는 열리면 첫 항목에 초점, Esc·바깥 클릭으로 닫히고 트리거로 초점이 돌아온다. 모바일 드로어는 `role="dialog"` `aria-modal` 이고 초점을 가두며 Esc 로 닫히고 햄버거로 돌아온다. 층은 팝오버 `--z-popover`, 드로어 `--z-overlay`. 새 코드의 층 지정은 `z-(--z-…)` 형식이다(`z-[` 금지 — §4.1).

#### 5.4.5 모바일 드로어

`MobileNavDrawer`(1024 미만): 워크스페이스 전환기, 현재 범위의 내비(워크스페이스 또는 프로젝트 — `navFor` 결과 그대로), 프로젝트 범위면 `← 워크스페이스 홈` 과 `ProjectSwitcher`. 768 미만에서는 전역 바의 범위 이름 버튼이 같은 드로어를 연다(개정 §5.10.1 "상단 범위 선택 + 메뉴"). 경로가 바뀌면 닫는다.

#### 5.4.6 로고·accent·파비콘(★8, D23·D24)

- 브랜드 표시는 SP3a C 의 `brandMark()` 결과를 쓴다. 전체 로고(`full`, 136×28 contain)가 있으면 `.brand-logo-light` 로, `full_dark` 가 있으면 `.brand-logo-dark` 로 함께 그린다(두 클래스를 단 `<img>` 에는 display 유틸을 달지 않는다 — 크기별 전환은 바깥 래퍼, D24). 다크인데 `full_dark` 가 없으면 로고 뒤에 중립 배경판(`surface-raised` + `border`)을 둔다. 접힌 사이드바와 좁은 전역 바는 `mark`(28×28)다. 이미지는 `/api/brand/[workspaceId]/[slot]`(C)을 `<img>` 로 읽는다.
- `BrandMark.tsx`(C 파일 과제): `pathname === '/projects'` 판정을 지우고 `{ productName, hasMark, workspaceId, size }` 를 받는 표시 컴포넌트로 만든다. 포털 경로(`/w/<s>`)에서만 다른 아이콘을 쓰는 규칙은 두지 않는다 — 마크 규칙 하나(C §5.4)다.
- accent(D23): 범위 레이아웃이 `accentStyle(set)`(새 `src/lib/settings/accentCss.ts`, 순수)의 결과를 `<style>` 한 블록으로 넣는다. 함수는 라이트·다크 두 세트의 열두 값이 모두 `^#[0-9a-f]{6}$` 일 때만 `:root{…}` 를 먼저, `.dark{…}` 를 뒤에 내고, 하나라도 아니면 빈 문자열을 낸다(D23)(제품 기본 코발트 — 손상 저장값은 SP3a D39 대로 로그). 문자열 조립 밖의 입력은 없다.
- 파비콘은 S-6 결과를 따른다. `/p/*` 는 그 프로젝트의 워크스페이스 마크다.

#### 5.4.7 셸 조회 `/api/shell`(D34·D40, B 소유 파일)

| | 지금 | UI-2 뒤 |
|---|---|---|
| 요청 | `?route=<pid>&menu=<pid>` | `?ws=<wid>&project=<pid>`(둘 다 `ShellScope` 에서) |
| 응답 | `inbox`·`notifications`·`unreadAnnouncements`·`pendingApprovals`·`headerAnnouncements`·`headerAnnouncementsFailed` | `inbox`·`notifications`(프로젝트)·`badges: { myWorkReview, projectApprovals, projectUnreadAnnouncements }` — 각 값은 `number \| null`(null = 조회 실패, 로그를 남긴다). 티커 필드는 없앤다 |
| 판정 | `menu` 는 브리지 문맥 | `ws` 는 `isWorkspaceMember` 가 참일 때만 센다(아니면 null), `project` 는 B 의 관문 그대로 |
| 비용 | 이동당 GET 1회 | 이동당 GET 1회 유지(R25). `myWorkReview` 는 최대 2왕복(D40) |

`ShellStateProvider` 는 `(app)` 수준에 남고 `ShellScope` 가 바뀔 때만 다시 부른다. 알림 실시간 구독(`useInboxRealtime`)은 하나다.

### 5.5 PageHeader·PageFrame·RightRail·스크롤(★11, D18·D19·D54·D55·D56)

`PageHeader`·`PageFrame` 의 첫 판은 UI-2a 가 만든다(홈 v0·내 업무 v0). 어댑터·스크롤 단일화·레일은 UI-2b 다.

| 컴포넌트 | 계약 |
|---|---|
| `src/components/app/PageHeader.tsx` | props 는 개정 §5.4.4 그대로(`title`·`description`·`meta`·`primaryAction`·`secondaryActions`·`overflow`·`syncStatus`). `title` 은 모든 뷰포트에서 렌더하는 h1(`text-title`, 컴팩트 `text-title-sm`)이다. 높이 64~80, 컴팩트 48. 컴팩트에서는 `description`·`meta` 를 **CSS 로 숨긴다**(임의 미디어 한 클래스 — D55. 조건부 렌더는 SSR 첫 페인트가 데스크톱 모양이라 튄다). `secondaryActions` 는 보이는 것 2개까지, 나머지는 `overflow` 메뉴다. 버튼은 UI-1 의 `Button`·`IconButton` 이고 `disabled.reason` 은 옆 글 + `aria-describedby`. `syncStatus` 는 오른쪽 끝 자리만 둔다(SPU1) |
| `src/components/app/PageFrame.tsx` | `{ header: ReactNode; toolbar?: ReactNode; variant?: 'document' \| 'fill'; width?: 'portal' \| 'doc' \| 'form' \| 'full'; children }`. 문서형: 머리 + 도구 줄(`main` 안 `sticky top-0`, `--z-sticky`) + 본문 — 세로 `overflow` 가 없다. 도구 줄은 자기 높이를 `--frame-sticky-top`(ResizeObserver, 없으면 0)으로 루트에 내리고, 페이지 안 고정 요소는 `top-(--frame-sticky-top)` 를 쓴다(D54). 채움형: 루트에 `data-frame="fill"`, 세로 flex 로 남은 높이를 쓰고 본문은 `min-h-0 flex-1` 이며 스크롤은 자식(그리드)이 갖는다. 최대 폭 포털·개요 1440, 문서 760, 설정 폼 800, 표·간트 전체(개정 §5.4.1) |
| `ProjectPageShell`(어댑터) | `PageFrame header={hero} toolbar={pinned} variant={variant ?? 'document'}`. `AgentFrame` 은 예외다 — 컴팩트에서 `AgentHero` 대신 `PageHero title` 만 넘기고 탭은 `pinned` 한 곳에만(D18). 컴팩트에서 hero 를 빼던 분기와 안쪽 `overflow-y-auto`·`data-project-scroll-region` 을 지운다. `flush` 는 채움형의 아래 여백 0 으로 옮긴다 |
| `PageHero`(어댑터) | `title` 만 그리는 지금 모양을 유지하고 가시 조건(`hidden [@media(min-width:1280px)_and_(min-height:800px)]:grid`)을 지운다 — 모든 뷰포트에서 h1. 버리던 props 는 계속 버린다. 제목 문구(프로젝트 이름 반복 등)의 정리는 화면 소유 SP 다 |
| `src/components/app/RightRail.tsx` | `RightRailProvider`(`(app)` 수준, 점유자 `'inspector' \| 'ai' \| null` 하나)와 `RightRail` 틀. 틀은 `useRailMode()` 가 정한다: 병치 조건(개정 §5.4.3 — `viewport − sidebar − 400 − 2×gutter ≥ 720`)을 `matchMedia` 로 재서 참이면 `role="complementary"` 인 `#app-rail` 열(비모달), 아니면 `role="dialog"` `aria-modal` 오버레이(`--z-overlay`, 초점 가둠·Esc·트리거 복귀). 하나를 열면 다른 하나는 상태를 보존한 채 닫힌다. `useRailMode()` 는 SSR·첫 렌더에서 닫힘을 낸다(레일은 열린 채로 SSR 하지 않는다 — D55). 포털 대상은 `useRailHost()` 가 고른다 — WBS 전체 화면이 열려 있으면 그 컨테이너 안의 레일 자리다(D56). 교체 전 확인 콜백(`beforeSwitch`)을 받을 자리를 둔다 — dirty 판정은 SPU1 이 채운다. 상수 `RAIL_WIDTH = 400`·`RAIL_MIN_MAIN = 720` 은 한 파일에 둔다(개정 §8.1 #9 조정 대상) |

- 채움형은 UI-2b 에서 `/p/[projectId]/wbs` 하나다(D19). `globals.css` 의 `@layer components` 에 `.app-main { overflow-y: auto; scrollbar-gutter: stable }` 과 그 뒤 `.app-main:has([data-frame="fill"]) { overflow: hidden; scrollbar-gutter: auto }` 를 둔다(S-5). `main` 에는 overflow·scrollbar 유틸을 달지 않는다. WBS 전체 화면 모드는 UI-1 이 바꾼 값(`bg-canvas`·`--z-fullscreen`)을 쓴다.
- 페이지 안 `sticky` 13파일(25곳)은 `top-(--frame-sticky-top)`·`z-10` 이하로 바꾸고, 고치지 않는 파일은 사유를 적는다(D54).
- AI 패널: `AssistantChat`(B 소유, `(app)` 수준)이 1024 이상에서 FAB 대신 전역 바 아이콘으로 열리고, `createPortal` 로 `#app-rail` 에 그린다. 아이콘과 FAB 는 같은 탐침 결과(B 판정 P12)를 보고 404 면 둘 다 그리지 않는다. 1024 미만은 FAB 를 유지하고 저장 바나 가상 키보드가 보이는 동안 숨긴다(`visualViewport` 높이 변화, 저장 바는 `data-save-bar` 표지 관찰). 대화는 범위가 바뀌어도 남는다(`AssistantChat` 이 레일 밖에서 살아 있으므로). WBS 전체 화면에서 AI 를 열면 전체 화면 컨테이너 안의 레일 자리에 그린다(D56).
- `ReportModal` 의 h1 은 h2 로 바꾼다(E21). 모달·드로어가 닫히면 트리거로 초점이 돌아온다(`Modal.tsx` 현행). 트리거가 사라졌으면 인접 유효 행, 없으면 그 목록의 제목(h2), 그것도 없으면 페이지 h1 로 보낸다(개정 §5.10.2).
- 개요(`/p/[projectId]/dashboard`) 카드의 교차 모듈 표시(B 판정 P20, UI-2a): 이슈·공지·회의 카드는 그 모듈이 effective 일 때만 그린다. 페이지가 이미 부르는 `effectiveModules({ workspaceId, projectId })`(요청 캐시) 결과를 `DashboardView` 에 넘긴다. 같은 과제가 '이 프로젝트 회의록' 링크(D53 — `workspaceRefById` 의 슬러그)를 개요와 프로젝트 회의 화면에 둔다. 라벨 '개요'는 UI-2b(D30).

### 5.6 개인 설정 분리(D9·D10·D44, UI-2a)

| 파일 | 바뀌는 것 |
|---|---|
| `src/lib/domain/types.ts` | `UiPrefs` 에 `startPage?: 'home' \| 'my_work' \| 'projects' \| 'last_project'`, `favoriteProjectIds?: string[]`, `recentProjects?: { id: string; at: string }[]` 를 더하고 `heroCollapsed`·`lastProjectId` 를 지운다. `portalHiddenWidgets`·`projectsView` 는 UI-3 이 더한다 |
| `src/lib/prefs/split.ts`(새) | `ACCOUNT_PREF_KEYS`(`theme`·`locale`·`sidebarCollapsed`·`dashSections`·`minutesView`·`minuteFontSize`·`minutesExplorerLayout`·`wbsHideDone`·`wbsOutline`·`wbsGanttScale`·`notif`, UI-3 에서 `projectsView`) · `WORKSPACE_PREF_KEYS`(`startPage`·`favoriteProjectIds`·`recentProjects`·`notifRead`, UI-3 에서 `portalHiddenWidgets`) — 닫힌 두 목록이고 합집합 = `UiPrefs` 키 전부(테스트). `splitPrefs(patch)`, `mergePrefs(account, workspace)`. 목록 길이 상한(즐겨찾기 20, 최근 10)과 원소 형식 검사를 여기서 한다 |
| `src/app/actions/preferences.ts` | `getAccountPrefs()`(= `account_preferences` 자기 행의 `prefs`, 행이 없으면 `{}`), `getWorkspacePrefs(workspaceId)`(= `user_preferences` 그 행), `saveUiPrefs(patch, { workspaceId })` — 계정 키는 `account_preferences` 에, 워크스페이스 키는 `workspaceId` 행에 병합 upsert. `workspaceId` 가 없거나 `isWorkspaceMember` 가 거짓이면 워크스페이스 키를 버리고 로그를 남긴다. 병합 선행 조회 실패는 지금처럼 저장 중단(원칙 ②). `getUiPrefs()` 는 지운다 |
| `src/app/api/prefs/route.ts` | 본문 `{ prefs?, workspaceId?, wbsCollapse? }`. 서버 액션이 아닌 라우트인 이유(라우터 캐시)는 그대로다 |
| `src/lib/prefs/prefsWorkspace.ts` | 이름을 유지하고 주석을 "현재 워크스페이스를 모를 때의 폴백(첫 소속)"으로 바꾼다. 소비처는 `current.ts`·`notifications.ts`(프로젝트의 워크스페이스로 바꾼다)뿐이다 |
| `src/lib/prefs/sync.ts`·`PrefsSync.tsx` | 계정 키만 맞춘다(테마 규칙은 D10). 워크스페이스 키는 맞추지 않는다(서버만) |
| `actions/inbox.ts`·`actions/notifications.ts` | `notifRead` 는 그 프로젝트의 워크스페이스 행에 쓰고 읽는다(`actor.projectWorkspace`). `notif` 는 계정 키다 |
| `src/lib/settings/catalog-meta.ts`(A) | `PERSONAL_PREFS` 를 두 목록과 맞춘다(`heroCollapsed`·`lastProjectId` 삭제, 새 키 넷 추가, 각 키의 범위 '계정'·'워크스페이스' 열). C 의 `catalog:write` 로 문서를 다시 만든다 |

**마이그레이션**(D9). `account_preferences` 새 표 하나다. 파일은 `supabase/migrations/0013_account_preferences.sql`·`supabase/rollbacks/0013_account_preferences_rollback.sql`·`supabase/rehearsal/0013_account_preferences_seed.sql`(번호는 아래 절차로 확정).

| 순서 | 내용 |
|---|---|
| 1 | `create table public.account_preferences (user_id uuid primary key references auth.users(id) on delete cascade, prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'), updated_at timestamptz not null default now())`, `enable row level security` |
| 2 | 정책 셋 `account_preferences_{select,insert,update}_own`(`to authenticated`, `using`·`with check` 가 `user_id = auth.uid()`). 표 권한은 `revoke all … from public, anon, authenticated` 뒤 `grant select, insert, update … to authenticated` — delete·anon 없음(H2 규칙 2: 정책 없는 DML 권한 0). `updated_at` 은 기존 트리거 함수를 쓰고, 새 함수를 만들면 EXECUTE 를 public·anon·authenticated 에서 회수한다(H2 규칙 1) |
| 3 | 이행: 사용자마다 "가장 먼저 가입한 워크스페이스"(`workspace_members` 를 `created_at`·`workspace_id` 순 — `prefsWorkspaceId` 와 같은 규칙) 행의 `prefs` 에서 계정 키만 골라 `account_preferences` 에 넣는다. 모든 `user_preferences.prefs` 에서 계정 키와 `heroCollapsed` 를 지운다. `lastProjectId` 는 그 프로젝트가 있고 사용자가 아직 그 워크스페이스 소속이면 그 워크스페이스 행의 `recentProjects = [{ id, at: 행의 updated_at }]` 로 옮기고(행이 없으면 만든다), 아니면 버린다. uuid 가 아닌 값은 버린다(정규식 검사 뒤 캐스트) |
| 4 | 사후검사(`SP3B_ACCOUNT_PREFS_POSTCHECK` 로 멈춘다): 어떤 `user_preferences.prefs` 에도 계정 키·`lastProjectId`·`heroCollapsed` 가 없다. `has_table_privilege` 실효값 — authenticated 는 SELECT·INSERT·UPDATE 만, DELETE 없음, anon 은 아무것도 없다(H2 규칙 A9). 정책이 셋이고 모두 자기 행이다 |
| 롤백 | `account_preferences.prefs` 를 첫 소속 행의 `prefs` 에 되써 병합(행이 없으면 만든다)하고 표를 지운다. `recentProjects` 는 옛 코드가 무시하므로 남긴다. `lastProjectId` 는 되살리지 않는다(표시용 문맥이라 잃어도 기능 손실이 없다) |

- **번호 절차**(개정 §6.3 조건부 행 — "SP3a 뒤·SP4 앞에 맞춰 `0013`, 이하를 한 칸씩"): 개발 중에는 `0013` 이다. 창 ③ 직전 main 의 `ls supabase/migrations | tail -1` 이 `0012_settings.sql` 이면 그대로 둔다. 레인 A 가 `0013` 이상을 먼저 넣었으면(SP3a 마감의 이월 마이그레이션 등) `git mv` 로 다음 빈 번호로 바꾼다 — 이 rename 은 세 파일과 파일 안의 번호 주석·사후검사 이름만 담은 커밋이다(G1). rename 한 트리에서 래퍼로 `db:reset` → `dev:bootstrap` → `test:rls` 를 다시 돌리고 빈 커밋 `Staging-verified: local db reset <YYYY-MM-DD HH:MM> — 번호 변경 뒤 재리허설` 을 단다(G4 는 범위 안의 빈 커밋 트레일러를 인정한다). 이 문서·테스트·seed 는 파일명을 번호로 참조하지 않고 `account_preferences` 접미로 찾는다(비평 lanes L-I6·feasibility m12).
- **커밋 모양**: 마이그레이션 커밋은 `migrations/`·`rollbacks/` 두 파일만, 리허설 seed 는 별도 커밋, 테스트·코드는 또 다른 커밋이다(G1).
- 새 표는 RLS 불변식에 들어가야 초록이다 — `tests/rls/isolation-map.ts` 의 `A_ROW_FILTER`(`user_preferences` 와 같은 `t.user_id in A_ONLY`)와 쓰기 탐침 목록(그 파일 머리 주석: 새 표는 여기 없으면 실패), `h2-table-grants`·`schema-invariants` 의 기대값을 같은 브랜치의 **코드 커밋**에서 고치고 사유를 커밋 메시지에 적는다(마이그레이션 커밋과 섞지 않는다).
- 리허설: 래퍼로 `db:reset` → `dev:bootstrap` → `test:rls` 초록 뒤 마이그레이션 커밋에 `Staging-verified: local db reset <일시> — <요약>` 을 단다(G4). 이행 분기는 빈 DB 에서 0행으로만 돌므로 리허설 seed(계정 키·`lastProjectId`·두 소속을 가진 사용자 셋)를 적용한 DB 에서 한 번 더 돌린다. 롤백 리허설(적용 → 롤백 → 재적용)도 같은 스택에서 한다.
- D9 대안(마이그레이션 없음)을 사용자가 고르면: 계정 키는 첫 소속 행에서 읽고 쓰고, `lastProjectId` 이행은 첫 읽기 때 코드가 한다. `split.ts`·API 모양은 같다.
- 개인 설정은 서버 판정에 들어가지 않는다(개정 §2.8.5) — `tests/prefs/no-server-judgment.test.ts` 가 `src/lib/{authz,modules,settings}/**`·`src/lib/domain/authz.ts` 가 prefs 모듈을 import 하지 않음을 본다.

### 5.7 리터럴·파생(★4·★9, D6·D8·D27)

실측(§1.3 E2)의 130줄/42파일을 종류로 나눠 처리한다. 수치는 `b4283c0` 기준이고 레인 A 가 늘린다 — C 체크포인트 뒤와 `sp3a-done` rebase 때 다시 잰다(`route-literals` 허용 목록 대조). C 가 만든 옛 경로 리터럴(설정 페이지의 비관리자 redirect, '초대' 범주의 공용 팀 링크)은 UI-2 가 D7·`wsHref` 로 바꾼다(비평 lanes L-m4).

| 종류 | 처리 |
|---|---|
| 셸의 손목록·판정(`Sidebar`·`HeaderChrome`·`ProjectNavigationContext` — 약 40줄) | UI-2b 가 파일째 다시 쓰거나 지운다(§5.4). `ProjectNavigationContext.tsx`·`ProjectTabs.tsx`·`HeaderAnnouncementTicker.tsx` 삭제. UI-2a 동안은 `route-literals` 허용 목록에 사유 'UI-2b 가 파일째 다시 씀'으로 둔다 |
| 서버 이동 `redirect('/projects')` 9 · `router.push` 5 · `href="/projects"` 등 | D7 표(§5.2)로 |
| 화면 안 링크(회의록 탐색기·뷰어·목록, 회의 상세, 위키 출처, 이슈 출처, 에이전트 화면 링크, 사용 현황 `usageHref`, 버전 `viewHref`, 계정 화면 `router.push`) | 새 형식 `wsHref(slug, …)`. 서버 컴포넌트는 `loadWorkspaceScope`(`/w`)·`workspaceRefById`(`/p`)의 슬러그를 쓴다(UI-2a). 클라이언트 컴포넌트는 `useScope().workspace.slug`(D38 — 동기 컨텍스트, SSR 에도 값이 있다)를 쓴다(UI-2b). UI-2a 동안 클라이언트 링크(`WikiShared`·`minuteSourceHref` 소비처·`MeetingDetailModal`·`OfficeNav`·`MinuteViewer`·`AccountsManager` 등)는 옛 형식으로 스텁을 거치고 허용 목록에 사유 'UI-2b — 범위 컨텍스트 뒤'로 둔다. 헬퍼(`minuteSourceHref`·`usageHref`·데이터 층 `viewHref`)는 `base` 인자를 받는다 |
| **영구 링크**(D6): 색인 `ai_documents.href`(`lib/ai/index/content.ts`), 봇 출처(`deep-links.ts` 의 `minuteHref`·`myMeetingHref`), LLM 답변 본문(`minutes-answer.ts`), 외부 업로드 API 응답 `url`(`api/v1/minutes/route.ts` 두 곳) | **옛 형식을 유지한다.** 스텁이 해석한다. 외부 계약(`docs/design/dflow-minutes-upload-api-spec.md`)은 바꾸지 않는다 |
| 영구 링크를 읽는 곳 | `linkify.tsx` 의 `MINUTE_PATH_RE` 와 봇 문맥 `MINUTE_RE` 는 두 형식(`/minutes/<id>`·`/w/<s>/minutes/<id>`)을 받는다. `verifier.ts` 는 옛 뿌리와 `/w/[^/]+/<조각>` 뿌리를 모두 허용하고, 회의록 정확 일치(`:73` 부근)도 두 형식이다 |
| `revalidatePath` 38회(D8) | 라우트 그룹을 포함한 파일 경로 패턴 + 종류로(D8): 회의록 목록 `('/(app)/w/[slug]/minutes', 'page')`, 상세 `('/(app)/w/[slug]/minutes/[id]', 'page')`, 회의 `('/(app)/w/[slug]/meetings', 'page')`, 계정 `('/(app)/w/[slug]/admin/accounts', 'page')`, 공용 팀 `('/(app)/w/[slug]/admin/teams', 'page')`. 프로젝트 목록을 바꾸는 액션(`createProject` 계열 3·초대 합류 2)은 `('/(app)/w/[slug]', 'layout')` — 전환기 목록이 레이아웃 데이터라서다(`/projects` 이동과 C 의 레이아웃이 UI-2b 에서야 자리를 잡으므로 이 다섯 줄은 UI-2b 가 바꾸고, UI-2a 동안은 `route-literals` ① 의 임시 허용이다) |
| 레지스트리 `routePrefixes`(A, B 가 이어 고침)·`LEGACY_GLOBAL_PREFIXES` | 전역 경로 다섯을 `/w/[slug]/<조각>` 으로 바꾸고 `LEGACY_GLOBAL_PREFIXES` 를 지운다. `tests/modules/registry.test.ts` 의 모양 단언을 같은 커밋에서 |
| `tests/invariants/module-page-gates.test.ts`(B) | §2.4 표의 그 행(①~⑤ — `loadWorkspaceScope` 를 관문 앞 허용 호출로, 새 종류 없음, `PRE_GATE`·`EXCLUDED` 경로는 이동 커밋에서, `LEGACY_GLOBAL_PREFIXES` 삭제, 제외 목록 추가) |
| 사용 현황 키(D27) | `usageMenu.resolveMenuKey(path)` 는 `activeNavItem` 으로 항목 id 를 얻고 닫힌 표 `USAGE_KEY_OF: Record<NavItemId, UsageMenuKey>` 로 **기존 키**를 낸다(과거 집계와 이어지게). 새 키는 `ws-home`·`my-work` 둘. 옛 경로(`/minutes` 등)는 역사 데이터용 대응표로 같은 키를 낸다. `PROJECT_SEGMENT_KEYS` 는 이 표에서 파생한다. 표에 없는 항목 id 는 타입 오류다 |
| 봇 문맥(D27) | `inferDomain` 은 `activeNavItem` → 소유 모듈 → 레지스트리의 `botDomains` 첫 값. `issues` 가 빠진 기존 결함이 없어진다. `PageContextV1` 에 `workspaceId`(`ShellScope`)를 더한다. `/w/<s>` 홈·내 업무는 `projects` 도메인이다 |
| 딥링크(`deep-links.ts`) | 프로젝트 경로는 그대로(`projectMenuPath` 가 `navFor` 조각을 쓴다). `kanbanHref` 는 D36 형식. 워크스페이스 경로(`minuteHref`·`myMeetingHref`)는 영구 링크로 둔다 — 봇 문맥의 슬러그 주입은 SP8 도메인 주입과 함께 |
| 외부 문서 | `README.md:24`·`kit/README.md:63,73` 의 경로 표기를 `/w/<slug>/…` 로. `docs/baseline/**`(과거 기록)·사용자 문서(`docs/2026-09-26-…`)는 고치지 않는다. `scripts/smoke-prod.mjs` 는 `/login` 만 부른다 — 바꿀 경로가 없다(★9 의 스모크 부분은 확인만) |
| 테스트 | 옛 경로를 단언하는 약 42파일은 새 경로로 고치거나(화면 안 링크) 그대로 둔다(영구 링크). 파일 경로로 import·read 하는 테스트 7파일: `admin-teams-page-load-error`·`my-meetings-page-load-error`·`projects-home`·`roster-load-error-pages`(이동 커밋 — `params: { slug }`), `tests/ui/kanban-realtime.test.ts`(UI-3 — 칸반 원문 read), `tests/ui/app-layout-teams.test.tsx`(UI-2b — `(app)/layout` import, 팀 주입이 범위 레이아웃으로 옮겨 간다), `tests/authz/project-layout-hiding.test.tsx`(UI-2b — `p/[projectId]/layout` import, 2차 조회 mock). `tests/scripts/e2e.test.ts:326-335` 의 드리프트 원본 목록은 §2.4. `e2e.test.ts:91,96` 의 `app/(app)/projects/page` 는 가짜 매니페스트 값이라 고치지 않는다(비평 feasibility m4) |

**불변식 `tests/invariants/route-literals.test.ts`**: ① `src` 에서 첫 인자가 옛 전역 접두(`/projects`·`/meetings`·`/minutes`·`/agents`·`/portfolio`·`/usage`·`/admin/accounts`·`/admin/teams`)인 `revalidatePath` 0건(UI-2a 동안은 `/projects` 다섯 줄만 임시 허용 — UI-2b 에서 0) ② 첫 인자가 `'/('` 로 시작하는 `revalidatePath` 는 둘째 인자가 있고, 첫 인자에 둘째 인자(`/page`·`/layout`)를 붙인 파일이 `src/app` 아래 실제로 있다(파일 대조 — D8. 동작 테스트는 판별력이 없다) ③ 따옴표 접두 옛 경로 리터럴은 닫힌 허용 목록(파일 + 개수 + 사유)에만 있다 — UI-2a 동안의 임시 항목(옛 셸 파일·클라이언트 링크 파일, 사유에 'UI-2b' 표기 — UI-2b 체크포인트에서 0이어야 한다)과 영구 항목 `src/lib/workspace/legacy.ts`(변환표), `src/lib/ai/chat/deep-links.ts`(영구 2), `src/lib/ai/index/content.ts`, `src/lib/ai/minutes-answer.ts`, `src/app/api/v1/minutes/route.ts`, `src/components/minutes/linkify.tsx`, `src/components/chat/BotPageContextProvider.tsx`, `src/lib/ai/chat/verifier.ts`, `src/lib/domain/usageMenu.ts`(역사 키). 이 테스트는 주석을 세지 않는다(B 의 walker 규칙 — 리터럴 속 주석 표지 무시).

### 5.8 워크스페이스 범위로 좁히기(D21·D22·D26, B 판정 P13·P20·P28)

| 대상 | 지금 | UI-2 뒤 | 판정·검증 |
|---|---|---|---|
| 전역 페이지 관문 5(`requireModulePage(null, …)`) | 세션 유일 워크스페이스(P13) | `requireModulePage({ workspaceId: ws.id }, …)` | §5.3 표 |
| 회의 목록 액션 `fetchMyMeetings`·회의록 목록·검색 읽기(약 10)·폴더 넷(P28)·`refreshSeatmap`·`createMinute`(프로젝트 없음) | `requireSessionModule(null, …)` 또는 `resolveSoleWorkspaceId` | 인자 `workspaceId` 를 받고 `isWorkspaceMember(actor, wid)`(거짓이면 `ERR_MISSING` — 존재 은닉) 뒤 `requireModule({ workspaceId }, …)` | 매니페스트 항목·거부 표본 갱신(B `tests/gates/manifest.ts`). `createMinute(input, folderId, source, workspaceId)` — 프로젝트가 있으면 지금처럼 프로젝트 판정이고 `workspaceId` 는 무시 |
| 세션 라우트(B 과제 20 의 일곱 — `api/{track,chat/context,chat/command,chat,chat/stream,chat/v2/stream,minutes/export}`) — 프로젝트 없는 챗(v2 스트림·문맥·탐침), `/api/track`, 회의록 내보내기 | 세션 유일 워크스페이스 | **UI-2b**(요청을 보내는 `AssistantChat`·`UsageTracker` 가 `ShellScope` 를 읽게 된 뒤) — 요청의 `workspaceId` 로 판정. 프로젝트가 없고 `workspaceId` 도 없으면 400(추측하지 않는다) | 라우트 단위 테스트, 매니페스트 |
| `aiAvailable(null, …)` 호출부 | 유일 워크스페이스 | `aiAvailable({ workspaceId }, …)` | `tests/ai/ai-available.test.ts`(B)에 워크스페이스 케이스 덧붙임 |
| `resolveSoleWorkspaceId` | `(app)` 3·액션 1·주석 3 | `src/lib/authz/workspace.ts`(정의)·`api/v1` 2(SP7)·B `gate.ts` 의 `null` 경로(`api/v1` 이 쓴다)에만 남는다 | §9 의 grep |
| 포트폴리오 | 전 워크스페이스(`getPortfolioInputs()` 무인자) | `getPortfolioInputs(workspaceId)` — 그 워크스페이스 프로젝트만 | 단위 |
| 에이전트 현황 | `canViewAgents(actor)` = 어느 워크스페이스든 역할, `seatmapProjectIds` 슈퍼유저 = 전 프로젝트 | `canViewAgents(actor, wid)` = `hasProjectRoleInWorkspace(actor, wid)`, `seatmapProjectIds(actor, wid)` = 그 워크스페이스 프로젝트 가운데 멤버 이상(슈퍼유저는 그 워크스페이스 전부). service_role 로더(`getSeatmap`)는 `loadWorkspaceScope` 와 관문 뒤에서만, 이 목록으로만 읽는다 | 단위 + E2E(B 계정 404) |
| 사용 현황 | 플랫폼 전역 | 그대로 + 범위 칩 '플랫폼 전체(워크스페이스 구분은 SP8)'(D21) | 눈확인 |
| 계정·공용 팀 | 페이지 슈퍼유저 전용, 액션 `requireWorkspaceAdmin` | 페이지도 슬러그 워크스페이스 관리자(D22). `listTeamsAdmin(workspaceId)` 는 슬러그의 id 를 받는다. `listAccounts(projectId)`(D 소유)는 시그니처를 두고, 페이지가 슬러그 워크스페이스의 프로젝트만 후보로 넘기며 응답의 `workspaceId` 가 슬러그와 다르면 404 로 끝낸다. 플랫폼 조작(`resetPassword`·`setPlatformAdmin`)은 `isSuperuser` 일 때만 렌더(액션 가드는 그대로 `requireSuperuser` — 11곳 불변) | 단위(렌더 분기), `platform-guards` 무수정 초록 |
| 셸 프로젝트 목록·팀·신원 | 전 워크스페이스(`listProjectsWithState` 무필터, 팀 = 소속 전부, `isAny*`) | 현재 워크스페이스로(§5.4.1·D42) | 단위 |
| 교차 모듈 표시(P20) | 모듈을 보지 않는다 | 개요 카드(§5.5 끝)·회의록 상세의 연결 이슈·위키 영향은 SP3b. 봇 `get_project_dashboard` 의 회의는 SP8, v1 `meta` 의 회의 목록은 SP7, 인박스 범주는 SPU2(§11) | 단위 |

### 5.9 홈 v0·내 업무 v0·프로젝트 목록 로더(D20·D39·D40)

`src/lib/data/portal.ts`(서버 전용, 세션 클라이언트 + RLS, service_role 없음). 결과형은 `members.ts` 관례의 `Loaded<T>` 다.

| 함수 | 내용 | 왕복 |
|---|---|---|
| `getMyWork(workspaceId, { kinds?, cursor?, limit? ≤ 50 })` | 원천 레지스트리 `MY_WORK_SOURCES`: `wbs`(모듈 `wbs` — `wbs_items.assignee_member_id` ∈ 내 명단 행, 미완료), `issue`(`issues` — `issue_assignees.member_id` ∈ 내 명단 행, 열린 범주), `approval`(`agents` — D40), `meeting`(`meetings` — 오늘의 `meeting_attendees`). 원천마다 그 모듈이 effective 인 프로젝트만 `in('project_id', …)` 로 읽는다(D39 — 모듈이 어디서도 effective 가 아니면 조회하지 않는다). 행은 `{ kind, id, title, projectId, projectName, due, overdueDays, status, href }`, 기한 순. 병합 규칙: 커서 = `(due, kind, id)` 이고 원천마다 `(due, kind, id) > 커서` 로 `limit` 행을 읽어 합친 뒤 앞 `limit` 행을 낸다. WBS 의 '미완료' = `actual_pct is null or actual_pct < 100`, 기한 = `planned_end`, 리프(자식 없는 행)만이다(`wbs_items` 에는 상태 열이 없다 — 비평 feasibility m18). 여러 프로젝트에 걸친 조회는 `.range()` 로 끝까지 읽는다(D51). 반환은 `{ ok: true; rows; nextCursor; failedKinds: MyWorkKind[] }` — 원천 하나의 실패는 전체 실패가 아니라 `failedKinds` 로 알리고, 위젯은 받은 행과 함께 "일부 항목(이슈)을 불러오지 못했습니다"를 `StatusMessage kind="partial_error" compact` 로 보인다(개정 §5.9.1 의 `Loaded<T>` 에 없는 확장 — §7 반영 지시 11) | effective 판정 2 + 원천별 1 (병렬) |
| `getProjectRows(workspaceId, { q?, status?, favoritesOnly?, cursor?, limit? ≤ 50 })` | `projects.eq('workspace_id', wid)` + 진척 완료 여부(현행 `getProjectsCompletion` 을 그 워크스페이스로 좁힌 판) + 상태(`projectLifecycleStatus`). `q` 는 서버 `ilike`. `favoritesOnly` 는 워크스페이스 prefs 로 | 2 |
| `listWorkspaceProjects(workspaceId)` | 셸용 가벼운 목록 `{ id, name, status, isAdmin }` — 전환기·즐겨찾기 교차. `projects.select('id, name, start_date, end_date').eq('workspace_id', wid)` 전체를 `.range()` 로 끝까지 한 번 읽고, 상태·관리자 여부는 순수 계산(`projectLifecycleStatus`·`actor`)이다. `getProjectRows`(쪽 나눔·필터)와는 쿼리가 달라 캐시를 나누지 않는다(비평 feasibility m19) | 1 |
| `countMyReview(workspaceId)` | D40 | ≤ 2 |

- '오늘'은 `seoulToday()` 다(SP5 Phase A 가 워크스페이스 시간대로 바꾼다 — 레인 A 에 알릴 것 5).
- 홈 v0(`w/[slug]/page.tsx`): `PageFrame width="portal"` + `PageHeader title="홈"` + 섹션 '지금 처리할 일'(h2, `getMyWork` 20행, 56px 행, 행 링크) + 섹션 '진행 중인 프로젝트'(`getProjectRows` 활성 20행) + 섹션 '공지'(`getWorkspaceAnnouncements(wid, { limit: 5 })` — 그 워크스페이스 프로젝트의 게시 중 공지, `announcements` 가 effective 인 프로젝트만. 티커를 지우는 UI-2b 의 대체 표면 — D20·D28). 각 섹션의 실패는 그 섹션만 `StatusMessage kind="partial_error"`(재시도 = `router.refresh()`), 0건은 `kind="empty"` 문구.
- 내 업무 v0(`w/[slug]/my-work/page.tsx`): `PageHeader title="내 업무"` + 종류 칩(링크 `?kind=`, `aria-current`) + 목록(50행, '더 보기' = `?cursor=` 링크). 탭·인스펙터·알림 탭은 SPU2.

### 5.10 UI-2 의 오류 처리·권한 요약

| 경로 | 원칙 |
|---|---|
| 슬러그 조회 오류, 소속 목록 조회 오류 | 404 가 아니다. 범위 레이아웃이 던져 `(app)/error.tsx`(셸 없는 화면 전체 오류)가 받고, 리졸버는 화면 전체 오류를 그린다(원칙 ①). 페이지 자신의 오류는 범위의 `error.tsx`(셸 안 — D2) |
| 설정·모듈 읽기 실패(범위 레이아웃) | 던지지 않는다 — `CORE`·레지스트리 순서·제품 기본으로 그리고 셸 머리 알림 + 로그, `children` 렌더(D49) |
| 전환 대상 판정 실패 | `degraded` 응답 → 개요 + '설정을 불러오지 못해 개요를 열었습니다'(D41) |
| 권한 조회 실패(열화) | 404 가 아니다. 내비 caps 는 전부 false(어포던스 fail-closed), service_role 로더는 부르지 않는다, `DegradedNotice` 를 그린다 |
| 배지·셸 조회 실패 | `null` — 그리지 않고 로그(0 으로 위장하지 않는다) |
| 개인 설정 쓰기의 선행 조회 실패 | 저장 중단(원칙 ②). 워크스페이스 키의 대상 워크스페이스가 소속이 아니면 그 키를 버리고 로그 |
| 옛 경로 스텁 | 쿠키는 힌트 — 소속을 다시 본다. 회의록 행을 못 읽으면 존재를 드러내지 않는다 |
| 새 판정 함수 | `navCapsFor`·`canViewAgents(actor, wid)`·`canManageTeams(actor, wid)`·`canManageWorkspaceAccounts` 는 `src/lib/authz/**`, `inheritedProjectRole`(UI-3)은 `src/lib/domain/authz.ts`. 액션에 `role === '…'` 을 쓰지 않는다. 새 가드는 없다 |
| 보안·권한 게이트 리뷰(R-std 적대적 탐색 대상) | 슬러그 판정과 `/w/<B>` 404(레이아웃·페이지·스텁), `/minutes/[id]` 스텁, 쿠키 검증, 개인 설정 쓰기 경로와 열 권한, 계정·공용 팀 화면의 노출 확대, 좌석표·포트폴리오의 한정, 전환 대상 라우트(숨김 프로젝트 404) |

### 5.11 위키 초안 키 이행(D52, UI-2b)

| 파일 | 바뀌는 것 |
|---|---|
| `src/lib/drafts/wikiDrafts.ts` | 키 `draft:v2:<userId>:<workspaceId>:<projectId>:wiki:<topicId>`(개정 §5.8.5 규격의 첫 사례). 읽기는 새 키 → 없으면 옛 `wiki-draft:v2:<userId>:<projectId>:<topicId>` 순이고, 옛 키에서 읽은 초안은 새 키로 쓴 뒤 옛 키를 지운다. 단 사용자가 복구·폐기를 고르기 전에는 옛 키를 지우지 않는다(개정 §5.8.5 복구 순서) |
| `src/components/wiki/WikiDocumentEditor.tsx` | `workspaceId` 를 `useScope().workspace.id`(D38)에서 읽는다. 범위가 없으면(열화) 초안 저장을 끄고 로그를 남긴다 — 워크스페이스 없는 키를 만들지 않는다 |
| 로그아웃 정리(H1 과제 12 경로) | `draft:v2:<userId>:` 와 `wiki-draft:v2:<userId>:` 두 접두를 모두 지운다 |

테스트 `tests/drafts/wiki-draft-key.test.ts`: 새 키 형식, 옛 키 이행(복구 결정 전 보존), 로그아웃 정리 두 접두, 범위 없음 → 저장 안 함. 일반 초안 정책·`security.local_drafts` 는 SPU1 이다(§11).
## 6. UI-3 — 대표 3화면과 SP3b 소유 화면(`ui/sp3-screens`)

착수는 UI-2 머지 뒤다(그러므로 `sp3a-done` 뒤). 두 설정 키 등록이 SP3a 의 "정확히 14키" done_when 뒤여야 하고, 설정 화면 기능이 C·D 산출물이기 때문이다. main 머지는 레인 A(SP4)의 체크포인트 직후 창이다(D46). 이 단계의 끝이 **사용자 눈확인 게이트**(⑪)다.

### 6.1 워크스페이스 홈 v1(포털, 개정 §5.9.1)

| 요소 | 결정 |
|---|---|
| 머리 | `PageHeader title="홈"`, `meta` = "오늘의 업무 · 9월 29일 화요일 · 시간대 Asia/Seoul"(SP5 전에는 서울 고정 — 문구에 시간대를 적는다). 시간대 이름은 `seoulToday` 와 같은 모듈의 상수에서 읽는다 — 새 파일에 리터럴로 쓰면 `no-runtime-constants`(정본 §6.5 표 — 새 파일은 허용 목록에 오르지 못한다)에 걸린다. SP5 가 워크스페이스 `calendar.timezone` 으로 바꾼다. 거대한 환영 영역은 없다 |
| 요약 수치 | `getPortalSummary(wid)` → 내 담당·검토 대기·오늘 마감 셋. 칸마다 독립 실패('—' + `title` 에 사유)이고 각 칸은 `/w/<s>/my-work?kind=…` 링크다. 검토 대기 칸은 검토할 수 있는 사용자에게만(아래 역할별) |
| 위젯 레지스트리 | `src/lib/portal/widgets.ts` 의 `PORTAL_WIDGETS: readonly { id: PortalWidgetId; labelKey; module: ModuleId \| null; column: 'main' \| 'side'; needs: 'reviewer' \| null }[]` — `my_work`(main, null), `projects`(main, null), `review`(side, `agents`, reviewer), `upcoming`(side, `meetings`), `recent_docs`(side, `minutes`), `announcements`(side, `announcements`). 열 배치는 제품 고정이고 순서는 열 안에서 `portal.widgets` 를 따른다 |
| 노출 식 | `portal.widgets` 에서 켜진 것 ∧ `portalHiddenWidgets`(개인)에 없음 ∧ (모듈이 null 이거나 그 워크스페이스의 어느 프로젝트에서든 effective — `effectiveModulesMany`) ∧ (`needs` 가 null 이거나 충족) |
| 위젯 로더 | `my_work` = `getMyWork(wid, { limit: 20 })` + 탭 링크 `[전체][내 담당][검토]`(`?tab=`), `projects` = `getProjectRows(wid, { status: 'active', limit: 20 })`(이름·현황과 근거·다음 기한), `review` = D40 의 행(20), `upcoming` = `getUpcomingMeetings(wid, { limit: 5 })`(오늘 이후 가장 가까운 회차), `recent_docs` = `getRecentDocuments(wid, { limit: 5 })`(회의록 — 위키 문서는 SP8), `announcements` = `getWorkspaceAnnouncements(wid, { limit: 5 })`(그 워크스페이스 프로젝트의 게시 중 공지, `announcements` 가 effective 인 프로젝트만). 전부 `src/lib/data/portal.ts`, 로더당 왕복 상수(프로젝트별 반복 없음) |
| 부분 실패(⑥) | 위젯마다 `<Suspense>` 경계와 독립 로더다. `{ ok: false }` 인 위젯만 `StatusMessage kind="partial_error" compact`(재시도 = `router.refresh()`)로 바뀌고 나머지는 그대로다. 0건은 `kind="empty"` — 실패를 0건으로 그리지 않는다 |
| 업무 행 | 56px, 종류 아이콘 + 글·제목·프로젝트·기한(날짜 + 지연 N일 — 색만으로 뜻을 전하지 않는다)·상태 pill. 행 전체가 링크다. 목록에서 일괄 승인은 없다 |
| 역할별 | `reviewer` = 그 워크스페이스에서 `agents` 가 effective 인 프로젝트의 관리자이거나 `countMyReview > 0`. 아니면 `review` 위젯과 요약의 검토 칸을 만들지 않는다. 관리자 홈의 '프로젝트 준비'(UX-01)는 SP9 — 이번에는 그리지 않는다(빈 자리·죽은 조작을 두지 않는다). 개정 §5.9.1 의 '자리'는 `PortalWidgetId` 에 `setup_checklist` 를 예약하지 않고, main 열 첫 칸을 SP9 가 쓸 수 있다는 것을 `PORTAL_WIDGETS` 주석으로 남기는 것으로 한다 |
| 개인 숨김 | 위젯 머리의 `IconButton`(`aria-label="이 위젯 숨기기"`) → `portalHiddenWidgets`(워크스페이스 키). 숨긴 위젯이 있으면 목록 끝에 "숨긴 위젯 N개 다시 보기" 링크 한 줄 |
| 격자 | 12열 gap 24, main 8 + side 4, 1024 미만 한 열(main 먼저 — CSS 격자 유틸, D55). 최대 폭 1440 |

### 6.2 프로젝트 목록 `/w/[slug]/projects`(개정 §5.9.1·UX-02)

- 행 목록이 기본이다: ☆(`aria-pressed`, `favoriteProjectIds` 토글, 최대 20)·이름·상태 칩·기간·진척. 카드 보기는 개인 선택(`projectsView: 'rows' \| 'cards'` — 계정 키, UI-3 이 `split.ts`·`PERSONAL_PREFS` 에 더한다).
- 검색 입력은 서버 `q`(URL 쿼리), 상태 필터 칩, '즐겨찾기만' 토글. 50행을 넘으면 '더 보기'(커서).
- 생성: `canCreate` 이면 `PageHeader.primaryAction` '새 프로젝트' → `NewProjectModal`(C 의 빈 값/복사). 대상 워크스페이스는 슬러그의 것이고 대화상자에 이름을 글로 보인다(고를 수 없다). `?new=1` 로 들어오면 열린 채로 시작한다(§5.4.2 사이드바 어포던스).
- 어두운 히어로(`.hero-card`)·hover 이동은 없다(UI-1 에서 평면이 됐다 — 이 화면에서 마크업째 지운다).

### 6.3 작업 계획 — 보기 전환(개정 §5.9.2, D36·D43)

첫 과제는 **칸반 흡수**다(D36 — UI-2 는 칸반 페이지를 그대로 두었다): 보드를 `wbs` 안에서 그리는 커밋(`ViewSwitch`·`KanbanBoard` 의 `group` 쿼리·`WbsRealtimeRefresh` 이관), `kanban/page.tsx`·`kanban/loading.tsx` 삭제와 열째 스텁 `(legacy)/p/[projectId]/kanban/route.ts`, 진입점(`InboxPanel.tsx:84`·`verifier.ts:31`·`deep-links.kanbanHref`)의 새 형식, `tests/ui/kanban-realtime.test.ts` 의 대상 변경을 한 과제로 한다. `legacy-redirects` 의 `/kanban` 케이스와 E2E E3 도 이 단계다.

| 요소 | 결정 |
|---|---|
| 보기 결정 | 페이지가 `searchParams.view` → 없으면 `views.default.wbs` → `'sheet'`. `board` 는 `requireModule({ projectId }, 'kanban')` 이 통과할 때만. URL 로 `?view=board` 를 요청했는데 꺼져 있으면 `sheet` 를 그리고 도구 줄 위에 `StatusMessage kind="disabled" compact` "이 프로젝트에서는 보드를 사용하지 않습니다"(관리자에게는 설정 '모듈·메뉴' 링크) |
| `ViewSwitch`(`src/components/wbs/ViewSwitch.tsx`) | 표·간트·보드를 **링크**로(`?view=`, 다른 쿼리 보존 — `focus` 제외), 현재 보기에 `aria-current="page"`. 보드 탭은 `kanban` 이 effective 일 때만 있다(회색 탭 없음) |
| 프레임 | `PageFrame variant="fill"` 하나에 `PageHeader`(`title="작업 계획"`, 주 동작 '작업 추가' — 표·간트일 때, 보드일 때는 없음) + 도구 줄(`ViewSwitch` + 기존 필터) + 본문. 표·간트 = `WbsGanttSheet`(`defaultView` 에 `sheet`·`timeline`), 보드 = `KanbanBoard`(엔진 무변경, `group` 쿼리로 묶음 기준 — D36). 1280×720 에서 제목·주 동작·보기 전환·필터 줄이 남는다 |
| 인스펙터 레일 | `RowDetailPanel` 을 `RightRail` 틀에 싣는다: 병치 조건이 참이면 `role="complementary"` 비모달(본문 조작 가능), 아니면 지금처럼 오버레이. 폭은 기존 `wbs.detailPanelWidth`(320~640, 기본 400). AI 패널과 단일 점유. WBS 전체 화면에서는 전체 화면 컨테이너 안의 레일 자리에 그린다(D56) |
| 표시 분리 | 행 저장 중 표시는 중립(`fg-muted` 스피너)이고 상태색(완료·지연)과 섞지 않는다 |
| 옛 링크 | `/p/<id>/gantt`(→ `?view=timeline`)·`/p/<id>/kanban`(D36 스텁 — 이 단계에서 더한다)·`/p/<id>/wbs` 는 모두 동작한다 |

### 6.4 설정 두 화면의 시각 패턴(개정 §5.9.3, SP3a 스펙 §5.3)

기능(범주·출처·섹션 저장·영향 미리보기·409 비교)은 C 산출물이고 바꾸지 않는다. UI-3 은 다음만 한다.

- `PageHeader`(`title` = '프로젝트 설정'·'워크스페이스 설정')와 C 의 `SettingsShell` 을 개정 §5.9.3 모양으로: 왼쪽 범주 목차(현재 범주 `aria-current`)·필드 검색, 본문 최대 폭 800, 저장 바는 `main` 안 `sticky bottom-0` 이고 그 높이만큼 본문 아래 여백을 예약한다(마지막 입력·오류를 가리지 않는다).
- `ConfigStateNotice`(C)의 다섯 상태를 `StatusMessage` 로 그린다: 조회 실패 → `partial_error`, 설정 손상 → `partial_error`(그 키 자리, 사유 문구), 필요 설정 없음 → `needs_setup`(관리자에게만 설정 경로), 비활성 모듈 → `disabled`(켜는 경로), 패치 전체 거부 → 저장 바 위 `role="alert"`. 필드 오류는 `Field` 의 오류 배선(UI-1)이다. 컴포넌트 이름과 호출부는 유지한다(C 테스트 `config-state-notice` 가 계속 초록).
- **두 키 등록과 편집기**(D25·D43, 개정 §6.1-3 네 연결):

| 키 | 정의(`SettingDef`) | 편집기 | 소비처 | 테스트 |
|---|---|---|---|---|
| `portal.widgets`(workspace, 소유 모듈 core `settings`) | `{ id: PortalWidgetId; enabled: boolean }[]`. parse: id 는 `PORTAL_WIDGETS` 의 id, 중복 없음, 빠진 id 는 레지스트리 순서로 뒤에 붙인다(켜짐). 기본값 = 레지스트리 순서 전부 켬. `apply: 'immediate'`, `impact: 'none'`, 편집 주체 워크스페이스 관리자 | 워크스페이스 설정 '메뉴' 범주의 '홈 위젯' 구역 `PortalWidgetsEditor` — 행마다 스위치와 위·아래 버튼(끌기만의 조작 없음), 범주 저장 바로 저장 | 포털(§6.1) | `tests/settings/registry.test.ts` 16키, `catalog-sync`, `tests/portal/widgets.test.ts`(노출 식) |
| `views.default`(project, 소유 모듈 `wbs`) | `{ wbs: 'sheet' \| 'timeline' \| 'board' }`(D43). 기본값 `{ wbs: 'sheet' }`. 저장 때 `board` 는 `kanban` effective 일 때만 — 아니면 `CONFIG_INVALID` 필드 오류(교차 검사 자리는 `src/lib/settings/validateConfig.ts` 의 `validateProjectConfig` — §2.4). `apply: 'immediate'`, `impact: 'none'`, 편집 주체 프로젝트 관리자 | 프로젝트 설정 '모듈·메뉴' 범주의 '작업 계획 기본 보기' 구역 `ViewsDefaultEditor` — 라디오 셋, `kanban` 이 꺼져 있으면 보드 항목을 비활성 + 사유 글 | 작업 계획(§6.3) | `registry`·`catalog-sync`·`tests/wbs/view-switch.test.tsx` |

  `catalog-meta.ts` 의 `PLANNED_KEYS` 에서 두 키를 빼 등록 키로 옮기고 `npm run catalog:write` 로 `docs/settings-catalog.md` 를 다시 만든다. `registry.test.ts` 의 "portal.widgets·views.default 미등록" 단언을 "등록"으로 바꾼다. 두 키는 개정 §2.6.2 R1(키 추가, 기본값 = 현행 동작 — 포털은 새 화면, 작업 계획의 첫 보기는 지금도 표)이라 `SETTINGS_SCHEMA_VERSION` 과 데이터 이행이 없고, 설정 표는 `values` 의 키만 늘어 마이그레이션이 없다(`0012` 의 쓰기 RPC 는 키 목록을 묶지 않는다 — 참조 검사 디스패처에 분기가 없다).

### 6.5 명단 실효 역할(P7-6.3, D37)

- `src/lib/domain/authz.ts`: `inheritedProjectRole(wsRole: WorkspaceRole \| null, accessRole: ProjectRole \| null): EffectiveRole` = `wsRole === 'admin' ? 'admin' : (accessRole ?? 'viewer')`. `roleIn` 의 ⑤⑥ 이 이 함수를 부른다.
- `/p/[projectId]/members`: 페이지가 세션 클라이언트로 `workspace_members.select('user_id, role').eq('workspace_id', wid)` 를 한 번 읽어 `Map<userId, role>` 을 만든다(B 관문 줄과 숨김 판정 뒤). 표에 '실효 역할' 열을 더한다 — 값은 `inheritedProjectRole(roleOf(row.userId), row.accessRole)` 의 라벨(관리자·멤버·조회 전용)이고, 워크스페이스 관리자에서 온 관리자면 배지 "워크스페이스 관리자에서 상속"을 단다. 계정 없는 외부 인력은 명단 역할 그대로다. 워크스페이스 역할 조회가 실패하면 열 전체를 '확인 불가'로 그리고 로그를 남긴다.
- 명단 편집(`RosterManager`)의 역할 선택은 바꾸지 않는다 — 실효 역할은 표시 정직성 열이다. 이 화면의 다른 이행(PageHeader·KPI 정리)은 SP4 다.

### 6.6 SP3b 가 소유한 그 밖의 화면(개정 §5.9.4 적용표의 SP3b 행)

| 화면 | UI-3 에서 하는 것 |
|---|---|
| `/account` | `PageHeader`, 구역 '화면'(테마 3단·언어 — UI-1), '현재 워크스페이스'(쿠키 워크스페이스 이름 + `startPage` 선택 — D44), '목록 보기'(`projectsView`). 밀도는 SPU2 |
| `/w/[slug]/admin/accounts` | `PageHeader`, 조회 실패는 `StatusMessage`, 프로젝트 선택은 그 워크스페이스 프로젝트만, 플랫폼 조작 구역은 플랫폼 관리자에게만(D22). 문구 i18n 은 개정 §8.1 #26 대로 미배정 |
| `/invite/[token]` | 단일 작업 모양: 워크스페이스 이름·프로젝트 이름·받을 권한·초대된 이메일을 보인다(본인 식별). 합류 뒤 `/p/<pid>/dashboard`(§5.2 D7). 브랜드는 env `BRAND_*` 그대로 |
| 리졸버의 '소속 없음' 화면 | UI-2 에서 만든 `NoWorkspaceView` 의 토큰·문구 확인 |
| `/w/[slug]/projects`·포털·작업 계획·설정 둘·`/kanban`·`/admin/ui-states`·`/login` | §6.1~§6.4, UI-1 |
| 개요 `/p/[id]/dashboard` | 라벨 '개요'와 교차 모듈 표시만(UI-2). 위젯 이행은 SP4 |

### 6.7 인스펙터 병치 임계값(개정 §8.1 #9)

UI-0 스크린샷과 UI-3 의 작업 계획 캡처(1440·1400·1366·1280 × 펼침·접힘)로 `RAIL_MIN_MAIN = 720` 을 확인한다. 표의 필수 열(코드·이름·상태·기간)이 병치에서 잘리면 값을 올리고 `tests/shell/rail-mode.test.ts` 의 경계값을 같은 커밋에서 고친다.

### 6.8 사용자 눈확인 게이트(⑪, 개정 §5.12.1 UI-3)

- 대상: 대표 3화면(워크스페이스 홈·작업 계획·프로젝트 설정) × 1440×900·1280×720·768×1024·390×844 × 라이트·다크 × accent 셋(기본·밝은 값·어두운 값) — 72 조합.
- 부담을 줄이는 방법(D29): 에이전트가 행렬 전부를 D48 의 방법으로 캡처해 한 장짜리 대조표(`/Users/jerry/D-Flow/.superpowers/qa/sp3b/ui3-sheet.html` — 리포 밖 로컬 HTML, merge-base 와 나란히)로 만들고 `docs/baseline/sp3b-ui.md` 에 표를 올린다. 사용자는 대조표 전체를 훑고, 라이브 서버에서는 표본 여섯(3화면 × 1440 라이트·390 다크)만 조작해 본다.
- 라이브 서버: 레인 B 프로덕션 빌드 `http://127.0.0.1:3201`. 안내문: "새 Chrome 프로필 또는 시크릿 창에서 `http://127.0.0.1:3201` 을 연다 — `localhost:3000` 로그인과 섞이지 않게"(§2.5-5). 계정은 그 작업이 만든 임시 계정이다.
- 함께 묻는 것: 공지 티커 제거(개정 §8.1 #7 — §10.1 #7), 인스펙터 병치 임계값(#9 실측값), 새 IA 라벨(D30).
- 기록: `docs/baseline/sp3b-ui.md` 의 "사용자 확인" 절에 일시·대조표 확인·라이브 표본·지적 사항을 나눠 적는다. 지적은 이 브랜치에서 고치고 그 행만 다시 본다(수정 라운드 최대 2 — R-std). 통과 전에는 UI-5(다른 SP 의 화면 이행)를 시작하지 않는다.

## 7. 마감

1. 로컬 E2E 전체(§8.3)와 `docs/baseline/sp3b-e2e.md`, 성능(§8.4)과 `docs/baseline/sp3b-perf.md`, 눈확인 기록(§8.5)을 main 에 둔다(창 — D46).
2. 원장 `.superpowers/sp3b/progress.md` 에 Phase 별 실측 노력(벽시계·에이전트 시간·사람 대기)과 재산정을 적는다(§10 #8).
3. `git tag sp3b-done`(로컬 태그 — 개정 §6.1-6).
4. **개정 문서 반영 지시**(SP3b 는 개정 문서를 직접 고치지 않는다 — §2.2). 마감 문서 커밋 하나가 아래를 한 번에 반영한다. 개정 문서 커밋은 한 번에 한 레인만 한다.

| # | 개정·정본 자리 | 반영할 것 | 근거 |
|---|---|---|---|
| 1 | 개정 §5.3.2 옛 경로 호환 규칙·§5.12.1 UI-2 행 | "옛 `page.tsx` 스텁" → `(legacy)` 라우트 그룹의 `route.ts`(307, `no-store`, `Location` 은 요청 원점), 스텁은 영구, `/minutes/[id]` 는 행의 워크스페이스, `/kanban` 은 `view` → `group` 이고 처분은 UI-3 | D5·D6·D36, E4·E17·E27·E39 |
| 2 | 개정 §5.3.1 현재 워크스페이스 쓰기 규칙 | 쿠키는 셸이 클라이언트에서 쓰고, 읽는 곳은 리졸버·`(global)` 레이아웃·목록형 스텁 | D3 |
| 3 | 개정 §5.3.6 | 전환기 = 소속 기준(플랫폼 관리자 예외 표시), 같은 모듈 유지 = 전환 대상 라우트, 화이트리스트에 `group` | D4·D41, E10·E30 |
| 4 | 개정 §5.7.3·§6.2 SP3b 블록 | `/admin/ui-states` = `getActorForView` + `canViewUiStates`(`requireSuperuser` 아님) | D16, E5 |
| 5 | 개정 §2.8.2·§5.11.2·§2.8.5·§5.9.4 #18 | `views.default` = `{ wbs }`, 프로젝트 기본 밀도는 SPU2 의 별도 키. 개인 `density` 는 SPU2(소비처와 함께). §2.8.5 표에 범위(계정·워크스페이스) 열과 `projectsView`·`notifRead`·기존 표시 키 일곱을 더한다 | D9·D43, E28·E33 |
| 6 | 개정 §5.4.2 | 채움형은 작업 계획, 주간·근태는 화면 소유 SP 가 전환 | D19, E29 |
| 7 | 개정 §5.5.4·§5.5.2 | 추가 토큰(`today-fg`·상태 `*-fg`·`category-*-weak`·`phasebar-fill`·`critical-weak`), 원색 변수 표기 `--p-*` | D11·D12, E13 |
| 8 | 개정 §5.0 5-D11·§6.8 D5-§9 | `portal.widgets`·`views.default` 는 SP3b 등록 | D25, E12 |
| 9 | 개정 §8.1 #5·#7·#8·#9·#21, §5.6 no-flash 행 | #5 닫힘(D9 — `account_preferences`, 실제 번호), #7 게이트 결과, #8 임계값, #9 값, #21 닫힘(2026-09-29 사용자). no-flash 행의 "값이 없을 때 `matchMedia`"에 "(COM-6 전에는 light)" | §10, E16 |
| 10 | 개정 SP3b 블록 수치·줄 인용 | 리터럴 130줄/42파일·`revalidatePath` 38, `resolveSoleWorkspaceId` 호출 4·주석 3, 줄 인용을 심볼로 | E1·E2·E3 |
| 11 | 개정 §5.9.1 `Loaded<T>`·"로더마다 1왕복"·§6.4 R25 "위젯당 1왕복" | `getMyWork` 의 `failedKinds`, "로더당 상수 왕복(최대 3, 프로젝트 수와 무관)" | §5.9, E35 |
| 12 | 개정 SP4 블록 | `p/[projectId]/layout.tsx` 가 `UI_RE` 에 들어갔다 — 팀 주입 변경은 `ui/` 브랜치·트레일러 | §2.4 알림 4 |
| 13 | 개정 SP5 블록(§4.2.8 소비처) | `src/lib/data/portal.ts` 의 '오늘' | §2.4 알림 5 |
| 14 | 개정 SPU2 블록·SP3b 블록 '범위 제외'·§5.9.4 #7·§5.12.1 UI-2 행 | 내 업무 v0 는 SP3b(UI-2a) — SPU2 는 탭·인스펙터·알림 탭을 더한다, 찾기 자리 `data-slot="search"`, 프로젝트 기본 밀도 키(별도 키, R1), 우측 레일 교체 확인(`beforeSwitch`)의 dirty 판정은 SPU1 | D20·D43, E34 |
| 15 | 정본 §3.2.5 | #3 `SECTION_LABEL` 14항목 삭제, #4 `ProjectTabs` 삭제, 5·6·9행의 파생 완료 | E9·E24 |
| 16 | 정본 §8 #10·#16 | #10 공지 티커 — UI-3 게이트 결과, #16 다크 토글 위치 닫힘 표기 | 실측 canon X-5, §10.1 #7 |
| 17 | 개정 §6.3 | SP3b 노력 실측과 재산정 | §10 #8 |
| 18 | 개정 SP4·SP5·SP5b·SPU3 블록의 화면 이행 항목 | "12px 미만·uppercase 제거"(UI-1 은 공용 클래스 넷·공용 컴포넌트 다섯만 했다) | D14, E22 |
| 19 | 개정 §8.1 #5·§6.3 조건부 행·SP3b 블록 마이그레이션 행 | `profiles.ui_prefs` → 새 표 `account_preferences`(자기 행 RLS — 동료 노출 방지) | D9, E32 |
| 20 | 개정 §6.1-4 | "'만진다' = 화면의 구조·흐름을 바꾸는 작업. 경로 이동·토큰 치환·표시 열 하나·링크 하나 추가는 해당 없음" 한 문장 | E36 |
| 21 | 개정 §5.12.5 ③·SP3a §10.1 | 셸 소비 케이스의 파일 = `tests/shell/nav-consumption.test.tsx`('같은 파일' 대체) | E37 |
| 22 | 개정 SP4·SP5 블록(액션 소유 SP) | 기존 `revalidatePath('/p/${…}', 'layout')` 약 33줄은 맞는 태그가 없다(효과는 같다) — 그 액션을 만지는 SP 가 라우트 그룹을 포함한 파일 경로 패턴으로 고친다 | D8 |
| 23 | 개정 §5.12.1·§6.2 SP3b 블록 | UI 단계 UI-2 → UI-2a(경로·IA)·UI-2b(셸), main 쓰기 창, SP4 경계 | D45·D46·D47, E38 |
| 24 | 개정 §6.3 번호표 | 조건부 행 이후의 번호를 실제 머지 순서로 다시 적는다(SP3b 가 받은 번호와 SP4 이하의 밀림) | D9 |
| 25 | 개정 §5.8.5·§5.3.3 | 위키 초안 키 이행 완료(SP3b UI-2b), '이 프로젝트 회의록' 링크·`?project=` 범위 칩 담당 SP3b | D52·D53 |

## 8. 테스트와 검증

모든 명령은 레인 B 워크트리에서 래퍼(§2.5-0)로 돈다 — env(§2.5-4)를 싣고 스택을 확인하고 무거운 실행이면 공유 잠금을 잡는다. vitest 는 `--maxWorkers=2` 다.

### 8.1 단위·정적(`npm run test`, DB 없음)

| 파일(Phase) | 고정하는 것 |
|---|---|
| `tests/scripts/perf-grid.test.ts`(UI-0) | 같은 시드에서 같은 행, 중앙값·백분위, 원격 URL·3000 포트 거부, `LOCAL_DB_URL` 없음·54322 이면 멈춤, DOM 행 수 ≠ 시드 행 수이면 실패(D51) |
| `tests/scripts/ui-capture.test.ts`(UI-0) | 라우트 목록 형식, 픽셀 차 계산(합성 이미지), 원격·3000 거부, 가림 선택자 주입 문자열(D48) |
| `tests/css/contrast-tokens.test.ts`(UI-1, 다시 씀 — E15) | 라이트·다크를 모두 파싱하고 `var()` 를 풀어 계산한다. 쌍 목록은 테스트 파일 안 **닫힌 표**(쌍·목표·출처 — 개정 §5.5.3·§5.5.4 또는 D12·D15)다: 개정 대비표의 모든 쌍(글자 4.5, 비글자 3.0), 채움 배경 위 `*-fg` 4.5, `category-N` 글자 / `category-N-weak`, `today-fg` / `today`, `phasebar-fill` / `plan-track`(3.0), `critical` / `critical-weak`, `today` 선 / `weekend`·`holiday-band`(3.0) — 라이트·다크 둘 다. 메타 단언: `globals.css` 의 의미 색 토큰은 모두 한 쌍 이상에 들거나 '장식 전용' 목록(`border`·`plan-track` 등)에 있다. 인쇄 블록의 의미 토큰 집합 = 라이트 `@theme` 의 의미 토큰 집합이고 값이 같다(D50·§4.1 블록 10). `accentTokens.ts`(A) 기준 색 = `globals.css` 의미 토큰 값. 대비 계산은 `accent.ts` 의 `contrastRatio` 하나(비평 ui-risk m3) |
| `tests/css/no-raw-color.test.ts`(UI-1) | className 의 `#hex`·`rgb(`·`z-[`·팔레트 유틸(`bg-amber-400` 등) 금지. 허용 목록 = 착수 때의 위반 파일(E26), 목록은 줄기만 한다 |
| `tests/css/display-cascade.test.ts`(UI-1) | D17 의 ①~④ — 임의 브레이크포인트 display 와 안전망 클래스 혼용, 안전망 클래스가 있는 className 의 조건부 display 토큰(기존 위반 `WikiSearchResults.tsx:169` 은 사유와 함께 허용 목록 — UI-2b 에서 0), `brand-logo-*` 요소의 display 토큰, 안전망 `VARIANT` 밖 변형의 display |
| `tests/css/global-rule-layers.test.ts`(UI-1) | `globals.css` 에서 `:focus-visible`·`::selection`·`body`·`.dark`·원색 `:root`·비색 토큰·인쇄 블록이 `@layer` 블록 밖에 있다(D50). 값에 `var(--color-` 가 든 커스텀 프로퍼티는 `@theme inline` 안에 있거나 선언 셀렉터 목록에 `.dark` 와 `[data-theme-scope]` 가 함께 있다(§4.1 블록 8, 비평 ui-risk I4) |
| `tests/css/breakpoint-safety-net.test.ts`(기존) | **파일 무수정** 초록 |
| `tests/lib/theme-policy.test.ts`·`tests/ui/theme-provider.test.tsx`·`theme-write.test.tsx`·`account-theme.test.tsx`(UI-1) | 테마 3값, `system` 의 `matchMedia` 구독, `noFlashScript()` 를 jsdom 에서 실행한 결과(미설정 → `THEME_UNSET_DEFAULT`, `system`+어두운 OS → 다크, localStorage 실패 → 쿠키), 계정 팝오버·`/account` 의 라디오 그룹(방향키, 첫 렌더 선택 없음 + `aria-busy`, 하이드레이션 경고 0 — D10) — ⑨ 의 단위 부분 |
| `tests/lib/prefs-sync.test.ts`(UI-1, 고침) | 로컬 선호가 없으면 테마를 백필하지 않는다(D10). 서버 값이 이긴다 |
| `tests/minutes/mermaid-render-config.test.tsx`(UI-1) | mermaid 테마 = 해석값 |
| `tests/authz/ui-states-access.test.ts`·`tests/ui/ui-states-page.test.tsx`(UI-1) | 플랫폼 관리자만, actor null 404. `tests/invariants/platform-guards.test.ts` 무수정 초록(11곳) |
| `tests/components/{status-message,button,field}.test.tsx`(UI-1) | `StatusMessage` 8종의 `role`, loading 이 0 을 그리지 않음, `Button` busy(`aria-busy`·중복 제출 차단·폭 유지), icon-only `aria-label` 필수(타입), `Field` 의 `aria-invalid`·`aria-describedby`, readonly ≠ disabled |
| `tests/settings/accent.test.ts`(A, UI-1 이 고침) | 표본 10종의 통과·거부 기대값(§4.7) |
| `tests/routes/legacy-redirects.test.ts`(UI-2a·UI-2b·UI-3 — 스텁을 더하는 단계마다) — ① | 스텁 열 개의 `GET` 을 직접 불러(세션·조회 mock) 307·`Location`(요청 원점 기준)·`Cache-Control: no-store`·`dynamic = 'force-dynamic'`. 옛 9경로 × 쿼리(없음·하나·여럿·인코딩) 보존, `_rsc` 는 옮기지 않는다. `/minutes/<id>` 는 행의 워크스페이스가 쿠키보다 앞선다, 행을 못 읽으면 현재 워크스페이스로. `/admin/accounts?project=` 는 프로젝트의 워크스페이스. `/kanban?view=phase&team=X` → `wbs?view=board&group=phase&team=X`(UI-3). 소속 0 → `/` |
| `tests/workspace/{resolve,current,list}.test.ts`(UI-2a) | 슬러그 형식 밖은 조회 없이 `missing`, 조회 오류는 `unavailable`(404 아님), 쿠키 워크스페이스가 소속이 아니면 무시하고 첫 소속, 목록은 소속 행만(플랫폼 관리자도) |
| `tests/authz/nav-caps.test.ts`(UI-2a) | D42 의 표와 actor null = 전부 false |
| `tests/shell/nav-consumption.test.tsx`(UI-2b, jsdom — E37) — ③ | `navFor` 를 import 해 B 의 `nav-for.test` 와 같은 모듈 × caps × `navigation.menu` 조합표로 `WorkspaceNav`·`ProjectNav`·`MobileNavDrawer`·`ContextBreadcrumb` 를 렌더해 `navFor` 결과와 **같은 항목만** 있다. 모듈을 끄면 네 곳에서 모두 사라진다. 라벨 덮기가 반영된다. B 파일은 고치지 않는다. 직접 링크의 404 는 B 의 관문 테스트와 아래 '이동 페이지' 행이 본다 |
| `tests/nav/active.test.ts`(UI-2a) | `activeNavItem` — 슬래시 조각(`agents/office`), `routePrefixes` 대응(`import`·`gantt`·`wiki/topics`·`minutes/<id>`), `aria-current` 는 하나 |
| `tests/nav/switch-target.test.ts`(UI-2a) — ⑦ | 같은 모듈 유지, 대상에서 꺼지면 개요 + `fallbackModule`, 동적 하위 경로 접기, 쿼리 화이트리스트(`view`·`density`·`scale`·`group`), 워크스페이스 범위에서 고르면 개요 |
| `tests/api/switch-target-route.test.ts`(UI-2a) | 숨김 프로젝트 404, 비로그인 401, 응답 모양, 모듈 집합 판독 실패 → `degraded: true`·`fallbackModule: null`(D41), `CORE_ROUTE_ALLOW` 등록, 매니페스트 등록(B `tests/gates/enumerate.test.ts` 가 새 라우트를 요구) |
| `tests/shell/*.test.tsx`(UI-2b) | `app-shell`(범위별 내비, 열화 = caps false + `DegradedNotice`, **설정 읽기 실패** — `effectiveModules` 가 `ConfigUnavailableError`·`ConfigKeyError` 를 던지면 core 항목만·알림·children 렌더, `navigation.menu` invalid 면 레지스트리 순서(D49)), `workspace-switcher`(소속 2 이상만 목록, 플랫폼 관리자 칩), `project-switcher`(콤보박스 키보드·구획·전환 라우트 호출·토스트), `account-menu`(관리 링크 없음, 테마 라디오, Esc → 트리거 초점), `mobile-drawer`(초점 가둠·Esc·복귀), `global-bar`(티커 없음, 찾기 자리에 조작 없음, 탐침 404 면 AI 아이콘 없음, 워크스페이스 범위 = 칩 '워크스페이스 전체' 있음·프로젝트 이름 없음, 프로젝트 범위 = 칩 없음, `(global)` = 칩 없음), `rail-mode`(병치 경계값 1440·1400·1280 × 펼침·접힘, SSR·첫 렌더 = 닫힘), `rail-host`(WBS 전체 화면이 열리면 포털 대상 = 전체 화면 안 레일 자리 — D56), `scope-context`(SSR 에 슬러그가 있다 — D38), `shell-scope`(게시, 쿠키는 값이 바뀔 때만 씀), `brand`(로고 두 클래스, 다크 배경판, `accentStyle` 이 `'red;}'`·`'</style>'` 를 내지 않음, 한 세트만 유효한 입력 → 빈 문자열, 출력 순서 `:root` 다음 `.dark` — D23) |
| `tests/invariants/route-literals.test.ts`(UI-2a, UI-2b 에서 임시 항목 0) | §5.7 의 ①②③ — ② 는 파일 대조(D8) |
| `tests/invariants/page-h1.test.ts`(UI-2b) — ④ | `<h1` 은 닫힌 허용 목록 파일에만(`PageHeader`·`PageHero`·`error.tsx`·`not-found.tsx`·로그인·초대·공유 뷰어·`NoWorkspaceView`·`MinuteViewer` 등, 파일과 개수). `PageHeader`·`PageHero` 는 컴팩트에서도 h1 을 렌더하고 `hidden`·`sr-only` 가 없다. `ProjectPageShell` 어댑터는 컴팩트에서 머리를 렌더한다. 라우트별 실제 h1 개수는 눈확인(§8.5)이 잰다 |
| `tests/invariants/scroll-owner.test.ts`(UI-2b) | `src/app/**/page.tsx` 와 `PageFrame` 문서형에 세로 `overflow-(y-)auto` 가 없다. `main` 의 className 에 `overflow`·`scrollbar` 유틸이 없다(D19). 채움형 닫힌 목록 = `p/[projectId]/wbs/page.tsx`(S-7 결과에 따라 `/w/[slug]/minutes`). `/w/[slug]/agents/page.tsx` 에 손으로 준 `h-full` 틀이 없다(`/agents` 사고 회귀). `globals.css` 의 `.app-main` 본문이 `overflow-y: auto`·`scrollbar-gutter: stable` 을 갖고, 그 뒤 채움 규칙이 `overflow: hidden; scrollbar-gutter: auto` 다 |
| `tests/invariants/workspace-page-gates.test.ts`(UI-2a, 필요할 때만 — §5.2) | `/w/[slug]/**/page.tsx` 의 첫 await 가 `loadWorkspaceScope` |
| `tests/invariants/sole-workspace.test.ts`(UI-2a, UI-2b 에서 0) | `src/app/(app)`·`src/app/actions`·`src/components`·`src/app/api`(`api/v1` 제외)·**`src/lib/**`**(제외: 정의·`api/v1` 전용 넷 — `modules/{gate,pageGate,aiAvailable}.ts`·`authz/workspace.ts`)에서 `resolveSoleWorkspaceId\|requireSessionModule\(null\|requireModulePage\(null\|aiAvailable\(null` 0건(주석 포함). 리터럴 `null` 만 본다 — 변수 인자는 리뷰 대상이다. 대상 목록은 `sp3a-done` rebase 때 다시 grep 한다(비평 lanes L-m10·feasibility m24) |
| `tests/prefs/{split,save-route,no-server-judgment}.test.ts`(UI-2a) | 두 키 목록이 서로소이고 합집합 = `UiPrefs` 키, 상한·형식. 저장 라우트: 계정 키 → `account_preferences`, 워크스페이스 키 → 소속일 때만 그 행, 비소속이면 버림 + 로그, 선행 조회 실패면 저장 중단. 판정 모듈이 prefs 를 import 하지 않음(개정 §2.8.5) |
| `tests/domain/usage-menu.test.ts`(UI-2a, 다시 씀) | `/w/<s>/<조각>` 과 옛 경로가 같은 키, 새 키 `ws-home`·`my-work`, 모든 `NavItemId` 에 키가 있다 |
| `tests/chat/infer-domain.test.ts`(UI-2a, 문맥의 `workspaceId` 는 UI-2b) | 레지스트리 파생, `/p/x/issues` → `issues`, 문맥에 `workspaceId` |
| `tests/ai/deep-links.test.ts`·verifier 테스트(UI-2a, `kanbanHref` 는 UI-3) | `minuteHref` 옛 형식(영구), verifier 두 형식 허용, `kanbanHref` 새 형식(UI-3) |
| `tests/api/shell-route.test.ts`(UI-2b) | 새 계약, 배지 실패 → `null`, 비소속 `ws` → `null` |
| `tests/data/portal-v0.test.ts`·`tests/modules/effective-many.test.ts`(UI-2a) | 꺼진 모듈의 원천은 조회하지 않음, `failedKinds`, 워크스페이스 한정, 커서 병합 규칙·WBS 미완료 정의, 여러 프로젝트 조회가 `.range()` 로 끝까지 읽음(1,000행을 넘는 픽스처), `countMyReview` 최대 2왕복·`countApprovable` 재사용. `effectiveModulesMany` = 프로젝트마다 B 뒤의 `effectiveModules` 한 값(픽스처 셋, 하나는 프로젝트의 워크스페이스가 인자와 다른 CR-5 경우) |
| 이동 페이지의 로드 오류·숨김 테스트(UI-2a, 고침) | 비소속 404(`loadWorkspaceScope`), 열화면 service_role 로더 미호출(좌석표), `params: { slug }`, 워크스페이스 `modules.allowed` 에서 `minutes` 를 뺀 픽스처로 `/w/[slug]/minutes` 페이지가 404(③ 의 워크스페이스 모듈 직접 링크 — 비평 fidelity m6. 내비에서 `ws.minutes` 가 없는 것은 `nav-consumption`) |
| `tests/modules/registry.test.ts`(A)·`tests/invariants/module-page-gates.test.ts`·`tests/gates/manifest.ts`(B)(UI-2a, 이어 고침) | 새 `routePrefixes`, `LEGACY_GLOBAL_PREFIXES` 없음, 관문 앞 허용 호출 `loadWorkspaceScope`(새 종류 없음), 옮긴 `PRE_GATE`·`EXCLUDED` 경로, 새 시그니처·라우트(`CORE_ROUTE_ALLOW` 포함) |
| `tests/minutes/minutes-project-filter.test.ts`(UI-2a) | `?project=` — 접근 가능한 pid 는 거르기 + 칩, 접근 불가·다른 워크스페이스 pid 는 쿼리 무시(존재 은닉), 칩 × 링크는 쿼리 제거(D53) |
| `tests/drafts/wiki-draft-key.test.ts`(UI-2b) | §5.11 |
| `tests/scripts/e2e.test.ts`(A, UI-2b 가 이어 고침) | 드리프트 원본 목록에 새 오류 경계 셋이 있다, `PAGE_MARKERS` 표지가 `StatusMessage` 표준 문구와 겹치지 않는다 |
| 셸 테스트 약 31파일(실측 shell §11)(UI-2b) | 새 셸 테스트로 다시 쓰거나 지운다(`project-navigation-bridge` 등). 지우는 파일은 커밋 메시지에 대응하는 새 테스트를 적는다 |
| `tests/portal/{widgets,partial-failure,loaders}.test.ts(x)`(UI-3) — ⑥ | 노출 식, 로더별 `{ ok: false }` → **그 위젯만** `StatusMessage` 오류 카드이고 나머지는 그대로, 0건은 빈 상태, 요약 칸의 독립 실패 '—', 검토 권한 없는 사용자에게 `review` 없음 |
| `tests/settings/registry.test.ts`(A)·`catalog-sync`(C)(UI-3, 이어 고침) | 16키 등록, 두 키의 카탈로그 상태 |
| `tests/settings/{portal-widgets,views-default}-def.test.ts`(UI-3) | parse 규칙, 빠진 위젯 id 보충, `kanban` 이 꺼진 프로젝트의 `board` 저장 거부 |
| `tests/wbs/view-switch.test.tsx`(UI-3) | 링크·`aria-current`, 보드 탭은 `kanban` effective 일 때만, `?view=board` + 꺼짐 → 표 + 안내, 기본 보기 = `views.default` |
| `tests/ui/kanban-realtime.test.ts`(UI-3, 대상 변경)·`validateConfig` 테스트(A, UI-3 이 이어 고침) | 보드의 실시간 새로고침이 `wbs` 페이지로 옮겨 갔다, `views.default.wbs='board'` 는 `kanban` 이 꺼진 프로젝트에서 `CONFIG_INVALID` |
| `tests/authz/inherited-role.test.ts`·`tests/ui/members-effective-role.test.tsx`(UI-3) — P7-6.3 | `roleIn` 과 `inheritedProjectRole` 의 동치표(모든 `wsRole` × `accessRole`), 워크스페이스 관리자인 명단 member 는 실효 관리자 + 상속 배지, 나머지는 배지 없음·실효 = 명단 역할(null = 조회 전용), 조회 실패는 '확인 불가' |
| `tests/components/settings-status.test.tsx`(UI-3) | `ConfigStateNotice` 다섯 상태 → `StatusMessage` 종류. C 의 `config-state-notice` 테스트는 계속 초록 |

### 8.2 실행형(`npm run test:rls`, 건너뜀 0)

- 래퍼(§2.5-0)로만 돈다 — `RLS_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres`(§2.5-4). 이 값이 없으면 하네스가 레인 A DB 에 붙으므로 래퍼가 멈춘다.
- `tests/rls/account-preferences.test.ts`(UI-2a, D9): 자기 행 읽기·쓰기(insert·update) 성공, **같은 워크스페이스 동료가 남의 계정 설정을 읽지 못한다(0행)**, 남의 행 insert·update 거부, delete 권한 없음(42501), anon 은 아무것도 못 한다, 실효 권한(`has_table_privilege`), 이행 리허설 seed(§5.6)에서 계정 키 이동·`lastProjectId` → `recentProjects`·탈퇴한 워크스페이스의 값 폐기. H2 규칙 5 대로 부트스트랩 계정에 기대지 않는다(CI 의 db 잡은 부트스트랩 없이 돈다). 새 표를 `tests/rls/isolation-map.ts` 의 `A_ROW_FILTER`·쓰기 탐침 목록에 넣고, `workspace-isolation`·`h2-table-grants`·`schema-invariants` 는 기대값을 고친 채 초록이다(§5.6).
- 그 밖의 SP3b 변경은 SQL 이 없다. 포털·내 업무 로더의 격리는 세션 클라이언트 + 기존 RLS 이고, 실행 증거는 E2E(§8.3 E4·E10)다.

### 8.3 로컬 E2E

서버는 레인 B 프로덕션 빌드(래퍼로 `npm run build` → `npx next start -p 3201`, `E2E_BASE_URL`·`NEXT_PUBLIC_APP_URL` = `http://127.0.0.1:3201` — §2.5). 계정은 스크립트의 기존 셋(부트스트랩 관리자 — 플랫폼 관리자이고 워크스페이스 A 관리자, `ana` — A 멤버, `bea` — B 전용)에 `duo`(A·B 둘 다 멤버)를 더한다. 옛 경로 호출(`b4283c0` 기준 15~19곳, `sp3a-done` rebase 때 다시 센다)은 새 경로로 바꾼다(실측 routes §9.1). 기록은 `docs/baseline/sp3b-e2e.md`.

- **스크립트 수명**(비평 lanes L-m5): `sp3a-done` 전에는 SP3b 단계를 `scripts/e2e-sp3b.mjs` 로 따로 돌린다. 이 파일은 `ui/sp3-menu` 브랜치 안에서만 쓰고 UI-2 마무리(창 ③ 직전 rebase 뒤)에서 `scripts/e2e-local.mjs` 로 합치고 지운다 — main 에는 들어가지 않는다. 레인 A 의 SP4 가 같은 파일에 단계를 더할 수 있으므로 D46 의 창 규칙을 따른다.
- **단계별 범위**: UI-2a 체크포인트 = E1·E2·E4·E6·E8·E9·E11, UI-2b 체크포인트 = 전체(E3 제외), UI-3 = E3 추가.

| # | 단계 | 기대 |
|---|---|---|
| E1 | `ana` 가 옛 경로(UI-2a 여덟, UI-2b 에서 `/projects` 추가) × 쿼리 | 각각 307, `Location: /w/<A>/…`(요청 원점), 쿼리 그대로 |
| E2 | A 회의록의 `/minutes/<id>` — `ana`, 그리고 `bea` | `ana`: 307 → `/w/<A>/minutes/<id>` 200(제목 포함). `bea`: 307 → 최종 404(S-2 판정 방식) |
| E3 | (UI-3) `/p/<pid>/kanban?view=phase&team=X` | 307 → `/p/<pid>/wbs?view=board&group=phase&team=X`, 보드가 그려진다 |
| E4 | `bea` 가 `/w/<A>`·`/w/<A>/minutes`·`/w/<A>/agents` | 404, 본문에 A 프로젝트 이름(센티널)이 없다 — ⑧ |
| E5 | (UI-2b) `duo`·`ana`·부트스트랩 관리자의 `/w/<A>` | `duo` 만 전환기 트리거에 목록 표지(`data-ws-switcher="list"` — 소속 2 이상일 때만 트리거에 단다. 목록 `role="menu"` 는 열 때만 렌더되므로 트리거로 단언한다). 부트스트랩 관리자는 소속 수대로(D4) — ⑧ |
| E6 | `duo` 가 `/w/<A>/minutes`·`/w/<B>/minutes`, 그리고 `/w/<B>/minutes` 에서 프로젝트 없는 `createMinute`(워크스페이스 B) | 둘 다 200 이고 각 워크스페이스의 회의록 제목만 있다. 새 회의록의 `workspace_id` = B(SP3a R15 해소) |
| E7 | (UI-2b) 프로젝트 A 의 `issues` 를 끄고(B 의 3단계와 같은 액션) `/p/A/dashboard` | 데스크톱 사이드바 HTML 에 `/p/A/issues` 링크가 없다. 다시 켜면 있다 — 정본 SP3 메뉴 조건. 드로어(`role="dialog"`, 열 때만 렌더)는 `nav-consumption` 단위 테스트(③)가 본다 |
| E8 | `/` — `ana`(쿠키 없음), `duo`(쿠키 `dflow-ws=<B>`), `ana`(쿠키 `dflow-ws=<B>` 위조) | `/w/<A>`, `/w/<B>`, `/w/<A>` 로 307 |
| E9 | `ana` 의 `GET /api/nav/switch-target?project=<issues 꺼진 pid>&path=/p/<다른 pid>/issues`, `bea` 의 같은 요청 | `{ href: '/p/<pid>/dashboard', fallbackModule: 'issues' }`, `bea` 는 404 |
| E10 | (UI-2b) `bea` 의 `GET /api/shell?ws=<A>` | `badges.myWorkReview` 가 `null` — 남의 워크스페이스 수를 흘리지 않는다 |
| E11 | `duo` 가 B 회의록 본문의 옛 링크(`/minutes/<id>`)를 클릭(헤드리스) | 최종 `/w/<B>/minutes/<id>` 200, 오류 경계 없음(S-8 — 비평 ui-risk I8) |

### 8.4 성능(개정 §6.4 R25, D32)

- **판정 기준은 SP2 기준선(`h2-done`) 대비 +20%** 다(개정 R25 문언 — `docs/baseline/sp2-perf.md` 와 같은 경로·페르소나, SP3a §7.4 ① 과 같은 방법). 같은 스택에서 ① `h2-done` ② `sp3a-done` ③ `ui/sp3-menu`(UI-2b 머리)를 차례로 재서 ②→③ 증가분도 적는다(원인 분리). 측정은 UI-2b 체크포인트에서, 창 ③ 직전 rebase 뒤 한 번 더.
- **스택 안전**(비평 feasibility F-I8·lanes L-I8): `supabase` 명령은 **레인 B 워크트리에서 래퍼로만** 돈다. 기준 커밋의 스키마는 레인 B 워크트리를 그 커밋으로 detach 해서(작업 트리가 깨끗해야 한다 — `config.toml` 은 `h2-done`~`b4283c0` 사이 무변경이다) 래퍼로 `db:reset` → `dev:bootstrap` 을 돌려 적용하고, `lane-b-run.sh true` 로 설정을 다시 확인한 뒤 `ui/sp3-menu` 로 되돌린다. 서버는 스크래치 워크트리(①·② — 3202·3203, `ui/sp3-menu` 는 레인 B 워크트리의 3201)에서 `next build`·`next start` 를 래퍼 env 로 띄운다. 스크래치 워크트리의 `.env.local` 은 **레인 B 워크트리의 것**을 복사하고(메인 체크아웃의 것을 쓰면 `next build` 가 레인 A 54321 을 클라이언트 번들에 박는다), 스크래치 워크트리에서는 `supabase` 명령을 부르지 않는다. 명령 첫 줄에서 `supabase status` 의 DB URL 이 `:54422` 인지 확인하고 아니면 멈춘다.
- **러너는 하나**: `ui/sp3-menu` 머리의 `scripts/perf-baseline.mjs`(사용자 조회 DSN 이 `LOCAL_DB_URL` 우선 — D32·알림 11)로 세 서버를 모두 `seed` → `measure --n 30` 3회 잰다. ①·② 워크트리의 러너는 쓰지 않는다. 측정은 공유 잠금 + '조용한 기계' 확인 뒤다(§2.5-7).
- 경로: 대시보드·WBS·이슈(B 판정 P3)와 첫 화면(①② `/projects` 대 ③ `/w/<s>`·`/w/<s>/projects`), `GET /api/shell`(①② 옛 계약 대 ③ 새 계약). 페르소나는 멤버·관리자.
- 판정: 경로별 3회 p95 의 중앙값이 ① 대비 +20% 이내. 넘으면 범위 레이아웃의 2차 조회를 줄이고(워크스페이스 설정·effective 를 한 번에) 다시 잰다 — 넘은 채로 머지하지 않는다. ②가 이미 +20% 가까이 썼으면 §10 에 "R25 누적 한도 재조정"을 올린다(판단: 사용자). p50 도 `docs/baseline/sp3b-perf.md` 에 적는다.
- UI-0 의 1만 행 합성 WBS(`perf-grid.mjs`)는 기준선만 남긴다(비교 Q07 은 SPU2). UI-2b 에서 한 번 더 재서 참고로 적는다(게이트 아님) — 채움형 전환이 그리드 스크롤에 준 영향을 보려는 것이다.

### 8.5 눈확인

도구는 `scripts/ui-capture.mjs`(D48)이고 서버는 프로덕션 빌드(`http://127.0.0.1:3201`)다. 비교는 늘 (그 브랜치의 merge-base, 머리)를 같은 시드로 새로 찍은 픽셀 차이다. 주체는 D29 다 — UI-0·UI-2a 는 에이전트, UI-1·UI-2b·UI-3 은 에이전트가 행렬을 먼저 찍어 대조표를 만들고 **사용자가 확인한다**(push 확인 자리). 계정은 시드가 만든 임시 계정(플랫폼 관리자, 플랫폼 관리자가 아닌 워크스페이스 관리자, 멤버, 두 워크스페이스 멤버)이고 비밀번호는 메모리에만 둔다. 부트스트랩 관리자의 비밀번호는 바꾸지 않는다(B 판정 P30 관례). 결과는 `docs/baseline/sp3b-ui.md` 의 표(라우트·크기·테마·accent·차이율·axe 위반 수·결과·파일명)다. 이미지는 `/Users/jerry/D-Flow/.superpowers/qa/sp3b/`. 체크포인트마다 `smoke:prod` 결과를 같은 문서에 적는다.

| 단계 | 확인 |
|---|---|
| UI-0 | 31라우트 × 네 크기 × 라이트 캡처와 가시 h1 수(기준선, 판정 없음) |
| UI-1 | (a) **전 라우트 라이트 회귀**: 31라우트 × 네 크기 × 라이트를 merge-base 와 픽셀 차이율 표로 낸다. 차이율 상위 10라우트와 **UI-1 이 고친 파일이 렌더되는 화면 전부**(착수 때 `sp3b-ui.md` 에 파일 → 화면 대응표를 만든다)를 눈으로 본다 — 표·간트 행 넘침(D14 의 `.chip`·`.badge`·`.lvl-badge`), 잘린 배지, 사라진 경계. (b) **다크**: 31라우트 × 1440×900·390×844 전부, 그리고 UI-1 이 고친 파일의 화면과 하드코딩 색 화면(주간 시트·근태·좌석표·위임표·에이전트 허브·위키·회의록 본문(mermaid·코드·표)·대시보드 차트·간트·칸반)은 네 크기 전부. (c) **자동 대비 검사**: `ui-capture.mjs axe` 로 라우트 × 테마 위반 수를 표로 남긴다. 판정 — 라이트는 기준 대비 새 위반 0, 다크는 새 토큰 경로(의미·상태·`*-fg`·범주·배지·셸·로그인)에서 온 위반 0. 하드코딩 색 파일에서 온 다크 위반은 파일·소유 SP 를 적어 원장에 이월(UI-5)하고 체크포인트 보고에 싣는다. (d) `/admin/ui-states`(라이트·다크 두 열, accent 표본 10 — 쇼케이스 다크 열의 계산 배경색이 페이지 전체 다크와 같은지 스크립트 대조, §4.6), `/projects` 히어로, wbs 오늘 칩·상태 채움 글자, 프로젝트 설정(C 가 먼저면 `/w/<s>/settings` 도), 로그인, `/account`·팝오버 테마 3값 × 새로고침 깜빡임 없음(`system` 은 OS 다크 에뮬레이션), 404·초대·공유 뷰어. (e) **키보드 Tab 순회** — 전역 바·사이드바·WBS 셀·회의 목록 행·모달 패널에서 포커스 링이 보인다(라이트·다크, 1440 — D50). (f) **인쇄** — 다크 선호 계정으로 `/p/<pid>/dashboard` 보고서 모달을 열고 `emulateMedia({ media: 'print' })` 캡처(1440): 글자가 어둡다(§4.1 블록 10) |
| UI-2a | 옮긴 여덟 화면·홈 v0·내 업무 v0·리졸버 × 네 크기 × 라이트를 옛 경로 캡처(merge-base)와 짝지어 픽셀 차이로 대조(옛 셸 그대로라 차이는 경로·홈·내 업무뿐이어야 한다), 옛 경로 이동, 모든 라우트의 가시 h1 수(기록), 회의록 `?project=` 칩, 개요의 교차 모듈 표시·'이 프로젝트 회의록' 링크 |
| UI-2b | (a) 셸 행렬 — 멤버·워크스페이스 관리자·플랫폼 관리자 × 펼침·접힘 × 1440·1280×720·768·390 의 워크스페이스·프로젝트 셸을 **라이트·다크 둘 다**, accent 기본·밝은·어두운은 1440 라이트·다크. 두 워크스페이스 전환, 모바일 드로어, 브레드크럼과 '워크스페이스 전체' 칩, 모든 라우트의 가시 h1 = 1(1280×720·390), 에이전트 세 화면(D18 예외), 설정 저장 바가 마지막 입력을 가리지 않음(C 회귀), 설정 손상 상태에서 셸과 `/p/<pid>/settings` 가 열리고 대시보드는 설정 오류 상태(D49), `/w/<s>/agents` 보기 전환 때 스크롤바 흔들림 없음, WBS 스크롤 하나, AI 레일 병치(1440 펼침)·오버레이(1280 펼침), 로고·accent·파비콘, 홈 v0·내 업무 v0. (b) 전 라우트(31 + 새 `/w/[slug]/**`) × 네 크기 × 라이트를 merge-base 와 픽셀 차이로 대조 — 옮긴 9화면은 옛 경로 캡처와 짝짓는다. (c) **스크롤 상태** — `main` 을 600px 스크롤한 상태(주간·근태·회의·회의록·위키·에이전트 명단·위임표, 네 크기 — D54), **JS 끈 첫 페인트**(`javaScriptEnabled: false`, 390×844·1280×720·1440×900 — JS 켠 캡처와 사이드바 유무·폭·머리 높이가 같다, D55), **WBS 전체 화면에서 AI 열기**(1440·390 — D56), 키보드 Tab 순회와 팝오버·드로어 Esc 복귀(라이트·다크). (d) 이 행의 결과가 체크포인트 빈 커밋의 `Preview-checked` 에 적힌다 |
| UI-3 | 대표 3화면 × 네 크기 × 라이트·다크 × accent 셋(에이전트 캡처 → 대조표 → **사용자 확인**, §6.8), 프로젝트 목록(행·카드), 명단 실효 역할, `/account`, 초대 화면, 인스펙터 병치 경계(1440·1400·1366·1280), WBS 전체 화면에서 행 인스펙터 열기(1440 병치·1280 오버레이 — D56), 칸반 흡수 뒤 보드(E3) |

실행 중인 서버에서 만들기 어려운 상태(부분 실패·열화)는 단위 테스트가 대신하고, 눈확인은 `/admin/ui-states` 의 쇼케이스로 모양을 본다. 설정 손상은 UI-2b 행처럼 실제로 만든다(`settings:verify` 와 같은 스택에서 한 키를 손상시키고 끝나면 되돌린다).

### 8.6 기록 문서

| 문서 | 단계 | 내용 |
|---|---|---|
| `docs/baseline/sp3b-ui0.md` | UI-0 | §3.1 |
| `docs/baseline/sp3b-ui.md` | UI-1~3 | §8.5 의 표, z 대응표(D56), 파일 → 화면 대응표(UI-1), `smoke:prod` 결과, UI-1·UI-2b·UI-3 사용자 확인 절 |
| `docs/baseline/sp3b-e2e.md` | UI-2·마감 | §8.3 |
| `docs/baseline/sp3b-perf.md` | UI-2b | §8.4, 기준 장치·브라우저·Node·커밋·스택 `max_rows` |
| `/Users/jerry/D-Flow/.superpowers/sp3b/progress.md`(원장, 리포 밖) | 전 단계 | 체크포인트·실측 노력·리뷰 결과·레인 A 알림 전달 기록·main 쓰기 창 시각(D46)·`docker stats` |
| `/Users/jerry/D-Flow/.superpowers/qa/sp3b/`(리포 밖) | 전 단계 | 캡처 PNG, 대조표 HTML(`<단계>-sheet.html`) |

`docs/baseline/sp3a-*.md`·`sp2-*.md` 는 고치지 않는다(다른 레인·과거 기록).

## 9. 완료 조건(done_when)

- [ ] ① `tests/routes/legacy-redirects.test.ts` 초록(옛 9경로 + `/kanban`, 쿼리 보존, 307)
- [ ] ② `grep -rnE "isGlobalProjectBridge|isGlobalBridge|ProjectTabs|SECTION_LABEL" src` 0건 — 행위 테스트(`tests/shell/*`·`nav-for` 셸 소비)와 함께(개정 §6.1-2)
- [ ] ③ `tests/shell/nav-consumption.test.tsx`(개정 ③ 의 `nav-for.test` 셸 소비 케이스 — E37) 초록, E2E E7, 워크스페이스 모듈 직접 링크 404(§8.1 '이동 페이지' 행)
- [ ] ④ `tests/invariants/page-h1.test.ts` 초록과 `sp3b-ui.md` 의 모든 라우트 가시 h1 = 1(1280×720·390)
- [ ] ⑤ `tests/css/contrast-tokens.test.ts`·`no-raw-color.test.ts` 초록(닫힌 쌍 표·메타 단언·인쇄 블록 포함), 그리고 `display-cascade.test.ts`·`global-rule-layers.test.ts` 초록
- [ ] ⑥ `tests/portal/partial-failure.test.tsx` 초록
- [ ] ⑦ `tests/nav/switch-target.test.ts` 초록과 E2E E9
- [ ] ⑧ E2E E4·E5 통과
- [ ] ⑨ 테마 테스트(§8.1) 초록과 UI-1 눈확인의 테마 행 통과
- [ ] ⑩ `git log --format='%h %(trailers:key=Preview-checked,valueonly)' sp3a-a-done..sp3b-done -- 'src/components' 'src/app/**/page.tsx' 'src/app/**/layout.tsx' 'src/app/globals.css'` 의 결과 가운데 원장에 적은 SP3b 커밋(레인 A 커밋은 레인 A 가 판정한다)에 값이 빈 줄이 없고, 각 `ui/sp3-*` 체크포인트 커밋의 트레일러가 개정 §6.5.4 의 확인 화면을 모두 적는다
- [ ] ⑪ `sp3b-ui.md` 에 UI-3 사용자 확인 기록(일시·대조표·라이브 표본·지적과 처리). UI-1·UI-2b 사용자 확인 기록도 있다(D29)
- [ ] 개정 §6.5.9 의 SP3b 몫: Q01 = ⑪·§6.8, Q02 = `/admin/ui-states` 복합 상태 눈확인(§8.5 UI-1 행), Q03 = ⑤, Q14 = `status-message` 단위 + 포털 ⑥, 수용 ①②③④⑧ = §8.5 UI-2b·UI-3 행
- [ ] `route-literals`·`sole-workspace`·`display-cascade` 의 임시 허용 항목(사유에 'UI-2b')이 0이다
- [ ] 옛 경로 9종의 307·B 계정의 A 슬러그 404·워크스페이스 2개 계정만 전환기 — E2E E1·E4·E5, `docs/baseline/sp3b-e2e.md` 에 E1~E10 기록
- [ ] `git diff --quiet b4283c0 -- tests/css/breakpoint-safety-net.test.ts` 가 참이고 그 테스트가 초록
- [ ] `tests/invariants/sole-workspace.test.ts` 초록(개정의 `resolveSoleWorkspaceId` 0건을 `requireSessionModule(null`·`requireModulePage(null`·`aiAvailable(null` 과 `src/app/api`(v1 제외)까지 넓힌 것 — E3·D26)과 E2E E6(R15 해소)
- [ ] 명단 실효 역할 — `tests/ui/members-effective-role.test.tsx`·`inherited-role.test.ts` 초록과 UI-3 눈확인 행
- [ ] `navigation.menu`·`portal.widgets`·`views.default` 가 카탈로그 상태 `stored` 이상이고(개정 §2.11 SP3b 행), 두 새 키가 네 연결(정의·편집기·소비처·테스트 — §6.4 표)을 갖는다. `tests/settings/registry.test.ts`(16키)·`catalog-sync` 초록
- [ ] 저장된 `navigation.menu`·`branding.*` 가 셸에 반영된다(SP3a §9 #6 인수) — 눈확인 UI-2 행과 `tests/shell/brand.test.tsx`
- [ ] `tests/invariants/platform-guards.test.ts`·`tests/authz/guard-signatures.test.ts` 무수정 초록
- [ ] `tests/invariants/route-literals.test.ts`·`scroll-owner.test.ts` 초록
- [ ] `docs/baseline/sp3b-perf.md` 의 p95 중앙값이 SP2 기준선(`h2-done`) 대비 +20% 이내(개정 R25 — §8.4), ②→③ 증가분 기록
- [ ] (D9) `account_preferences` 마이그레이션 커밋은 `migrations/`·`rollbacks/` 두 파일만 담고 `Staging-verified: local db reset <YYYY-MM-DD HH:MM> — <요약>` 트레일러가 `Co-Authored-By:` 바로 위에 있다(번호를 옮겼으면 rename 커밋 + 재리허설 빈 커밋 트레일러). 롤백 리허설(적용 → 롤백 → 재적용)과 이행 seed 리허설 통과. `tests/rls/account-preferences.test.ts`(동료 읽기 0행 포함)·`tests/invariants/migration-files.test.ts` 초록
- [ ] 레인 B 스택에서 래퍼로 `db:reset` → `dev:bootstrap` → `test:rls`(건너뜀 0)·`settings:verify` 초록
- [ ] `SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod` 가 UI-0~UI-3 체크포인트마다 초록이고 `sp3b-ui.md` 에 적혀 있다
- [ ] 위키 초안 키 이행(D52) — `tests/drafts/wiki-draft-key.test.ts` 초록
- [ ] `.githooks/pre-push` 의 `UI_RE` 에 `w/[slug]`·`p/[projectId]`·`(global)` 레이아웃 셋이 있고 CLAUDE.md UI 위험 목록이 **같은 커밋**에서 바뀌었다
- [ ] `docs/baseline/sp3b-ui0.md`·`sp3b-ui.md`·`sp3b-e2e.md`·`sp3b-perf.md` 가 main 에 있다
- [ ] main 의 커밋을 레인 B 워크트리에서 `npm run test`·`lint`·`typecheck`·`build` 초록, push 뒤 GitHub Actions 초록
- [ ] 원장에 Phase 별 실측 노력과 재산정, §7 반영 지시 목록이 있고 `git tag -l sp3b-done` 이 태그를 낸다

## 10. 사용자 확인 항목

### 10.1 항목

사전 승인 규칙(P-1)대로 모두 권고 기본값으로 진행하고 체크포인트 보고에 싣는다. "기한"은 그 일을 시작하기 전이다. 기한이 지나면 대안으로 바꾸는 비용이 "나중에 바꾸는 비용" 열이다.

| # | 질문 | 권고 기본값 | 대안 | 나중에 바꾸는 비용 | 기한 |
|---|---|---|---|---|---|
| 1 | 화면이 바뀌지 않는 UI-2 준비 파일(워크스페이스 해석·개인 설정 분리·홈 데이터 조립·머리/프레임 컴포넌트와 그 테스트 — §2.2 목록)을 SP3a Phase B 체크포인트 **전**, UI-1 머지 뒤에 먼저 만들어도 될까요? 2026-09-29 결정은 'UI-2 는 B 뒤'였습니다 | **결정대로 B 뒤에 시작한다**(D1) | 준비 파일만 UI-1 머지 뒤 먼저 만든다 — 약 0.3주 당김, 화면 무변경, `ui/sp3-menu` 에만, main 에 이미 있는 것만 import(메뉴 레지스트리·모듈 판정 등 B 산출물에 기대는 파일은 여전히 B 뒤) | 없음 — 대안은 시작 전에만 의미가 있다 | UI-1 머지 |
| 2 | 테마·언어·사이드바 같은 계정 전체 설정을 워크스페이스와 떼어 계정에 저장할까요?(개정 §8.1 #5) 지금은 워크스페이스마다 따로 저장되는 구조라, 워크스페이스를 오가면 테마가 달라질 수 있습니다 | 계정에 저장한다 — DB 변경 1개(새 표 `account_preferences`, 본인만 읽고 쓴다). 개정이 권고한 `profiles` 열은 같은 워크스페이스 동료가 행 전체를 읽을 수 있는 표라 개인 설정이 동료에게 보이게 돼 새 표로 바꿨다(D9·E32). 번호는 개정 §6.3 대로 머지 순서(`0013` 이 기본). 레인 A 의 밀린 DB 작업(권한 기록 트리거 재생성 등)은 싣지 않는다 | (가) DB 변경 없이 "가장 먼저 가입한 워크스페이스"의 저장값을 계정 설정으로 쓴다 (나) 개정 문언대로 `profiles` 열 — 동료 노출을 막으려면 읽기·쓰기를 모두 DB 함수로 옮겨야 한다 | (가): 그 워크스페이스에서 탈퇴하면 테마·언어가 초기화된다. 기본값: 원격 DB 가 없어 번호·이행 비용이 없다. 나중에 되돌리면 롤백 SQL 로 값을 되쓴다 | UI-2a 착수 |
| 3 | 화면 눈확인을 누가 할까요? 개정은 눈확인을 사람의 게이트로 정했습니다(개정 §6.5.9·R21) | **개정대로 토큰(UI-1)·셸(UI-2b)·대표 3화면(UI-3)은 사용자가 본다.** 에이전트가 행렬을 전부 찍어 한 장짜리 대조표를 만들고, 사용자는 main push 확인 자리(어차피 사람 확인이다)에서 대조표를 훑고 단계마다 표본 여섯 안팎을 레인 B 서버(`http://127.0.0.1:3201`, 새 브라우저 프로필)에서 조작한다. 기준선(UI-0)과 경로 이동(UI-2a — 옛 셸 그대로)은 에이전트만 본다(D29) | SP3a §9 #10 처럼 UI-0·UI-1·UI-2 는 에이전트만, UI-3 만 사용자 | main 에 들어간 커밋의 트레일러는 고칠 수 없다. 사람이 나중에 찾은 결함은 UI-3 이나 화면 소유 SP 에서 고친다. UI-1·UI-2b 는 2026-07-27 사고와 같은 파일군이다 | UI-1 머지 |
| 4 | 플랫폼 관리자에게 워크스페이스 전환기를 어떻게 보일까요? 플랫폼 관리자는 모든 워크스페이스를 열 수 있습니다 | 전환기에는 **소속**된 워크스페이스만. 소속이 아닌 곳을 주소로 열면 이름 옆에 "플랫폼 관리자로 보는 중"을 보인다. 모든 워크스페이스 목록 화면은 SP9(D4) | 전환기 아래에 '플랫폼 관리자 — 모든 워크스페이스' 구획을 둔다 | 낮음 — 목록 원천 한 줄과 E2E E5 의 기대값 | UI-2b 착수 |
| 5 | 워크스페이스 주소 아래의 사용 현황(`/w/<워크스페이스>/usage`)이 SP8 전까지는 플랫폼 전체 수치를 보입니다(수집 데이터에 워크스페이스 구분이 없습니다). 어떻게 보일까요? | 그대로 보이고 머리에 '플랫폼 전체(워크스페이스 구분은 SP8)' 칩을 단다. 보는 사람은 지금처럼 플랫폼 관리자뿐이다(D21) | SP8 까지 메뉴를 '플랫폼 운영' 그룹으로 옮긴다 | 낮음 — 메뉴 그룹 한 줄(레인 A 의 메뉴 레지스트리) | UI-2a 착수 |
| 6 | 회의록 상세의 옛 주소(`/minutes/<id>`)를 계속 살려 둘까요? 이 주소는 AI 검색 색인, 챗봇 출처, 외부 회의록 업로드 API 의 응답(`url`), AI 답변 본문에 저장돼 있습니다 | 영구히 살려 두고, 회의록이 속한 워크스페이스의 새 주소로 보낸다. 색인·챗봇·외부 API 는 옛 형식을 계속 쓴다 — 외부 계약은 바꾸지 않는다(D6). 로그인하지 않은 사람이 이 주소를 열면 로그인 뒤 첫 화면으로 간다(지금과 같다) | 외부 계약을 v2.9 로 올려 새 형식을 내고 색인을 다시 만든다(외부 팀 반영 필요) | 기본값에서 대안으로: 계약 개정·외부 반영·재색인. 대안에서 기본값으로는 되돌릴 일이 적다 | UI-2a 착수 |
| 7 | 전역 바의 공지 티커를 없애도 될까요?(개정 §8.1 #7) 중요 공지는 홈 화면의 공지 구획, 프로젝트 개요의 공지 띠, 알림 배지가 맡습니다 | 없앤다(D28). UI-2b 에서 빠지고 같은 머지에 홈의 '공지' 구획(UI-2a)이 함께 들어간다. UI-3 눈확인 게이트에서 확인한다 | 홈 화면 머리 아래로 옮긴다 | 낮음 — 홈 위젯 하나(약 0.1주) | UI-3 눈확인 게이트 |
| 8 | (알림 — 결정 아님) SP3b 의 노력 추정이 개정의 3주를 넘습니다: 약 6.4~8.0주(UI-0 0.5~0.6·UI-1 1.7~2.2·UI-2a 1.3~1.6·UI-2b 1.5~1.8·UI-3 1.4~1.8). 초안(3.5~4.8주)보다 늘어난 것은 비평이 Phase B 의 과제당 비율로 다시 셌고 캡처 도구·넓힌 눈확인·안전장치를 더했기 때문이다. 레인 A 실측 비율로는 에이전트 시간 약 35~60시간(중앙 약 45시간)이다. 레인 B 는 SP3a 와 나란히 돌아 `sp3a-done` 뒤에 남는 것은 UI-2 머지 창(목표 1영업일)과 UI-3·사용자 게이트다. 그래도 SPU1 착수가 밀리고, UI-2b 가 `sp3a-done` 보다 늦으면 SP4 의 셸·화면 과제가 기다린다(DB·도메인 과제는 무관 — D47) | 단계를 그대로 두고 체크포인트마다 실측을 적어 마감에서 다시 잰다 | 범위를 줄인다 — 줄일 수 있는 것은 §6.6 의 계정·초대 화면 정리(약 0.2주 — 화면 소유 SP 로 넘김), 내 업무 v0(약 0.1주 — '내 업무' 항목이 홈의 '지금 처리할 일' 구획으로 가게), 1만 행 기준선(약 0.1주 — SPU2 로) | 범위를 줄이면 개정 SP3b 블록과 적용표(§5.9.4)를 고쳐야 한다 | UI-1 체크포인트 |
| 9 | 워크스페이스 관리자에게 '멤버·초대'(계정)와 '공용 팀' 화면을 열까요? 지금은 화면을 플랫폼 관리자만 열지만, 그 화면이 부르는 저장 기능은 이미 워크스페이스 관리자에게 열려 있습니다. 개정의 새 메뉴도 이 둘을 워크스페이스 관리자 항목으로 둡니다 | 연다 — 자기 워크스페이스만. 비밀번호 재설정·플랫폼 관리자 지정 같은 플랫폼 전용 조작은 플랫폼 관리자에게만 보인다(D22) | 지금처럼 플랫폼 관리자 전용으로 두고 메뉴에서도 워크스페이스 관리자에게 숨긴다 | 낮음 — 판정 함수 한 줄. 다만 한 번 열었다 닫으면 사용자가 알아차린다 | UI-2a 착수 |
| 10 | '내 업무' 메뉴는 늘 보이는데 본 화면(탭·상세 패널)은 SPU2 몫입니다. 그 사이를 어떻게 할까요? | UI-2a 에서 간단한 목록 화면(내 담당 작업·이슈·검토·오늘 회의, 종류별 필터)을 먼저 낸다(D20) | SPU2 까지 메뉴에서 뺀다(개정의 "메뉴 숨김 없음" 원칙의 예외가 된다) | 낮음 | UI-2a 착수 |
| 11 | 개정은 작업 계획의 프로젝트 기본값 설정을 `{ 첫 보기, 밀도 }` 로 정했습니다. 그런데 지금 작업 계획 표에는 밀도(행 높이)를 바꾸는 기능이 없습니다 | 첫 보기만 등록하고, 밀도는 그 기능을 만드는 SPU2 가 별도 설정으로 더한다(D43) | SP3b 가 작업 계획 표의 행 높이 두 단계(40/32px)를 만들고 둘 다 등록한다(+0.3주, SPU2 의 표 작업과 겹친다) | 낮음 — 설정 하나 추가 | UI-3 |
| 12 | SP3a Phase C(설정 화면)의 착수를 UI-1(새 색·상태 컴포넌트) 머지까지 미룰까요? 개정은 새 화면을 옛 디자인 패턴으로 만들지 말라고 합니다(개정 §6.1-4) | 미루지 않는다 — 레인 A 가 임계 경로다. C 의 새 화면은 옛 색 이름을 써도 별칭으로 새 색이 되고, 시각 패턴은 UI-3 이 입힌다(§6.4). 원색 검사에 걸리는 C 파일은 UI-1 이 사유와 함께 예외 목록에 넣는다(§2.2) | C 착수를 UI-1 머지까지 미룬다(레인 A 대기 — UI-1 은 1.7~2.2주) | 기본값: UI-3 의 시각 패턴 작업이 조금 는다. 대안: 레인 A 전체가 그만큼 늦어진다 | B 체크포인트 |
| 13 | (알림 — 결정 아님) 2026-09-29 결정 'UI-2 는 B 뒤'보다 엄격한 게이트를 둡니다: 셸 교체(UI-2b)는 SP3a Phase C 체크포인트 뒤에 시작하고, UI-2 의 main 반영은 SP3a 마감 직후 창에서 합니다(D1·D45·D46). 셸이 Phase C 가 만드는 워크스페이스 레이아웃 위에 올라가고, 레인 A 가 체크포인트를 빨리감기로 넣으려면 레인 B 가 그 사이에 main 을 건드리지 않아야 하기 때문입니다 | 이대로. C 를 기다리는 동안 레인 B 는 UI-2a(경로·IA)를 한다 | 워크스페이스 셸을 SP3b 소유의 중첩 레이아웃(`(shell)`)에 두어 UI-2b 를 C 전에 시작한다(레이아웃 한 층 추가, C 의 설정 화면 파일을 그 그룹 안으로 옮기는 커밋 — D1 대안 (나)) | 낮음 — 시작 전에만 의미가 있다 | B 체크포인트 |

### 10.2 개정 §8.1 가운데 SP3b 에 걸린 항목의 상태

| 개정 §8.1 | 무엇 | 상태 |
|---|---|---|
| #5 | 계정 범위 개인 설정의 저장 위치 | 이 문서 D9 로 닫는다(설계 판단 — 저장 모양은 `account_preferences`, E32) — §10.1 #2 로 보고 |
| #6 | 포트폴리오·사용 현황의 워크스페이스 관리자 노출 | 현행 유지. 내비는 caps 만 소비하므로 바뀌어도 셸은 그대로다 |
| #7 | 공지 티커 제거 | §10.1 #7 — UI-3 게이트(정본 §8 #10 도 함께 닫는다) |
| #8 | accent 거부 임계값 | 실측 — UI-1 §4.7 이 표본 10종으로 정해 테스트에 고정 |
| #9 | 인스펙터 병치 임계값 | 실측 — UI-3 §6.7 |
| #20 | 저장·공유 보기와 가져오기 매핑 복원을 출시 뒤로 | 개정의 기한(G0-2)이 지났고 사용자 답이 없다 — 정본 §8 문단대로 권고 기본값으로 진행한다. SP3b 는 `views.default` 만 등록하고 저장·공유 보기를 만들지 않는다 |
| #21 | 다크 토글의 위치 | **닫힘**(2026-09-29 사용자) — 계정 팝오버 3단 + `/account`, 전역 바 아이콘 없음 |

## 11. 범위 제외

SP3b 밖으로 두는 일과 받는 곳이다. "받는 쪽 기록"이 '반영 지시'인 것은 §7 표의 그 번호로 개정 문서에 한 줄을 더한다.

| 항목 | 가는 곳 | 받는 쪽 기록 |
|---|---|---|
| 편집 상태 머신·`SyncStatus`·ConflictResolver·dirty guard·Esc 계층·undo·로컬 초안의 일반 정책과 `security.local_drafts`(위키 초안 키 이행은 SP3b — D52)·셀 저장 성공 토스트 제거·개인 알림 토글, 우측 레일 교체 확인(`beforeSwitch`)의 dirty 판정 | SPU1 | 이미 있음(레일 확인은 반영 지시 14 와 함께 SPU1 블록에 한 줄) |
| ⌘K·찾기 대화상자·범위 칩(자리 `data-slot="search"` 만 SP3b), '내 업무'의 탭·인스펙터·알림 탭, WBS 그리드 키보드·`itemId+fieldId` focus, 개인 열·밀도, 프로젝트 기본 밀도 키, 검토 화면, 1만 행 Q07 비교 | SPU2 | 반영 지시 14 |
| 대량 변경, 간트 드래그 미리보기·영향 검토, 문서 버전·첨부 상태, 390px·모바일 접근성 마감 | SPU3 | 이미 있음 |
| 주간 시트·근태의 채움형 전환 | SP4·SP5(화면 소유) | 반영 지시 6 |
| 개별 화면의 전면 이행 — `PageHero` 호출의 props 대조 이관, 제목 문구 정리(프로젝트 이름 반복 제거), 옛 토큰 별칭 호출부 | 각 화면을 만지는 SP, 남는 화면은 SPU3(개정 §6.1-4) | 이미 있음 |
| 팀 토큰 삭제·`category-*` 이행·`TeamsProvider` 의 설정 기반 전환 | SP4 | 이미 있음 |
| 포털·셸의 '오늘' 을 워크스페이스 시간대로, 서울 고정 시각 표시 제거 | SP5 | 반영 지시 13 |
| `StatusPill` 의 해석된 상태 정의 인터페이스, 보드 열의 정의 파생 | SP5b | 이미 있음 |
| `api/v1/*` 의 `resolveSoleWorkspaceId`, v1 `meta` 의 회의 목록 모듈 판정(B 판정 P20) | SP7 | 이미 있음 / P20 은 SP7 블록에 한 줄 |
| 봇 도메인 주입, 봇 출처의 워크스페이스 링크 슬러그 주입, `get_project_dashboard` 도구의 회의 모듈 판정(P20), 사용 현황의 워크스페이스 구분, 포털 '최근 문서'의 위키 문서 | SP8 | 이미 있음 / P20·위키 문서는 SP8 블록에 한 줄 |
| 인박스 범주의 모듈 판정(P20) | SPU2('내 업무' 알림 탭) | SPU2 블록에 한 줄 |
| 별칭 삭제·`no-legacy-tokens`·다크 기본값 `system` 전환·Q01~Q14 전체 매트릭스(SP3b 몫 제외 — §9)·J1~J3·준비 체크리스트 UX-01·모든 워크스페이스 목록 화면(`/admin`) | SP9 | 이미 있음(워크스페이스 목록은 개정 §5.3.2 첫 행) |
| 저장·공유 보기(UX-07)·가져오기 fingerprint·매핑 복원 | 출시 후(개정 §8.1 #20) | 이미 있음 |
| 계정 화면 문구의 사전화 | 미배정(개정 §8.1 #26) | 이미 있음 |
| 기존 `revalidatePath('/p/${…}', 'layout')` 약 33줄의 형식 정정(라우트 그룹 포함) | 그 액션을 만지는 SP | 반영 지시 22 |
| `getComputedWbs` 의 무범위 조회(1,000행 잘림)·`getPendingApprovalCount` 의 같은 상한 | SP4/SPU2 | 레인 A 알림 12 |
| 로그인 뒤 원래 옛 경로로 돌아가기(`next` 복귀) | 미배정 — 열린 리디렉션 검토가 먼저다 | — |
| 레인 A 의 밀린 DB 작업(CR-1 권한 기록 트리거 재생성·`people.email` 열 권한 회수·CR-6 필수 키 unset 거부) | 레인 A(SP3a 마감 또는 SP4 첫 마이그레이션) | §2.4 알림 3 |
| 로그인·초대·공유 화면의 워크스페이스 브랜드 | 두지 않음 — env `BRAND_*` 유지 | — |
| 메뉴 숨김 설정, 프로젝트 단위 메뉴 재정의, `appearance.*`, 임의 CSS·HTML·JS, '지표·위험' 설정 범주, 국가 공휴일 오버레이, 전 화면 일괄 재스킨 SP | 두지 않음(개정 §5.11·§8.2·5-D13) | — |

## 12. 리스크

| # | 리스크 | 담는 방법 |
|---|---|---|
| R1 | UI-2 가 레인 A 파일을 많이 이어 고친다 — B 가 관문 줄을 넣은 페이지 22개, 관문·레지스트리·매니페스트·불변식, E2E 스크립트, 계정 액션 | 착수 게이트(D1 — UI-2a 는 B 뒤, UI-2b 는 C 뒤), main 쓰기 창(D46), 관문 줄 위치 보존, main 머지는 `sp3a-done` 직후 창에서 한 번 rebase, C 파일 과제를 UI-2b 첫 묶음으로, 레인 A 알림 열셋(§2.4 — 스펙 승인 즉시 전달) |
| R2 | 슬러그·스텁 판정의 틈으로 다른 워크스페이스 데이터가 응답에 실린다(레이아웃 404 는 페이지 조회를 멈추지 않는다) | 모든 `/w/[slug]` 페이지의 첫 await 판정(E19), service_role 로더는 판정 뒤에만, `/minutes/[id]` 는 행 기준, 적대적 탐색 리뷰(R-std), E2E E2·E4 의 센티널 |
| R3 | 셸을 범위 레이아웃으로 내린 구조와 307 스텁이 Next 의 동작 가정(재마운트 범위, 레이아웃 404 의 상태 코드, 라우트 핸들러 307, 소프트 이동과 307, `:has()`)에 기댄다 | UI-2a·UI-2b 첫 과제의 스파이크 S-1~S-8(§5.1, 프로덕션 빌드·인증 쿠키). 각각 대안을 적어 두었다(D2·D5·D19) |
| R4 | 셸 조회가 늘어 느려진다(개정 §6.4 R25) — 범위 레이아웃의 2차 조회, '내 업무' 합계 | §8.4 의 게이트(SP2 기준선 대비 p95 +20% — 누적 방지), React `cache` 공유, 합계는 최대 2왕복·0건이면 1왕복, 넘으면 조회를 합친 뒤 다시 잰다 |
| R5 | `revalidatePath` 교체 누락·종류 누락이 동작·모의 테스트 어디에도 드러나지 않는다(Next 15.5) | `route-literals` 불변식(§5.7 — ② 는 파일 대조, D8) |
| R6 | 옛 링크(북마크·봇 출처·색인·외부 API·옛 문서)가 깨진다 | 스텁 열 개를 영구로 두고 `legacy-redirects` 테스트·E2E E1~E3 |
| R7 | 사람 눈확인이 늦어져 머지가 밀린다(개정 R21) | 사람 확인은 UI-1·UI-2b·UI-3 을 push 확인과 한 자리에서, 에이전트가 먼저 만든 대조표 + 표본 여섯 안팎으로(D29). UI-2·UI-3 분리 머지 |
| R8 | 레인 B 명령이 레인 A·사용자·Codex 가 쓰는 로컬 DB 를 조용히 읽거나 쓰거나 지운다(에이전트 셸의 cwd 초기화, `RLS_DATABASE_URL` 기본값, 상수 DSN, 고정 컨테이너 이름, 스크래치 워크트리의 `config.toml`) | 래퍼(§2.5-0 — cwd·설정·skip-worktree·env 확인 후 exec), 래퍼 밖 호출 금지(구현자 브리프), rebase·전환 뒤 `lane-b-run.sh true`, 스크래치 워크트리에서 `supabase` 금지, `perf-grid` 의 54322 폴백 거부 |
| R9 | 8GB 기계에서 두 스택·서버·헤드리스 브라우저·vitest 가 겹치고, 성능 측정이 다른 레인의 부하로 틀어진다 | 두 레인 공유 잠금(§2.5-7, 알림 10), `supabase start -x …`, 조용한 기계 확인, vitest `--maxWorkers=2`, 눈확인은 `next start`(dev 보다 가볍다) |
| R10 | 토큰·셸 변경의 화면 깨짐이 빌드·테스트로 잡히지 않는다(2026-07-27 사고 — 프로덕션 CSS 에서만 났다) | `ui/` 브랜치·트레일러, 프로덕션 빌드에서 결정적 시드로 찍은 merge-base 대비 픽셀 차이(D48)·다크 전 라우트·axe 대비·`smoke:prod`, 사용자 확인(D29), 안전망 무수정, `display-cascade`·`global-rule-layers`·`no-raw-color`·`contrast-tokens` |
| R11 | 개인 설정 이행 중 값이 사라진다 | 사후검사(`SP3B_ACCOUNT_PREFS_POSTCHECK`), seed 리허설, 롤백 리허설, 번호 변경 뒤 재리허설, 선행 조회 실패면 저장 중단 |
| R12 | 계정·공용 팀 화면을 워크스페이스 관리자에게 열면서 플랫폼 조작이 새어 보인다 | 액션 가드 불변(`requireSuperuser` 11곳), 플랫폼 조작 렌더 분기 단위 테스트, §10.1 #9 |
| R13 | 노력이 추정(6.4~8.0주)을 넘는다 | 체크포인트마다 실측, 넘으면 §10.1 #8 의 축소안을 사용자에게 올린다(결정은 사용자) |
| R14 | UI-1 과 C 의 순서(어느 쪽이 먼저든)가 원색 검사·accent 임계·겹치는 파일에서 서로를 깬다 | C 가 먼저인 경우의 재기준선(§2.2·E26), UI-1 은 C 소유 파일을 고치지 않음, 레인 A 알림 1·8, §10.1 #12 |
| R15 | 칸반 딥링크의 쿼리 의미가 바뀐다(`view` → `group`) | 스텁 변환·`kanbanHref`·`KanbanBoard` 를 한 과제로, `legacy-redirects`·deep-links 테스트, E2E E3 |
| R16 | 두 레인이 개정 문서를 동시에 고쳐 충돌한다 | SP3b 는 반영 지시 목록(§7)만 남기고, 개정 문서 커밋은 한 번에 한 레인 |
| R17 | 셸이 바뀌는 동안 레인 A 의 체크포인트 눈확인·E2E 가 옛 셸을 전제하고, SP4 의 셸·화면 과제가 UI-2 와 같은 파일을 고친다 | UI-2 는 `sp3a-done` 직후 창에서 머지(D46), SP4 의 셸·화면 과제는 UI-2 머지 뒤 브랜치(D47, 알림 4·6) |
| R18 | 사용자가 같은 브라우저로 레인 B(3201)에 로그인해 `localhost:3000` 의 세션·테마 쿠키가 섞인다(두 스택 모두 `sb-127-auth-token`) | 레인 B 원점 `http://127.0.0.1:3201`, 새 프로필·시크릿 창 안내, 스텁 `Location` 은 요청 원점(§2.5-5·§5.3) |
| R19 | UI-2a 의 중간 상태(옛 셸 + 새 경로)에서 옛 손목록·클라이언트 링크가 스텁을 한 번 더 거치고, 쿠키가 없어 첫 소속으로 해석된다 | UI-2a·UI-2b 를 같은 창에서 차례로 머지(main 에 중간 상태가 오래 머물지 않는다), 임시 허용 항목은 UI-2b 에서 0(§9) |
| R20 | 설정 하나가 손상되면 그 범위의 모든 화면과 그 설정을 고칠 화면까지 막힌다 | 범위 레이아웃이 설정 읽기 실패를 받아 CORE·레지스트리 순서·제품 기본으로 그린다(D49), 눈확인 UI-2b 의 손상 상태 행 |
| R21 | PostgREST `max_rows = 1000` 이 여러 프로젝트에 걸친 조회와 1만 행 기준선을 조용히 자른다 | 새 로더는 `.range()` 로 끝까지(D40·D51·§5.9), `perf-grid` 행 수 대조 실패, 레인 A 알림 12 |
