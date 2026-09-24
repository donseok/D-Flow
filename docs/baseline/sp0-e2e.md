# SP0 완료 조건 실측 (2026-09-24)

스펙 `docs/superpowers/specs/2026-09-23-sp0-fork-bootstrap-design.md` 9절 done_when 과 플랜 부록 A(흔적 전면 제거) 검증 grep 을 로컬에서 잰 기록이다.
E2E·빌드 최종 측정 트리는 커밋 `ededd5a`(브랜치 `sp0/fork-bootstrap`)다. 그 뒤에는 문서·CI 만 바뀌었다(`d5702ae` CLAUDE.md, `7cd145e`·`d445edd` fork-policy, `8a27463` CI 기준선 대조 순서). grep·전체 테스트·기준선 대조는 그 위에서 다시 쟀다. 시각은 전부 KST. 여기의 커밋 SHA 는 로컬 보관 브랜치 `main-fork-history` 기준이며 원격 이력에는 없다(docs/fork-policy.md — 원격 루트는 squash 1커밋).

**요약** — 10항목 중 ✓ 9(3번의 CI 는 push 뒤), push 뒤 1(태그).
- 처음 측정(`b50e242`·`9156e5f`)에서는 1번이 ✗ 였다. 엑셀 임포트가 기준선 스키마에서 500 으로 실패했다(2.1).
  원본 운영에서 물려받은 결함이라 마이그레이션 `0002`(`f4d59e8`)로 고쳤다.
  기준선 대조 게이트는 그대로 두고 CI·로컬 대조 순서를 바꿨다(`d5d7439`, 6절).
- 부록 A grep 은 검증 범위에서 0건이다. 추적 파일 전체로 넓혀도 허용 SP0 문서 밖에는 없다(5절 — 부록 A 가 허용했던 폴백 env 이름은 최종 리뷰 fix wave 에서 제거했다).

## 1. 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · Postgres 17.6(Docker) · 마이그레이션 `0000`·`0001`·`0002` |
| 앱 | Next.js 15.5.19 `next dev` · Node 22.18.0 · `INVITE_ALLOWED_DOMAINS=example.com` |
| 재생 | `npm run db:reset` → `npm run env:local` → `BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD=… npm run dev:bootstrap`(팀 `운영`). 비밀번호는 env 로만 넘기고 파일에 쓰지 않았다 |
| 산출물 폴더 | 이 PC 의 임시 폴더 `<tmp>/e2e/final`(`E2E_OUT_DIR`, 커밋 안 함). 수정 전 측정분은 `<tmp>/e2e/b50e242/`·`<tmp>/e2e/9156e5f/`. 산출물·스크린샷은 임시 폴더라 보존하지 않았다(재현: `scripts/e2e-local.mjs`). |

## 2. E2E — `scripts/e2e-local.mjs`

브라우저 자동화 도구는 비밀번호를 입력할 수 없다. 그래서 러너가 화면이 부르는 경로를 그대로 HTTP 로 부른다.

| 단계 | 화면의 경로 | 러너가 부른 것 · 확인 |
|---|---|---|
| 로그인 | `/login` → Supabase 세션 쿠키 | 앱과 같은 `@supabase/ssr` 로 `signInWithPassword` → 쿠키 `sb-127-auth-token` → `GET /projects` 200(미들웨어가 `/login` 으로 돌려보내지 않음) |
| 프로젝트 생성 | `NewProjectModal` → 서버 액션 `createProject` | `.next/server/server-reference-manifest.json` 에서 액션 id 를 읽어 `POST /projects`(`next-action` 헤더, 인자 `[이름, null, null, null, ['단계','작업','활동']]`). DB 에서 `projects` 1건과 `project_settings.level_labels = 단계·작업·활동`·`max_depth 3` 을 확인 |
| 양식 | 마법사 "양식 다운로드" → `GET /api/import/template` | exceljs 로 예시 행 자리에 5행을 덮어씀(`1`/`1.1`/`1.1.1`/`1.2`/`1.2.1`, 말단 담당 = `운영`). 다시 읽어 헤더+5행인지 확인 |
| 감지 | `POST /api/import/inspect` | outline 계층(0열), 팀 열 `[[8,'*']]`(담당 열에 팀명 직접), 경고 1건 `담당 열의 팀명을 직접 사용` |
| 임포트 append | `POST /api/import/execute` `mode=append` | 마법사 기본값과 같다(`saveProfile=true`). `registerTeams=false` — 부트스트랩 팀이 이미 등록돼 있어야 한다. DB 에서 `wbs_items` 5행과 `운영` 담당 2행을 확인 |
| 임포트 replace | 같은 라우트 `mode=replace` | 같은 파일로 교체. 응답 백업이 5행이고, 교체 뒤에도 5행·`운영` 담당 2행(중복 없음)인지 확인 |
| 내보내기 | 리포트 화면·WBS 화면 | `GET /api/report?format=pptx`·`format=xlsx`(주간보고), `GET /api/export`(WBS 엑셀) |
| 흔적 검사 | — | jszip 으로 산출물 zip 의 모든 항목(XML·rels·docProps·미디어)을 UTF-8 로 풀어 흔적 낱말 28개를 찾는다(`scripts/lib/e2e.mjs` `TRACE_WORDS` = 스펙 9절 + 부록 A grep + XML 엔티티 표기) |

### 2.1 수정 전 — 기준선 스키마에서 임포트 실패

`b50e242`(08:16)와 `9156e5f`(08:33)에서 깨끗한 기준선으로 돌린 두 실행 모두 로그인·프로젝트 생성·양식·감지까지 통과했다.
그다음 `import-execute` 에서 **500 `column "level" of relation "wbs_items" does not exist`** 로 멈췄다.

- `0000_baseline.sql` 의 `import_wbs`·`replace_wbs` 가 둘 다 `insert into wbs_items (…, level, …)` 를 한다. 그런데 `wbs_items` 에는 `level` 열이 없다(`level_idx` 만 있다).
- 원본 리포 이력:
  - `0063_wbs_rpc_drop_level` 이 두 RPC 에서 `level` 을 뺐다.
  - `0064_drop_wbs_level` 이 열을 지웠다.
  - 그 뒤 `0071_project_teams` 가 두 함수를 `level` 이 든 옛 본문으로 다시 만들었다. plpgsql 은 함수를 만들 때 열이 있는지 검사하지 않는다.
- 기준선은 운영과 같다(`baseline-diff` 불일치 0, 함수 82개 일치). 따라서 **원본 운영의 엑셀 임포트 마법사도 append·replace 둘 다 같은 오류로 실패한다.** 원본에서 물려받은 결함이다.

### 2.2 수정 — 마이그레이션 `0002_import_wbs_level_fix` (`f4d59e8`)

- 두 함수를 `create or replace` 한다. 본문은 0000 과 같고 insert 의 `level` 열과 `v_item->>'level'` 값만 뺐다(0063 과 같은 조치, 0071 의 프로젝트 팀 우선 조회는 유지).
  시그니처·`LANGUAGE plpgsql`·보안 속성(invoker, `search_path` 미지정)·권한은 그대로다.
- 롤백 `supabase/rollbacks/0002_import_wbs_level_fix_rollback.sql` 은 0000 본문을 그대로 되살린다. 결함 상태로 돌아간다는 것을 파일 머리에 적었다.
- 로컬 검증:
  - 롤백 SQL 적용 뒤 두 함수의 `pg_get_functiondef` md5 와 ACL 이 `db reset --version 0001` 한 DB 와 같다.
  - `plpgsql_check`(트랜잭션 안에서 설치했다가 롤백)로 public 의 plpgsql 함수 57개를 훑었다. 기준선 본문에서는 `import_wbs`·`replace_wbs` 2건만 오류이고, `0002` 뒤에는 0건이다.
  - N단 임포트 `import_wbs_upsert` 는 `level_idx` 를 써서 해당 없다.

### 2.3 최종 실행 — 새 DB(reset 08:54:51, 0000·0001·0002) 실행 08:55:27

| 단계 | 시각 | 결과 |
|---|---|---|
| login | 08:55:29 | ✓ |
| create-project | 08:55:29 | ✓ 서버 액션 `createProject` 경유, 라벨 단계·작업·활동 / `max_depth` 3 |
| fill-template | 08:55:31 | ✓ 5행 |
| import-inspect | 08:55:31 | ✓ |
| import-append | 08:55:32 | ✓ `{ ok: true, count: 5, mode: "append", profileSaved: true }`, 5행·`운영` 담당 2행(primary) |
| import-replace | 08:55:32 | ✓ `{ ok: true, count: 5, mode: "replace" }`, 백업 5행, 경고 2건(변경 이력 비백업·휴일 갱신만), 교체 뒤 5행·`운영` 담당 2행 |
| export | 08:55:34 | ✓ 3건 |
| trace-scan | 08:55:34 | ✓ 적중 0 |

| 산출물 | 파일(`<tmp>/e2e/final/`) | 바이트 | zip 항목 |
|---|---|---|---|
| 주간보고 PPT | `E2E_샘플_프로젝트_202609232355_9월4주차_2026-09-24.pptx` | 430,279 | 113 |
| 주간보고 엑셀 | `E2E_샘플_프로젝트_202609232355_9월4주차_2026-09-24.xlsx` | 10,635 | 11 |
| WBS 엑셀 | `WBS_E2E_샘플_프로젝트_202609232355_2026-09-24.xlsx` | 20,784 | 11 |
| (입력) 양식·채운 양식 | `wbs-template.xlsx`·`wbs-filled.xlsx` | — | — |

`0002` 커밋 전 08:45 의 같은 실행(reset 08:44)도 전 단계를 통과했다. 이것이 `f4d59e8` 의 `Staging-verified` 트레일러 근거다.

## 3. 브라우저 확인 (claude-in-chrome, 2.3 의 데이터)

비밀번호 입력 대신 러너와 같은 방식으로 만든 로컬 세션 쿠키를 페이지 JS 로 심었다. 확인이 끝난 뒤 쿠키를 지우고 탭을 닫았다.
GIF 녹화(`sp0-e2e.gif`)는 하지 않았다.

| 시각 | 화면 | 스크린샷(`<tmp>/e2e/final/browser/`) |
|---|---|---|
| 08:56 | `/login`: D-Flow 로고·제품명. 브라우저 자동완성 값은 지우고 찍었다 | `01-login.jpg` |
| 08:56 | `/projects`: 로그인 상태, 프로젝트 1개(`E2E 샘플 프로젝트 202609232355`) | `02-projects.jpg` |
| 08:57 | `/p/<id>/wbs`: 5행(설계 > 요구 분석 > 요구사항 정리, 화면 설계 > 화면 정의), 단계 칩 1·2·3, 실적%·간트 막대 | `03-wbs-imported.jpg` |
| 08:57 | `/p/<id>/import` 엑셀 탭: 임포트 마법사 1단계(양식 다운로드·파일 선택) | `04-import-wizard-xlsx.jpg` |

이 화면 배치에서는 담당팀 열이 보이지 않았다. 담당 `운영` 은 러너가 DB 에서 확인했다.

## 4. 산출물 검사 (최종 실행)

| 검사 | 결과 |
|---|---|
| `unzip -tq` (산출물 3 + 입력 2) | 5개 모두 `No errors detected` |
| 스텝 2 grep(`unzip -p f '*.xml' \| grep -cE …`, 브리프 그대로) | 파일마다 0 |
| 확장 grep(모든 항목, 대소문자 무시, 부록 A 낱말 + 인물·봇 이름 + 양식 샘플 데이터 낱말) | 파일마다 0 |
| 러너 `trace-scan`(`TRACE_WORDS` 28개, 모든 항목) | 적중 0 |
| 커밋된 양식 2개(`src/lib/report/assets/*.pptx`, HEAD blob)의 모든 항목 | 0 |
| XML 구조 | python `zipfile.testzip()` 오류 없음. 모든 `.xml`·`.rels` 파싱 오류 0(PPT 80개 · 주간 엑셀 11 · WBS 엑셀 11). 슬라이드 2장. 시트는 주간 엑셀 `1.공정보고`·`2.WBS`, WBS 엑셀 `WBS`·`Holiday` |
| 라이브러리로 열기 | python-pptx 1.0.2: 슬라이드 2장, 2번 슬라이드 표 머리(구분·전주·금주 주요활동). `docProps/core.xml` 제목 `주간보고 양식`, 작성자·수정자 `D-Flow`. openpyxl 3.1.5: 모든 시트 로드(공정보고 26행·WBS 8행 / WBS 8행·Holiday 3행) |
| 렌더 | macOS Quick Look(`qlmanage -t`)이 셋 다 썸네일을 그렸다 |
| LibreOffice PDF 변환 | **못 함**. `/opt/homebrew/bin/soffice` 래퍼가 가리키는 앱이 설치돼 있지 않다. 위의 파서·Quick Look 검사로 대신했다 |

## 5. 흔적 grep (플랜 부록 A, HEAD `7cd145e`)

| 검사 | 범위 | 결과 |
|---|---|---|
| 스펙 9절 브랜드 grep 두 개 + 브리프 3단계 변형(봇 이름·XML 엔티티 포함) | `src public` | 0 · 0 · 0 ✓ |
| 금지 ref 2개 | `scripts src .github supabase` | `scripts/lib/targets.mjs` 뿐 ✓ |
| Task 18 검증 grep(부록 A 그대로) | `src tests scripts .claude kit public` | 0 ✓. `b50e242` 에서 걸리던 `scripts/neutralize-pptx.mjs`·`tests/report/template-neutral.test.ts` 는 `885858c`·`8f01d32` 가 치웠다 |
| Task 19 봇 이름 | 같은 범위 + `.env.local.example` | 측정 당시엔 폴백 env 이름뿐이었다(`src/lib/ai/similarity.ts` 1 · `.env.local.example` 1 · `tests/ai/similarity.test.ts` 4, 부록 A 가 허용한 예외). 배포된 적 없는 제품이라 최종 리뷰 fix wave 에서 폴백을 제거해 지금은 0 ✓ |
| 추적 파일 전체 | `git ls-files` 전부 | 허용 SP0 문서(마스터 스펙·SP0 스펙/플랜·`fork-policy`·`baseline`·런북)뿐 ✓. `CLAUDE.md` 에 남아 있던 원본 제품명·고객명 2줄은 `d5702ae` 가 걷어냈다. 금지 ref 문자열 두 개는 가드로 남겼다(`CLAUDE.md`·`targets.mjs`·그 테스트·허용 문서) |
| 개인정보(실명·개인 메일·호스트명) | 추적 파일 전체 | 0 — 단, 플랜 부록 A 자체에 적혀 있던 식별자는 최종 리뷰 fix wave 에서 걷어냈다. 테스트의 `someone@`·`a@` 는 범용 자리표시자다 |
| 이번에 추가한 파일 | 러너·순수 조각·테스트·`0002` 와 그 롤백 | 0 ✓. 러너의 낱말 목록은 base64 로 두었고, 테스트가 러너 원문을 같은 목록으로 검사한다 |

## 6. 기준선 대조 — 0002 이후의 순서 (`d5d7439`·`8a27463`)

`baseline-diff.mjs` 는 적용된 마이그레이션이 정확히 `0000`·`0001` 일 때만 대조한다. 이 게이트는 그대로 둔다.
전체 reset 뒤에 돌리면 "기준선 이후 마이그레이션이 적용돼 있다(0002)" 로 멈춘다(실측).

- CI `db` 잡: `supabase start` → `supabase db reset --version 0001` → `node scripts/baseline-diff.mjs` → `supabase migration up --local`(나머지 0002+ 적용).
  처음(`d5d7439`)에는 마지막 단계가 두 번째 전체 `db reset` 이었다. 9절의 502 경합을 한 번 줄이려고 `8a27463` 에서 `migration up` 으로 바꿨다. 이 명령은 DB 재생성·서비스 재시작이 없다.
- 로컬: `npm run db:diff:baseline` 이 같은 세 단계를 돈다. README·`runbook-rollback`·`runbook-staging` 에 한 줄씩 적었다.
- 실측:
  - 08:42·08:50·08:58 세 번 모두 0001 에서 `✓ 불일치 0` 이 나왔다(정책 123·함수 82·트리거 15·버킷 3·RLS 67·발행 1, 0000 왕복 허용 잔차 20줄 외 차이 0).
  - 세 번 모두 끝에 `0000,0001,0002` 가 적용된 상태였다.
  - 첫 측정 트리에서도 08:06·08:22·08:37 에 불일치 0 이었다.
  - `migration up` 순서로 바꾼 뒤 09:05 에 다시 돌렸다. 0001 에서 불일치 0, 끝 상태 `0000,0001,0002`. 두 함수 정의 md5 는 전체 reset 으로 0002 를 적용한 DB 와 같다.

## 7. done_when 체크리스트 (스펙 9절)

| # | 항목 | 결과 | 근거 |
|---|---|---|---|
| 1 | 빈 DB → 로그인 → 프로젝트 생성(라벨) → WBS 엑셀 임포트 → 주간보고 PPT/엑셀 내보내기 완주, 브라우저 기록 | ✓ | 2.3(0002 적용한 새 DB, append·replace 둘 다) + 3절. 수정 전 실패와 원인은 2.1 |
| 2 | 산출 PPTX/XLSX 가 열리고 흔적 0 | ✓ | 흔적 0(4절). 열리는지는 LibreOffice 대신 파서·Quick Look 으로 확인했다 |
| 3 | 테스트·lint·build 초록, CI 두 잡 초록 | ✓ / CI 는 push 뒤 | `d5d7439` 에서 `npx vitest run` 480파일 5910건 통과, 실패 0(08:52). `npm run lint` 오류 0·경고 5(08:52). `npm run build` 성공(08:53). `7cd145e` 에서 전체 테스트 다시 5910건 통과, 실패 0(09:03). CI 는 원격 push 전이라 확인하지 못했다 |
| 4 | 브랜드 grep `src public` 0 | ✓ | 5절 |
| 5 | 금지 ref grep 이 `targets.mjs` 와 그 테스트뿐 | ✓ | 5절(`scripts src .github supabase` 범위에서는 `targets.mjs` 하나) |
| 6 | `baseline-diff` 불일치 0, 라이브 카탈로그 스냅샷 커밋 | ✓ | 6절. 스냅샷 `5e181be` |
| 7 | `tests/invariants/migration-files.test.ts` 초록 | ✓ | 5건 통과(`0002` 와 롤백 쌍 포함) |
| 8 | `FLOOR` 재측정 반영 | ✓ | `62f895d`(`scripts/smoke-prod.mjs`) |
| 9 | CLAUDE.md·`docs/fork-policy.md`·runbook 개정 | ✓ | `ed53e39`·`cf824e0`·`d5702ae`(CLAUDE.md), `7cd145e`·`d445edd`(fork-policy 에 17′ 규칙: 원본 이력은 루트 `c40de1a` 와 SP0 브랜치까지 로컬 보관 브랜치에만, 원격 루트는 `Fork-of` 트레일러를 단 squash), `040995b`·`d5d7439`·`8a27463`(런북). `test -f docs/fork-policy.md` ok |
| 10 | 태그 `sp0-done` push | push 뒤 | 사용자 승인 뒤 진행 |

## 8. 재현

```bash
npm run db:reset && npm run env:local
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD=… npm run dev:bootstrap
INVITE_ALLOWED_DOMAINS=example.com npm run dev          # 다른 터미널
BOOTSTRAP_PASSWORD=… E2E_OUT_DIR=<폴더> node scripts/e2e-local.mjs   # stdout 에 JSON 요약, 실패하면 exit 1
npm run db:diff:baseline && npm run dev:bootstrap       # 기준선 대조(0001 재생 → 대조 → migration up — reset 이 계정을 지운다)
npx vitest run && npm run lint && npm run build
```

러너는 `.env.local` 이 로컬을 가리키지 않거나 `E2E_BASE_URL` 이 localhost·127.0.0.1 이 아니면 시작하지 않는다.
액션 id 는 `next dev` 가 `/projects` 를 컴파일하면서 쓴 매니페스트에서 읽는다. 다른 서버가 같은 `.next` 를 쓰고 있으면 어긋날 수 있다.

## 9. 관찰

- **`db reset` 의 간헐 502**:
  - 증상: reset 은 마이그레이션·시드를 다 적용한 뒤 "Restarting containers" 단계에서 CLI 가 Kong 을 거쳐 `GET /storage/v1/bucket` 을 부르다 502 로 끝났다. 08:15 에 1회, 08:46~08:50 에 5회 연속 났다.
  - 원인(Kong 로그): 재시작한 storage·realtime 컨테이너의 IP 가 서로 바뀌었는데, 오래 떠 있던 Kong 이 옛 IP 를 붙들어 connection refused 가 났다.
  - 조치: `docker restart supabase_kong_d-flow` 뒤 정상으로 돌아왔다.
  - CI `db` 잡은 reset 을 한 번만 하고(`--version 0001`), 나머지는 서비스를 재시작하지 않는 `migration up` 으로 적용한다(`8a27463`). 첫 reset 은 여전히 이 경합에 노출되므로, 최종 리뷰 fix wave 에서 CI 의 이 reset 에 최대 3회 재시도(사이에 Kong 재시작)를 붙였다.
- WBS 화면의 최상위 추가 버튼 라벨이 프로젝트 단계 라벨(`단계`)이 아니라 고정 문자열 `Phase` 다. 주간보고 엑셀 지표 칸의 `1개 Phase` 도 마찬가지다. SP3 라벨 설정화 때 볼 곳이다.
