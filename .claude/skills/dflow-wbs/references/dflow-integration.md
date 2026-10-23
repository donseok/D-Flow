# D-Flow 연동 표기 (dflow-wbs 에서 옮김)

> SKILL.md `## D-Flow 연동 표기` 절에서 분리. 원문 그대로. 절 제목 = 아래 `##`.

## D-Flow 연동 표기 (정본: 부록 §2.5·§2.6·§7.2)

생성물이 D-Flow import(웹 "WBS 마크다운" 탭 또는 `POST /api/v1/wbs/import`)로 올라간다는 전제. wbs.md 표면에 **넣는 것과 넣지 않는 것**이 정해져 있음. 표기 = references/output-format.md(levels 계약).

### 넣는 것

| 항목 | 계층 | 문법 | 규칙 |
|---|---|---|---|
| 담당자 | Task | Task 줄 토큰 `@{email}` | 입력 값이 email 이면 그 값. 아니면 토큰을 생략하고 **"담당 미매칭" 표에 원문과 함께 전량 나열**(생략 금지). 빈 값(미기재)은 미매칭 아님 — 표에 안 넣음. 서버는 프로젝트 명단의 **이메일로만** 매칭한다. |
| 모듈 담당자 | WP / ACT | 쓰지 않음 | 헤딩에 `@` 토큰을 붙이면 import 가 그 WP 를 배정·알림한다 — 모듈 담당은 웹에서 지정한다. 입력의 모듈 담당 컬럼은 생성 리포트에만 남김. |
| 프로그램 추적 키 | Task | 상세 블록 `  - prd-ref: program:{프로그램ID}` | 프로그램 리스트 모드 필수. 재생성 시 이 값으로 기존 Task 를 찾음. |

⚠️ **`assignee` 시드는 하류에서 자동 발행을 켠다.**
- 업로드 시 담당자 매칭 성공한 **리프 Task = D-Flow 작업 주문 자동 생성** (부록 §2.8).
- 그 주문은 **그 사람만 claim** 가능 (불일치 시 403 `not_assignee`).
- 담당 컬럼 채우기 = 표기 아닌 배정 행위. 확정된 담당만 적음.

### ID 는 import 매칭 키다 — 재번호매김 금지

ID(`WP-XX` · `ACT-XX-YY` 헤딩, `TSK-XX-YY[-ZZ]` Task 줄)와 frontmatter `module` 이 D-Flow `external_ref`(`{module}/{ID}`)가 된다. import upsert 가 이 값으로 기존 행을 찾음 (부록 §7.2-1).

wbs.md 는 import 후 은퇴. 이 규칙의 사정거리 = "재생성" 아닌 "재import". 그래도 필요함 — **초기 import 는 한 번에 성공 안 함.**
- 담당자 미매칭·유형 미매핑·검증 실패로 고쳐 여러 번 돌림.
- ID 가 흔들리면 같은 항목이 DB 에 여러 벌 생김.

- **기존 wbs.md 있으면 먼저 읽고, `prd-ref: program:{ID}` 로 프로그램 ↔ Task ID 매핑을 복원한 뒤 그 ID 를 그대로 재사용.**
  옛 표기(`### TSK-` 헤딩 + 열 0 필드)와 새 표기(`- [ ] TSK-` 줄 + 들여쓴 필드)를 둘 다 읽는 복원 명령:
  ```bash
  node -e 'const m={};let last=null;for(const l of require("fs").readFileSync(process.argv[1],"utf8").split(/\r?\n/)){const t=/^\s*(?:#{2,6}\s+|-\s+\[[ xM]\]\s+)(TSK-[0-9]+(?:-[0-9]+)+):/.exec(l);if(t){last=t[1];continue}const p=/^\s*-\s+prd-ref:.*\bprogram:([^\s,]+)/.exec(l);if(p&&last)m[p[1]]=last}console.log(JSON.stringify(m,null,1))' {DOCS_DIR}/wbs.md
  ```
  WP·ACT 는 제목(모듈명·그룹명)으로 복원한다 — `^#{2,3}\s+((?:WP|ACT)-[0-9-]+):\s*(.+)$`.
- 옛 표기 wbs.md 를 새 표기로 다시 만들 때도 같은 `module`(= `DOCS_DIR` 마지막 세그먼트)과 ID 를 쓴다 — 이미 올라간 항목이 갱신된다.
- 신규 프로그램 = 해당 WP/ACT 의 **다음 번호를 이어 붙임.** 중간 삽입으로 뒤 번호 밀기 금지.
- 사라진 프로그램 ID **재사용 안 함.** 항목 삭제 = 웹에서 사람이 (import 는 삭제 안 함).
- ID 바꾸면 upsert 매칭 실패 → **DB 중복 행.** 정렬 미관 때문에 번호 재부여 금지.
- **`01` 기반 번호 규칙 = 신규 생성에만 적용.** 이미 import 된 wbs.md 가 `WP-00` 으로 시작해도 그대로 둠 — 재번호매김하면 upsert 매칭 실패 → 중복 행.
- **import 성공 후 wbs.md 재생성 금지.** 이후 구조 변경 = 웹에서. 재생성 = 예외 경로, 하려면 위 ID 복원을 반드시 거침.

### 넣지 않는 것 (웹이 정본)

- **실적·진척률** — 이미 금지 (`## 출력 형식` 말미). 재업로드해도 웹 값 보존.
- **`[as]` 이상의 상태 시드** — `## 상태` 절 참조.
- **D-Flow 식별자**(`project_id`·`wbs_item` UUID·주문 상태) — 업로드 **요청 파라미터**, 파일 필드 아님. 둘 곳은 아래 절.
- **담당팀(`item_owners`)** — D-Flow 조직 축. 파일에 대응 개념 없음. 담당자(개인)와 혼동 금지.
- **branch·worktree 경로** — 넣지 않음. 이유 넷:
  1. **이미 파생값** — `wp-setup.py:257,269,270` 실측: `wt_name = {WP_ID}{suffix}` → worktree `.claude/worktrees/{wt_name}` · branch `dev/{wt_name}`. 계산되는 값을 파일에 복제하면 반드시 어긋남.
  2. **wbs.md 자체가 worktree 마다 복제됨** — WP당 worktree N개가 각자 사본을 가짐. `merge-wbs-status.py` 는 `status` 한 컬럼만 우선순위 merge(`:28-33,172`), 다른 필드엔 merge 규칙 없음.
  3. **자기 참조 역설** — branch `dev/WP-04` 에서 "branch: dev/WP-04" 를 commit 하면 main merge 순간 거짓. branch 는 지워져도 기록은 남음.
  4. **추적 정본 = git** — commit 트레일러 `DFlow-Order: <uuid>`(부록 §3) + `done --auto-links` + 0072 `evidence.{branch,base_sha,head_sha,repo_url,pr_url}`. `git log --grep='DFlow-Order: <uuid>'` 가 branch 명보다 강한 추적 (branch 는 지워져도 commit 은 남음).

  **분산(사람마다 다른 PC·clone) 환경 = 근거 더 강함.**
  - 각자 자기 Task 줄에 branch 를 쓰면 wbs.md 상시 충돌.
  - 위 1번 파생 규칙(`dev/{WP_ID}`)은 `/dev-team` 이 한 PC 에서 worktree 를 팔 때만 성립. 사람이 손으로 판 branch 에는 적용 안 됨.

  실행 시점 작업 위치를 남겨야 하면 자리는 둘:
  - **단일 PC(worktree 병렬)** — `docs/tasks/<ID>/state.json` (실행 정본, worktree 마다 값 달라도 정상, merge 대상 아님). **DEV-01 몫.**
  - **분산 다인** — **서버**(D-Flow). 남의 PC 파일을 못 보므로 state.json 도 답 아님.

  어느 쪽이든 **이 스킬 범위 아님.** 분산 추적에 대한 `/dflow-wbs` 기여 둘:
  - **안정적 ID** (서버 추적이 한 항목에 누적되려면 `external_ref` 불변).
  - **`assignee` 시드** (자동 발행 → 주문 → claim → 서버 추적의 진입점).

### D-Flow 프로젝트 바인딩 — wbs.md 가 아니라 작업 리포의 `.env`

**D-Flow 에 프로젝트 여러 개.** wbs.md 하나가 어느 D-Flow 프로젝트로 올라가는지 반드시 명시해야 함. 그 자리 = **작업 리포의 `.env`** (dflow-work 스킬과 같은 파일).

wbs.md 에 안 넣는 이유: 파일은 git 으로 복제·branch 되고 test/운영 환경을 오감. 환경 결합을 박으면 **엉뚱한 프로젝트에 업로드되어 운영 데이터 오염.**

```env
DFLOW_API_BASE=https://<host>
DFLOW_PATS=dflow_pat_<prefix>_<secret>[,dflow_pat_...]

# 리포 ↔ D-Flow 프로젝트 바인딩
DFLOW_PROJECT_ID=<D-Flow project uuid>             # 리포 전체가 한 프로젝트일 때
DFLOW_PROJECT_MAP=docs/c10=<uuid>,docs/m30=<uuid>  # DOCS_DIR 마다 프로젝트가 다를 때
```

해석 순서 (먼저 맞는 것 우선):

1. `DFLOW_PROJECT_MAP` 에 현재 `DOCS_DIR` 키 있으면 그 값
2. 없으면 `DFLOW_PROJECT_ID`
3. **둘 다 없으면 업로드 시도 안 함** — 추측 금지, "프로젝트 하나뿐이겠지"로 진행 금지 (fail-closed).
   - 생성은 정상 완료.
   - 리포트에 `업로드 불가 — .env 에 DFLOW_PROJECT_ID 또는 DFLOW_PROJECT_MAP 필요` 를 남김.

`module` = wbs.md frontmatter 의 `module` — 기본값 `DOCS_DIR` 의 마지막 경로 세그먼트 (`docs/c10` → `c10`, `docs` → `docs`). 별도 env 키 안 만듦.
형식 `^[A-Za-z0-9_-]{1,32}$` 에 안 맞으면(한글 폴더 등) 사용자에게 영문 코드를 묻는다. 재업로드 때 같은 값을 써야 갱신이 된다(다르면 같은 트리가 하나 더 생긴다).
`project_id` 는 웹 업로드면 필요 없고(화면이 그 프로젝트다), API 업로드에만 위 해석 순서로 쓴다.

스킬 준수 사항:

- `.env` 값 출력 안 함 (같은 파일에 PAT 있음 — 부록 §2.7, 한 파일에 N인분 자격증명). **존재·키 유무만 확인.**
- 이 키들을 **wbs.md 에도, 생성 리포트 본문에도 값으로 안 적음.** 리포트에는 "설정됨 / 없음"만.
- `.env` 생성·수정 금지. 없으면 필요한 키 이름만 알림.

⚠️ 키 이름 = 부록 §2.7 로컬 계약의 확장, **TSK-02-01(계약 동결)에서 최종 확정.** 확정 값이 다르면 이 절을 그쪽에 맞춤.
