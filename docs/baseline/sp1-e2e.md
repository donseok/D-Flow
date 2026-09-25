# SP1 Phase A 체크포인트 — E2E 실측 (2026-09-25)

플랜 `docs/superpowers/plans/2026-09-24-sp1-org-core.md` Task 11 을 로컬에서 잰 기록이다. 측정 트리는 `sp1/phase-a` 의
`1bdb553` 위에 이 태스크의 러너 변경(`scripts/e2e-local.mjs`·`scripts/lib/e2e.mjs`)을 얹은 것이다. 시각은 전부 KST.

**요약**

- E2E(최종 run6)는 **exit 1** 이다. 17단계 중 16단계가 통과했고, 마지막 `render-pages` 가 회의 화면에서 방금 만든 회의를 찾지 못했다.
- 원인은 `0003_org_core.sql` 이 두 표에서 단일 FK 를 남긴 채 복합 FK 를 더한 것이다(6.1). PostgREST 가 임베드를
  PGRST201 로 거절하고, 회의 조회는 로그만 남긴 채 빈 목록으로 그린다. 같은 원인으로 헤더 알림함도 `failed` 다.
- 그 두 단일 FK 를 지운 실험 DB 에서는 전 단계가 통과했다(exit 0, 7절). 커밋된 마이그레이션·코드는 바꾸지 않았다.
- 브리프의 "carol 로 `/p/B` 404" 는 스펙과 어긋나 그대로 검사하지 않았다(4절). B 는 같은 워크스페이스라 조회 전용이다.
  존재 은닉은 타 워크스페이스 프로젝트 C 와 미존재 id 로 확인했다.
- 은닉된 화면도 HTTP 상태는 200 이다(4.1). 판정은 RSC 페이로드의 `notFound()` digest 로 했다.

## 1. 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · Postgres(Docker `supabase_db_d-flow`) · 마이그레이션 `0000`~`0003` |
| 앱 | Next.js 15.5.19 `next dev` · Node 22.18.0 |
| dev 서버 env | 명령줄로만 `INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000`(`.env.local` 에 쓰지 않음) |
| 부트스트랩 | `admin@example.com`, 워크스페이스 `default`(기본값). 부트스트랩은 팀을 만들지 않는다(Task 8) |
| 산출물 | 이 PC 의 세션 스크래치 폴더(`E2E_OUT_DIR`, 커밋 안 함) |

## 2. 순서와 명령

순서는 addendum 대로 `db:reset` → `dev:bootstrap` → E2E(깨끗한 상태) → `test:rls` 다.
`test:rls` 는 픽스처(워크스페이스 `rls-a` 등, "RLS A/B" 프로젝트)를 dev DB 에 남기므로 반드시 E2E 뒤에 돌린다.
비밀번호는 플랜 Task 11 Step 2 의 값을 env 로만 넘겼다(아래 `<BOOTSTRAP_PASSWORD>`).

```bash
npm run db:reset                                                    # 15:31:09 → 15:31:34
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' npm run dev:bootstrap
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  nohup npm run dev > <스크래치>/run6.dev.log 2>&1 &               # 15:31:34, npm PID 기록(10149)
# /login 이 200 을 줄 때까지 2초 간격 최대 60회 대기 → 15:31:37 200(리스너 PID 10201)
BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' INVITE_ALLOWED_DOMAINS=example.com E2E_OUT_DIR=<스크래치>/run6.out \
  node scripts/e2e-local.mjs > <스크래치>/run6.e2e.json            # 15:31:37 → 15:32:12, exit 1
# 눈확인(5절) 15:32:12 → 15:32:17
# 기록한 npm PID 와 그 자손(10149 10190 10201)을 SIGTERM → lsof -nP -iTCP:3000 -sTCP:LISTEN 비어 있음 확인(15:32:18)
npm run test:rls                                                    # 15:32:29, 9/9 통과
```

러너를 만드는 동안 같은 순서로 다섯 번 더 돌렸다. 각 실행이 드러낸 것과 고친 것은 이렇다.

| 실행 | 결과 | 조치 |
|---|---|---|
| run1(15:11) | `invite-issue` 확인 조회가 `permission denied for table project_invites` | 이 표는 `service_role` 에만 grant 가 있다. 러너의 확인 조회를 로컬 service_role 클라이언트로 바꿨다 |
| run2(15:13, 같은 dev 서버로 재실행) | `import-append` 409 `needsTeams:["ERP"], scope:"global"` | 팀 캐시가 모듈 인스턴스마다 따로다(6.3). 재시도로 덮지 않고 원인을 적은 실패 문구로 바꿨다 |
| run3(15:15) | carol 의 C 화면이 404 가 아닌 200 | 스트리밍 때문이다(4.1). 판정을 `notFound()` digest 로 바꿨다. 단계 이름을 덮어쓰던 러너 버그(`name` 키)도 고쳤다 |
| run4(15:19)·run5(15:22) | run6 과 같은 결과 | run5 뒤 단계 기록기에 예약 키 검사를 더했다. 그래서 최종 기록은 커밋할 코드로 다시 돈 run6 이다 |

## 3. 단계표 — run6 (reset 15:31:09, E2E 15:31:37)

화면이 부르는 서버 액션은 `.next/server/server-reference-manifest.json` 에서 id 를 읽어 그 페이지로 `POST` 했다(`next-action` 헤더).
반환값은 Flight 응답에서 꺼냈다(`actionResult`). 확인은 로그인 세션 조회로 했고, grant 가 없는 `project_invites` 만 service_role 로 봤다.

| 시각 | 단계 | 경로 | 결과 · 행 수 |
|---|---|---|---|
| 15:31:40 | login | `@supabase/ssr` 로그인 → `GET /projects` | ✓ 200, 쿠키 `sb-127-auth-token` |
| 15:31:40 | create-projects | `createProject` × 2 via `POST /projects` | ✓ 2건(`E2E A/B 202609250631`), 둘 다 라벨 단계·작업·활동 · `max_depth` 3, 같은 워크스페이스 |
| 15:31:42 | project-teams | `addProjectTeam` via `POST /p/<id>/settings` | ✓ 3행 — A: ERP·MES, B: QA. 전부 프로젝트와 같은 워크스페이스 |
| 15:31:46 | roster | `upsertRosterMember` via `POST /p/<id>/members` | ✓ 3행 — 본인@A admin [ERP(대표), MES] 계정 연결, bob@A 권한·이메일·팀 없음·계정 없음, 본인@B member [QA] |
| 15:31:46 | fill-template | `GET /api/import/template` | ✓ 5행, 말단 담당 = ERP |
| 15:31:47 | import-inspect | `POST /api/import/inspect` | ✓ outline(0열), 팀 열 `[[8,'*']]` |
| 15:31:47 | import-append | `POST /api/import/execute` `registerTeams=false` | ✓ `count 5`, 5행, ERP 담당 2행(1.1.1·1.2.1, primary) |
| 15:31:47 | import-replace | 같은 라우트 `mode=replace` | ✓ 백업 5행, 교체 뒤 5행·ERP 담당 2행 |
| 15:31:52 | assign-external | `setWbsAssignee` via `POST /p/A/wbs` | ✓ bob 담당 1행(1.1.1) |
| 15:31:56 | meeting | `createMeeting` via `POST /p/A/meetings` | ✓ 회의 1건, 참석자 1행(bob, `project_id` = A) |
| 15:31:59 | export | `GET /api/report`(pptx·xlsx), `GET /api/export` | ✓ 3건 — 430,279 B / 113 항목, 10,678 B / 11 항목, 20,969 B / 11 항목 |
| 15:31:59 | trace-scan | 산출물 zip 전 항목 | ✓ 135 항목, 적중 0 |
| 15:31:59 | invite-issue | `createProjectInvite` via `POST /p/A/members` | ✓ carol@example.com member [ERP], 상태 active, 링크 origin `http://localhost:3000`, `alreadyAccount false`, 메일 미발송("메일 발송이 설정되지 않았습니다." — SMTP 없음, 초대는 유효), 초대 1행 |
| 15:32:01 | invite-redeem | 새 쿠키 항아리로 `GET /invite/<토큰>` → `redeemInviteWithSignup` | ✓ `projectId` = A, A 명단 3행, carol member [ERP] 계정 연결, 초대 `redeemed_at` 기록 |
| 15:32:01 | other-workspace-fixture | service_role(로컬 전용) | ✓ 워크스페이스 `e2e-other` + 프로젝트 `E2E C 202609250631`(워크스페이스 생성 경로는 SP2) |
| 15:32:03 | visibility | carol 로그인 뒤 화면·액션 | ✓ 4절 표 |
| 15:32:12 | render-pages | 관리자 세션 `GET` 6화면 | **✗** `/p/A/meetings` 에 방금 만든 회의 제목 "E2E 킥오프" 없음(6.1). 나머지 5화면 ✓ |

토큰은 발급 응답의 `url` 에만 있고(DB 는 해시) 러너가 거기서 꺼냈다. carol 의 비밀번호는 실행마다 새로 만들고 출력하지 않는다.

## 4. 존재 은닉 — carol 세션

| 대상 | 기대(근거) | HTTP | `notFound()` | 프로젝트 이름이 HTML 에 |
|---|---|---|---|---|
| A — 명단 멤버 | 화면 열림 | 200 | 아니오 | 예 |
| B — 같은 워크스페이스, 명단 없음 | 조회 전용(스펙 2.4.1 "그 외 워크스페이스 멤버 → `'viewer'`") | 200 | 아니오 | 예 |
| B 에 `createMeeting` | 쓰기 거부 | — | — | 결과 `{ ok: false, error: "권한 없음" }`, B 회의 0건 |
| C — 타 워크스페이스 | 존재 은닉(roleIn ④ null) | 200 | **예** | **예**(4.2) |
| 미존재 id | 존재 은닉 | 200 | **예** | — |
| (대조) 관리자로 C | 플랫폼 관리자는 전부 봄 — 은닉이 부재가 아니라는 대조 | 200 | 아니오 | 예 |

**브리프와의 편차.** 브리프는 "carol 로 `/p/B` 는 404" 를 요구한다. 그러나 초대 수락 RPC `consume_project_invite` 가 carol 을 워크스페이스
`default` 의 member 로 넣는다. B 도 같은 워크스페이스다. 설계 정본 `2026-09-23-generic-platform-design.md` 2.4.1 과 `roleIn` ⑥ 에 따라
carol 은 B 에서 `'viewer'` 다. 그래서 러너는 B 를 "화면 열림 + 쓰기 거부" 로 검사한다. "타 프로젝트 404" 의 뜻인 존재 은닉은 C 와 미존재 id 로 검사한다.
브리프 문구대로의 검사("B 404")는 **하지 않았다.** 스펙을 바꿀지는 컨트롤러가 판정한다.

### 4.1 은닉된 화면도 HTTP 200 이다

`(app)/loading.tsx` 가 `/p/[projectId]` 레이아웃을 Suspense 로 감싼다. 그래서 셸이 먼저 흘러가고 상태 코드는 200 으로 확정된다.
레이아웃의 `notFound()` 는 RSC 페이로드의 digest `NEXT_HTTP_ERROR_FALLBACK;404` 와 `<meta name="robots" content="noindex">` 로만 남는다.
화면은 클라이언트가 not-found 로 그린다. 따라서 러너는 상태 코드(200·404 허용)를 기록만 하고 digest 로 판정한다(`notFoundRendered`).
API 라우트의 404(`denyStatus`)는 이 영향을 받지 않는다.

### 4.2 C 의 이름과 화면 페이로드가 carol 의 HTML 에 실린다

carol 이 받은 C 화면 HTML 에는 다음이 들어 있다(run3 뒤 탐침, 2026-09-25 15:18).

- 사이드바 목록과 프로젝트 선택에 C 가 있다. `listProjectsWithState` 가 비공개만 거르고, `projects` 읽기 정책이 개방이기 때문이다.
- WBS 페이지 본문의 제목 "E2E C … WBS · 간트" 와 `projectName` 이 있다. 레이아웃이 `notFound()` 를 내도 페이지 세그먼트는 병렬로 렌더돼 흘러간다.

SP1 스펙 표(258행)는 "`read_all_members`·`projects` 읽기가 SP1 동안 개방 상태 — 의도된 상태(SP2 범위)" 로 이것을 받아들였다.
"SP2 착수 전 원격 배포 금지" 도 명시했다. 러너는 이 노출을 판정하지 않고 `projectNameInHtml` 로 기록만 한다.
SP2 가 읽기 정책을 닫을 때 이 값이 C 에서 `false` 가 돼야 한다.

## 5. 눈확인 — 관리자 세션, 15:32:12

**방법.** 이 샌드박스의 브라우저(claude-in-chrome)는 localhost 에 닿지 못한다(`.claude/skills/verify`). 그래서 러너와 같은 `@supabase/ssr` 세션
쿠키로 렌더된 HTML 을 받아 봤다. 오류 경계("화면을 불러오지 못했습니다")·열화 표시("일부 정보를 불러오지 못했습니다")·Next 오류 문서
(`__next_error__`)·흐름 데이터의 유무를 확인했다. 화면을 사람 눈으로 본 것은 아니다.

| 화면 | 결과 |
|---|---|
| `/projects` | 오류 없이 렌더. A 가 목록에 있다 |
| `/p/A/members` | 오류 없이 렌더. 옛 화면(MembersBoard)이 새 DTO 로 admin·bob·carol·ERP·MES 를 싣는다 |
| `/p/A/meetings` | 오류 경계는 없다. **방금 만든 회의가 없다** — 서버 로그 `[getProjectMeetingData] meetings 조회 실패 … Could not embed because more than one relationship was found for 'meetings' and 'meeting_attendees'`(6.1) |
| `/p/A/issues` | 오류 없이 렌더 |
| `/p/A/wbs` | 오류 없이 렌더. 리프 "요구사항 정리" 가 있다 |
| `/p/A/attendance` | 오류 없이 렌더 |
| 헤더(e5065be 어댑터) | 전 화면에서 `identity` = `{ roleLabel: "슈퍼유저", teamCode: "ERP" }`. 관리자의 대표 팀(A 의 ERP, B 의 QA) 중 가나다순 첫 팀이 ERP 다. 계정 메뉴를 열면 "슈퍼유저 · ERP" 로 나온다(`HeaderChrome` roleTeam — SSR HTML 에는 메뉴가 닫혀 있어 문구 자체는 없다) |
| 헤더 알림함(`GET /api/shell`) | 200 이지만 `inbox` = `{ items: [], unseen: 0, failed: true }` — `notification_recipients`↔`notification_events` 임베드 PGRST201(6.1) |

## 6. 발견

### 6.1 0003 의 FK 중복 — 회의 조회·알림함이 깨진다 (결함, Phase A 회귀)

`0003_org_core.sql` 은 두 표에 복합 FK 를 더하면서 단일 FK 를 남겼다. `attendance_records` 에는 같은 상황에서 단일 FK 를 지웠다("복합만 남긴다").

```
meeting_attendees       | meeting_attendees_meeting_id_fkey          | FOREIGN KEY (meeting_id) REFERENCES meetings(id)
meeting_attendees       | meeting_attendees_meeting_project_fk       | FOREIGN KEY (meeting_id, project_id) REFERENCES meetings(id, project_id)
notification_recipients | notification_recipients_event_id_fkey      | FOREIGN KEY (event_id) REFERENCES notification_events(id)
notification_recipients | notification_recipients_event_project_fk   | FOREIGN KEY (event_id, project_id) REFERENCES notification_events(id, project_id)
```

두 관계가 생기면 PostgREST 가 임베드를 거절한다(service_role 로 재현).

```
GET /rest/v1/meetings?select=id,meeting_attendees(member_id)                → 300 PGRST201
GET /rest/v1/notification_recipients?select=id,notification_events(type)   → 300 PGRST201
GET /rest/v1/meeting_attendees?select=member_id,meetings(title)            → 300 PGRST201
```

영향받는 조회는 다음과 같다. 모두 오류를 로그로만 남기고 빈 결과(또는 `null`)로 진행한다.

- `src/lib/data/meetings.ts` 103행·127행·194행(`getProjectMeetingData`·`getMeetingDetail`·`getMyMeetings`).
  호출처는 전역 `/meetings`, 프로젝트 대시보드·회의 화면, 회의 안내 메일(`meetingNotify`), 회의록의 회의 연결(`minutes`),
  주간보고 내보내기(`/api/report`), AI 프로젝트 사실(`ai/projectFacts`)이다.
- `src/lib/repositories/supabase/meetings.ts` 26행: 챗봇의 회의 도구 3개와 대시보드 도구.
- `src/app/actions/inbox.ts` 43행: 헤더 알림함 전체.

단위 테스트는 Supabase 를 모킹해 이것을 잡지 못한다(vitest 6144 전부 통과).
같은 방식으로 스키마 전체를 훑었다. public↔public 표 쌍에 FK 가 둘 이상인 것 중 0003 이 새로 만든 것은 이 둘뿐이다.
나머지는 `auth.users` 참조이거나 기준선부터 있던 것이다(`task_dependencies`·`wiki_item_relations`).

**수정안(검증함, 7절).** 두 단일 FK 를 지운다. 복합 FK 가 같은 행을 같은 `on delete cascade` 로 덮는다.
`0003` 이 아직 `main` 에 없으므로, 3c 처럼 0003 본문을 고치고 롤백 파일에 되살리기를 더할 수 있다. 또는 코드의 임베드 5곳(위 목록)에 FK 힌트를 줄 수도 있다.
어느 쪽인지는 컨트롤러가 판정한다.

### 6.2 존재 은닉의 상태 코드와 SP1 노출 — 4.1·4.2

결함이 아니라 기록이다. 상태 코드 200 은 Next 스트리밍의 성질이다. 이름·페이로드 노출은 SP1 이 받아들인 개방 읽기 정책의 결과다.
SP2 가 닫을 때 이 문서의 `projectNameInHtml` 을 다시 잰다.

### 6.3 팀 마스터 캐시가 모듈 인스턴스마다 따로다 — 방금 만든 프로젝트 팀을 임포트가 못 볼 수 있다 (기존 설계, SP1 에서 드러남)

`src/lib/teams/master.ts` 는 프로세스 전역 캐시(TTL 60초)다. TTL 이 지난 뒤 첫 동기 읽기는 옛 값을 돌려주고 백그라운드로 갱신한다.
next dev 에서 설정 화면(`addProjectTeam` → `refreshTeams()`)과 `/api/import/execute` 라우트는 다른 모듈 인스턴스다. run2 는 같은 dev 서버로
다시 돌렸고, 임포트 라우트가 run1 에서 이미 로드돼 있었다. 그래서 방금 만든 ERP 를 못 보고 409 `needsTeams:["ERP"], scope:"global"` 를 냈다.

- `scope` 도 옛 캐시로 판정해 `global` 이다. 이 응답에 마법사가 "등록" 을 누르면(`registerTeams=true`) **프로젝트 팀이 아니라 전역 팀 ERP 를 만든다**(슈퍼유저일 때).
- SP0 에서는 부트스트랩이 서버 기동 전에 전역 팀을 만들어 드러나지 않았다. SP1 에서 팀이 프로젝트별이 되면서 드러났다.
- 깨끗한 순서(새 dev 서버)에서는 라우트가 팀 생성 뒤 처음 로드되므로 재현되지 않는다. 러너는 재시도로 덮지 않고 원인을 적어 멈춘다.
- 소유 태스크가 없다. SP4 R10(팀 캐시 워크스페이스 스코프)과 함께 볼 거리다.

## 7. 실험 — 두 단일 FK 를 지운 DB (exp1, reset 15:21:03)

`db:reset` 직후 로컬 DB 에만 아래를 적용하고 2절과 같은 순서로 돌렸다. 리포의 마이그레이션은 바꾸지 않았고, 다음 `db:reset`(run5)으로 원상태가 됐다. 실험은 단계 기록기 검사를 더하기 전의 러너로 돌렸다(단계 동작은 같다).

```sql
alter table public.meeting_attendees drop constraint meeting_attendees_meeting_id_fkey;
alter table public.notification_recipients drop constraint notification_recipients_event_id_fkey;
notify pgrst, 'reload schema';
```

결과: E2E **exit 0**, 17단계 전부 ✓(15:21:32 → 15:22:09). dev 서버 로그에 오류 줄이 0이다. 이 흐름 안에서는 6.1 뒤에 가려진 다른 실패가 없었다. 이 실험 실행은 헤더 알림함을 부르지 않았으므로, 알림함이 고쳐지는지는 FK 가 하나일 때 임베드가 풀린다는 PostgREST 규칙에 기댄 추론이다.

## 8. 완료하지 못한 것

- **E2E exit 0** — 6.1 이 고쳐지기 전까지 `render-pages` 가 실패한다. 고친 뒤 2절 순서로 다시 돌려 이 문서의 3절을 갱신한다.
- **브리프 문구의 "carol 로 `/p/B` 404"** — 스펙과 어긋나 검사하지 않았다(4절). 존재 은닉은 C·미존재 id 로 대신 검사했다.
- **존재 은닉의 HTTP 404** — 화면 경로에서는 스트리밍 때문에 받을 수 없다(4.1). digest 로 판정했다.
- **사람 눈의 화면 확인** — 브라우저가 localhost 에 닿지 못해 헤드리스 HTML 검사로 대신했다(5절).
