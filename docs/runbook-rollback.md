# 런북 — 롤백

> **D-Flow 현황(2026-09-24)** — 원격 스테이징·운영·Vercel 프로젝트가 아직 없다(첫 배포 SP에서
> 생성한다). 아래 본문 중 "프로덕션 배포" 관련 절차(Vercel Instant Rollback·`smoke:prod`·
> `mark:good`)는 **원격이 생긴 뒤에나 실행 가능**하며, 지금 실행 가능한 것은 §1(로컬 DB
> 롤백)뿐이다. 이 문서는 원본 리포의 원격 사고 기록이 아니라 D-Flow 자신의
> 절차이고, 원본의 DB 좌표에는 접속하지 않는다(`CLAUDE.md` "원본 DB 금지",
> `docs/fork-policy.md`).

---

## 1. 지금 쓸 수 있는 것 — 로컬 마이그레이션 롤백

원격이 없으므로 "운영 DB를 되돌린다"는 절차가 없다. 대신 로컬 스키마를 되돌리는 절차는
지금도 유효하다.

```bash
# 1) 되돌릴 마이그레이션에 대응하는 롤백 파일 확인
ls supabase/rollbacks/                        # NNNN_*_rollback.sql

# 2) 로컬 DB에 롤백 SQL 적용
#    (로컬 psql 불필요 — 컨테이너 안의 psql 을 쓴다. 컨테이너 이름은 supabase/config.toml project_id 기준)
docker exec -i supabase_db_d-flow psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/rollbacks/NNNN_설명_rollback.sql

# 3) 기준선부터 재적용해 결과가 깨끗한지 재검증
npm run db:reset
npm run db:diff:baseline   # 기준선 자체가 운영 카탈로그와 같은지(0001 까지만 재생해 대조 → 나머지 migration up)
npm run dev:bootstrap
```

롤백 파일이 없는 마이그레이션은 손으로 역방향 SQL을 써야 한다 — 새 마이그레이션에는
`supabase/rollbacks/NNNN_*_rollback.sql`을 함께 만드는 것이 규칙이다(`CLAUDE.md`).

**D-Flow 운영 데이터가 생긴 뒤에는 그 데이터를 절대 훼손하지 않는다.** 파괴적 SQL은 먼저
로컬 또는 전용 리허설 환경에서 검증한다.

---

### 첨부 마이그레이션의 조건부 롤백

`*_attachments_rollback.sql`은 `minute_files.deleted_at is not null` 행이 하나라도 있으면 `ATTACHMENTS_ROLLBACK_BLOCKED`로 중단한다. 객체 삭제가 끝나 `purged_at`이 채워져도 감사 메타 행은 남으므로 롤백 가능 상태가 되지 않는다. 파일 삭제 이전 백업으로 복구하거나, 객체 정리 뒤 톰스톤 메타를 없애는 별도 데이터 손실 작업을 명시적으로 확인해야 한다. 롤백 오류를 무시하거나 가드를 지우지 않는다.

메타 삭제를 승인받은 경우에만, 백업·대상 스택 확인 후 이미 객체 정리가 끝난 행을 지운다. 다음 SQL은 검토용이며 사용자 DB에서 자동 실행하지 않는다. 정리되지 않은 행은 계속 롤백을 막는다.

```sql
-- 별도 승인한 대상 DB에서만. 첨부 삭제 감사 메타가 영구 손실된다.
delete from public.minute_files
 where role = 'attachment' and deleted_at is not null and purged_at is not null;
```

워크스페이스·프로젝트의 저장된 `minutes.attachments` 정책과 설정 이력은 스키마 롤백으로 되돌리지 않는다. 전용 스택에서 적용·롤백·재적용과 데이터 보존을 먼저 검증한다. 이 PC의 사용자 DB는 메인 스택에 있으므로 §1의 예시 컨테이너 이름을 개발 리허설에 그대로 사용하지 않는다.

## 2. 원격이 생긴 뒤 — 프로덕션 화면이 깨졌을 때

아래는 **첫 배포 이후에나 실행 가능한** 절차다. 원본 리포에서 2026-07-27
사이드바·헤더 소실 사고 때 되돌릴 좌표를 아는 사람이 없어 복구가 지연된 경험을 바탕으로
설계됐다(부록 참고) — D-Flow에도 같은 형태의 배포가 생기면 이 구조를 그대로 쓴다.

### 2.0 먼저 30초 — 진짜 깨진 게 맞는가

되돌리기 전에 이것부터 의심한다.

| 확인 | 방법 | 이거면 코드 문제가 아니다 |
|---|---|---|
| 스테일 캐시 | `Cmd+Shift+R` (하드 리프레시) | 이걸로 나으면 배포 CSS는 멀쩡했던 것 |
| 브라우저 확대율 | `Cmd+0`으로 100% 복귀 | 확대돼 있으면 반응형 브레이크포인트가 실제보다 좁게 잡혀 레이아웃이 "정상 동작으로" 달라 보일 수 있다 |
| 다른 브라우저 | 시크릿 창 또는 다른 브라우저 | 여기서 정상이면 확장 프로그램·프로필 문제 |

셋 다 아니면 실제 배포 문제다. 아래로.

### 2.1 스모크 — 무엇이 깨졌는지 1분 안에 특정

```bash
SMOKE_URL=<배포 URL> npm run smoke:prod
```

CSS가 잘려서 도착했는지, 파스가 중단됐는지, 레이아웃 급소 규칙이 배포본에 실제로 있는지
검사한다(`scripts/smoke-prod.mjs`, 하한값은 로컬 실측 기준 — 그 파일 주석 참고). **실패하면
전달 계층 손상이 확정**이므로 곧바로 2.2로. 통과하는데도 화면이 깨져 보이면 2.0을 다시
의심할 것.

### 2.2 즉시 롤백 — Vercel Instant Rollback (가장 빠름, 코드 변경 0)

git을 건드리지 않고 이전 배포로 별칭만 되돌린다.

```bash
vercel ls <Vercel 프로젝트명> 2>&1 | head -20     # 직전 정상 배포 URL 확인
vercel rollback <직전-배포-URL> --yes
vercel rollback status <Vercel 프로젝트명>          # 완료 확인
SMOKE_URL=<배포 URL> npm run smoke:prod             # 되돌아갔는지 검증
```

대시보드로도 가능: Vercel → 해당 프로젝트 → Deployments → 해당 배포 `⋯` →
**Instant Rollback**.

> **주의**: 롤백은 코드만 되돌린다. DB는 그대로다. 되돌리는 구간에 마이그레이션이 있었다면
> 2.4를 먼저 읽을 것.

### 2.3 코드로 되돌리기 — known-good 태그

Instant Rollback은 임시 조치다. 원인을 못 찾겠으면 코드 자체를 정상 시점으로 되돌린다.
`npm run mark:good`(`SMOKE_URL` 필수)이 스모크 통과 시점에 `good-*` 태그를 남기는 것을
전제로 한다.

```bash
git fetch origin --tags
git tag -l 'good-*' | sort | tail -5        # 최근 known-good 목록
git log --oneline <태그>..origin/main       # 그 사이에 뭐가 들어왔는지
```

되돌리는 방법은 상황에 따라 둘 중 하나:

```bash
# (a) 범인 커밋이 특정됐다 — 그것만 되돌린다. 히스토리 보존, 가장 안전.
git switch main && git pull
git revert <범인-sha>
git push origin main
```

```bash
# (b) 특정 못 하겠고 일단 화면부터 살려야 한다 — 트리를 known-good 상태로 되돌린다.
git switch main && git pull
git restore --source=<태그> --staged --worktree -- .   # 추가·삭제·수정 전부 되돌림
git status                                             # 무엇이 되돌아가는지 눈으로 확인
git commit -m "revert: <태그> 상태로 되돌림 — <사유>"
git push origin main

# 검산: 트리가 태그와 정확히 같아야 한다
[ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse <태그>^{tree})" ] && echo 되돌림 확인
```

> **`git merge <태그>`로 되돌리려 하지 말 것.** known-good 태그는 `main`의 **조상**이므로
> 머지는 "Already up to date"로 끝나고 트리가 1바이트도 바뀌지 않는다. 되돌리려면 위처럼
> **새 커밋으로 트리를 덮어써야** 한다.

**강제 push를 쓰지 말 것.** `git push --force origin main`은 병렬 세션이 올린 커밋을 소리
없이 날린다.

### 2.4 DB가 얽혀 있을 때 — 여기서 판단이 필요하다

되돌리려는 구간에 마이그레이션이 있는지 먼저 확인한다:

```bash
git diff --name-only <태그>..origin/main -- supabase/migrations/
```

나온 게 없으면 그냥 2.3으로 진행하면 된다. 나왔다면:

| 마이그레이션 성격 | 코드만 롤백해도 되는가 | 근거 |
|---|---|---|
| 컬럼·테이블 **추가**만 | ✅ 안전 | 옛 코드는 새 컬럼을 모른다. 그냥 안 쓸 뿐. |
| 컬럼 **삭제**·이름 변경 | ❌ 위험 | 옛 코드가 없어진 컬럼을 읽으려 한다 → 즉시 500 |
| `NOT NULL` 제약 **추가** | ❌ 위험 | 옛 코드의 insert가 그 컬럼을 안 채운다 |
| RLS 정책 변경 | ⚠️ 확인 필요 | 옛 코드의 접근 패턴이 새 정책에 막힐 수 있다 |
| 데이터 백필 | ⚠️ 확인 필요 | 백필 자체는 보통 무해하나 되돌릴 수 없다 |

역방향 마이그레이션은 `supabase/rollbacks/<번호>_*_rollback.sql`로 있다 — 새 마이그레이션에는
필수다(`CLAUDE.md`). 적용은 원격이 생긴 뒤 Supabase Management API 경유
(`npm run db:apply -- <파일> --target prod`)로 한다. `supabase db push`는 쓰지 않는다.

### 2.4.1 설정 값이 손상됐을 때 — SQL 로 고친다(설정 표를 직접 update 하지 않는다)

`core.level_labels`(WBS 단계 이름) 같은 설정 값이 손상(invalid)되면 그 키를 쓰는 화면·API 만 멈추고 사유를 띄운다
(WBS 화면·Excel 내보내기·PL 업로드 대조·에이전트 상세 패널). 화면에서 고치는 경로는 Phase C 다 — 그 전에는 SQL 로 고친다.
설정 쓰기는 RPC 한 길이다(`project_settings` 를 직접 update 하면 revision·이력·검사가 빠진다). `apply_project_settings` 를
service_role(로컬은 컨테이너 psql 의 postgres)로 부르고, 명령 id 는 새로 만들고, 행위자는 복구하는 관리자의 계정 id 로 남긴다.

```sql
-- 1) 지금 상태 — revision 과 손상된 값(서버 로그 '[settings] invalid' 줄에 키·사유가 있다)
select revision, "values" -> 'core.level_labels' from public.project_settings where project_id = '<프로젝트 id>';
-- 2) 고칠 값은 앱 규칙을 지킨다: 앞뒤 공백 없음·빈 이름 없음·중복 없음·1~10개·기존 WBS 깊이 이상(모자라면 축소 거부와 같은 사고)
-- 3) RPC 로 쓴다 — 1) 의 revision 으로 CAS, 결과가 {"status": "applied", "revision": N+1} 인지 본다
select public.apply_project_settings('<프로젝트 id>', <1) 의 revision>, gen_random_uuid(),
  '{"core.level_labels": ["Phase", "Task", "Activity"]}'::jsonb, null, '<복구하는 관리자 auth.users id>', 1, 'internal');
-- 4) 이력 확인 — source internal·changed_by 가 3) 의 행위자
select revision, key, source, changed_by from public.project_settings_history
 where project_id = '<프로젝트 id>' order by id desc limit 3;
```

로컬은 `docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1`, 원격이 생긴 뒤에는 이 SQL 을 파일로 만들어
`npm run db:apply -- <파일> --target staging|prod` 로 보낸다. `SETTINGS_REVISION_CONFLICT` 면 그 사이 누가 저장한 것이다 — 1) 부터 다시.

### 2.5 사고 직후 — 두 가지만

```bash
SMOKE_URL=<배포 URL> npm run smoke:prod     # 실제로 나았는지 확인. "나아 보인다"로 끝내지 말 것.
SMOKE_URL=<배포 URL> npm run mark:good      # 정상 확인된 시점에 known-good 태그를 남긴다
```

`mark:good`은 스모크를 먼저 돌리고 통과할 때만 태그한다. **이 태그가 다음 사고 때 되돌아갈
곳이다.** 큰 작업을 마쳤거나 눈으로 화면을 확인했을 때마다 남겨두면 된다.

그리고 **무엇을 봤는지 기록할 것** — 브라우저와 버전, 확대율, dev인지 프로덕션인지, 하드
리프레시 전후. 증상이 사라지면 증거도 같이 사라진다.

---

## 부록 — 원본 리포 2026-07-27 사고 요약

D-Flow의 `src/app/globals.css` 끝에 있는 `@layer` 밖(unlayered) 반응형 display 유틸(`CLAUDE.md`
"CSS — 반응형 안전망 주의")은 이 사고의 응급 대응을 그대로 물려받은 것이다. 근본원인은
미확정이므로 원본 리포의 조사 기록을 참고용으로 남긴다.

| 항목 | 내용 |
|---|---|
| 증상 | 넓은 화면에서 사이드바(`hidden lg:flex`)·헤더 로고(`hidden sm:flex`)가 표시되지 않음. 프로덕션에서 발견. |
| 대응 | `globals.css` 끝에 `@layer` 밖 반응형 display 유틸 재선언(`smoke-prod.mjs`의 "반응형 display 안전망" 검사가 이 사본의 존재를 확인한다) |
| 근본원인 | **미확정.** 커밋이 지목한 "브라우저가 @layer 안에서 base `.hidden`을 반응형보다 우선 적용"은 빌드 산출물로 반증됨 — 픽스 전 CSS에서도 `.hidden`이 `.lg\:flex`보다 앞이고 같은 레이어·같은 특이성이라 스펙대로면 반응형이 이긴다. |
| 검증 공백 | 깨진 트리에서 `next build`·`tsc`·`eslint`·vitest 전량이 **전부 통과**했다. jsdom은 `@layer`를 캐스케이드에 반영하지 않고 `matchMedia`도 없어 원리적으로 판정 불가. |
| 안전망의 한계 | 프로덕션 CSS에서 base+반응형 쌍을 가진 속성군 중 `display` 1개만 덮는다. `grid-cols`·`flex-direction`·컨테이너 쿼리는 미커버. |
