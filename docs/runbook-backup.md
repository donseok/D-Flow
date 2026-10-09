# 런북 — 백업·복구

> **D-Flow 현황(2026-10-09)** — 원격 스테이징·운영 DB 가 아직 없다(첫 배포 SP 에서 만든다). 그래서 아래 절차 가운데
> **실제로 실행해 본 것은 로컬 스택의 `pg_dump -Fc` 덤프뿐**이다(`docs/runbook-user-db-apply.md` §2 — 마이그레이션 적용 전 백업으로 여러 번 썼다).
> 원격·자체호스트 대상의 덤프, Storage 버킷 백업, 복구 리허설은 **한 번도 실행하지 않았다**. 그런 절차에는 제목에 `(미검증)` 을 붙였다.
> 첫 원격이 생기면 §5 의 복구 리허설을 스테이징에서 먼저 하고, 결과와 고친 명령을 이 문서에 반영한 뒤 `(미검증)` 을 뗀다.
> 원본 리포의 DB 좌표에는 접속하지 않는다(`CLAUDE.md` "원본 DB 금지", `scripts/lib/targets.mjs` 금지 목록).

---

## 0. 무엇을 백업하는가

데이터는 두 곳에 있다. 한쪽만 백업하면 복구가 반쪽이 된다.

| 대상 | 내용 | 백업 수단 |
|---|---|---|
| Postgres | 앱 스키마(`public`), 계정·세션(`auth`), Storage 의 **객체 목록**(`storage.objects` — 파일 본문이 아니라 행) | `pg_dump -Fc`(§1·§2) |
| Storage 객체(파일 본문) | 버킷 다섯: `minutes`(회의록 원본·첨부), `issue-attachments`, `deliverables`(작업 산출물), `form-templates`(보고서 양식), `branding`(로고) | 객체 복사(§3) |
| 배포 환경 변수 | Supabase 좌표·service_role 키, `CRON_SECRET`, SMTP·LLM 값 | 운영자의 비밀 저장소(이 리포·백업 파일에 넣지 않는다) |

- 버킷 목록의 정본은 마이그레이션이다(`supabase/migrations/` 의 `insert into storage.buckets` — 기준선의 셋 + `branding`·`form-templates`). 버킷이 늘면 이 표를 같이 고친다.
- DB 덤프에는 계정 이메일과 비밀번호 해시가 들어 있다. **덤프 파일은 저장소·대화·티켓에 올리지 않는다.** 보관 위치는 권한을 좁힌다(디렉터리 700, 파일 600).
- 설정 이력·권한 이력은 지워지지 않는 기록(WORM)이라 덤프에 그대로 담긴다. 복구는 "그 시점의 DB 전체"로 돌아가는 것이지 일부 표만 골라 되돌리는 것이 아니다.

## 1. 로컬 스택 덤프 — 검증된 절차

마이그레이션을 메인 스택에 적용하기 전의 백업으로 써 온 절차다(`docs/runbook-user-db-apply.md` §2 와 같다). 컨테이너 이름은 `supabase/config.toml` 의 `project_id` 를 따른다.

```bash
D=/Users/<사용자>/D-Flow-backup/$(date +%Y%m%d-%H%M); mkdir -p "$D" && chmod 700 "$D"     # 저장소 밖
docker exec supabase_db_d-flow pg_dump -U postgres -d postgres -Fc -f /tmp/full.dump
docker cp supabase_db_d-flow:/tmp/full.dump "$D/full.dump" && docker exec supabase_db_d-flow rm /tmp/full.dump
chmod 600 "$D/full.dump"
ls -l "$D"; pg_restore -l "$D/full.dump" | head -3                                        # 크기·목차 확인
```

로컬 Storage 객체는 Docker 볼륨에 있다. 로컬 데이터는 개발용이라 따로 백업하지 않아 왔다 — 필요하면 §3 의 방법을 로컬 주소로 쓴다(미검증).

## 2. 원격·자체호스트 DB 덤프 (미검증)

덤프는 **DB 에 직접 붙는 연결 문자열**로 뜬다(연결 풀러를 지나는 주소가 아니라 직접 연결 — 풀러의 트랜잭션 모드는 `pg_dump` 가 쓰는 세션 기능을 지원하지 않는다).
연결 문자열·비밀번호를 명령줄에 적지 않는다(프로세스 목록·셸 기록에 남는다) — 권한 600 인 `~/.pgpass` 또는 환경 파일을 쓴다.

```bash
# /etc/dflow/backup.env (chmod 600):  PGHOST=…  PGPORT=5432  PGUSER=postgres  PGDATABASE=postgres   (비밀번호는 ~/.pgpass)
set -a; . /etc/dflow/backup.env; set +a
D=/var/backups/dflow/$(date -u +%Y%m%dT%H%MZ); mkdir -p "$D" && chmod 700 "$D"
pg_dump -Fc --no-owner --no-privileges -f "$D/full.dump"            # 전체(스키마+데이터). 관리형 Supabase 는 소유자·권한을 플랫폼이 다시 깐다
chmod 600 "$D/full.dump"
pg_restore -l "$D/full.dump" > "$D/toc.txt"                          # 목차가 뽑히면 파일이 온전하다
sha256sum "$D/full.dump" > "$D/full.dump.sha256"
```

- `pg_dump` 의 주 버전은 서버의 주 버전 이상이어야 한다(낮으면 거부한다). 서버 버전은 `select version()` 으로 본다.
- 관리형 Supabase 에서는 `auth`·`storage` 같은 플랫폼 스키마의 소유자가 `postgres` 가 아니다. 위 명령이 권한 오류로 멈추면 Supabase CLI 의 덤프(`supabase db dump` — 역할·스키마·데이터를 나눠 뜬다)로 바꾸고 그 명령을 여기에 적는다. **어느 쪽이 실제로 도는지는 첫 원격에서 확인해야 한다.**
- 관리형 Supabase 의 자동 백업·시점 복구(PITR)가 켜져 있어도 이 덤프를 따로 둔다 — 플랫폼 백업은 그 프로젝트 안에서만 되돌릴 수 있고, 다른 호스트로 옮기거나 리허설하는 데 쓸 수 없다.

### 주기·보관

정한 값이 아니라 **권고 기본값**이다 — 운영자가 데이터 중요도에 맞춰 고친다.

| 항목 | 권고 | 이유 |
|---|---|---|
| 전체 덤프 | 하루 1회(업무 시간 밖, UTC 기준으로 잡 시간대 18:00~20:00 과 겹치지 않게) | 잡이 큐·알림을 정리하는 시간과 겹치면 덤프가 길어진다 |
| 마이그레이션 적용 직전 | 매번 1회 추가(주기와 별개) | 롤백 SQL 은 구조만 되돌린다 — 이관된 데이터는 덤프로만 돌아간다(`docs/runbook-rollback.md`) |
| 보관 | 일간 14개 · 주간 8개 · 월간 12개 | 사고를 늦게 알아챘을 때 돌아갈 지점 |
| 보관 위치 | DB 와 다른 호스트·다른 저장소에 한 벌 더 | 같은 디스크의 백업은 디스크 장애에 같이 사라진다 |
| 암호화 | 저장 시 암호화(파일 시스템 또는 `age`/`gpg`) | 덤프에 계정·해시가 있다 |

하루 한 번의 덤프는 그 사이(최대 24시간)의 변경을 잃는다. 더 짧은 복구 시점이 필요하면 WAL 보관·PITR 을 호스트(또는 관리형 Supabase 의 기능)로 구성한다 — 이 리포의 범위 밖이다.

## 3. Storage 버킷 백업 (미검증)

DB 덤프의 `storage.objects` 는 **파일 목록**일 뿐이다. 파일 본문이 없으면 복구 뒤 첨부·회의록 원본·로고·양식이 "목록에는 있는데 열리지 않는" 상태가 된다.

- **자체호스트 Supabase(파일 백엔드)**: Storage 가 디스크 디렉터리(또는 연결한 S3 호환 버킷)에 객체를 둔다. 그 디렉터리·버킷을 DB 덤프와 **같은 시각대에** 복사한다(`rsync -a` 또는 저장소의 스냅샷). 경로는 Storage 컨테이너의 볼륨 설정을 따른다 — 호스트마다 다르므로 첫 구성 때 실제 경로를 여기에 적는다.
- **관리형 Supabase**: Storage 는 S3 호환 주소를 제공한다. S3 클라이언트(`rclone`·`aws s3 sync`)로 버킷 다섯을 백업 저장소로 동기화한다. 접근 키는 Storage 설정에서 발급하고 권한 600 인 설정 파일에 둔다.

```bash
# 예시(미검증) — rclone 원격 이름 dflow-storage 는 운영자가 S3 호환 주소·키로 미리 만든다
for b in minutes issue-attachments deliverables form-templates branding; do
  rclone sync "dflow-storage:$b" "/var/backups/dflow-storage/$b" --checksum
done
```

- **순서**: DB 덤프 → Storage 복사. 그 사이에 올라온 파일은 "DB 에 없는 객체"로 남는데, 이것은 해가 없다(청소 잡 `minutes-attachments-gc`·`form-templates-gc` 가 고아 객체를 지운다). 반대 순서면 "DB 에는 있는데 파일이 없는" 행이 생긴다.
- `sync` 는 원본에서 지워진 파일을 백업에서도 지운다. 지운 파일까지 보관하려면 백업 저장소의 버전 관리를 켜거나 날짜별 디렉터리로 `copy` 한다.

## 4. 복구 (미검증)

복구는 **앱을 내린 상태에서** 한다 — 복구 중에 쓰기가 들어오면 그 쓰기는 사라지거나 반쯤 남는다.

1. 앱 프로세스와 잡 타이머를 멈춘다(systemd 면 `systemctl stop` — 유닛 이름은 호스트 구성). 헬스체크(`/api/health`)가 실패하는 것이 정상이다.
2. 복구 대상을 정한다: **빈 DB 에 복구하는 것을 원칙으로 한다**(새 Supabase 프로젝트·새 볼륨). 살아 있는 DB 위에 덮어쓰는 `--clean` 복구는 플랫폼 스키마와 충돌할 수 있다.
3. 덤프 무결성 확인: `sha256sum -c full.dump.sha256`, `pg_restore -l full.dump | head`.
4. 복구:
   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" full.dump     # 연결 값은 §2 와 같은 방식으로
   ```
   관리형 Supabase 처럼 플랫폼 스키마(`auth`·`storage`)가 이미 있는 대상에서는 그 스키마의 객체가 "이미 존재"로 걸린다. 그때는 스키마를 나눠 복구한다
   (`-n public` 먼저, `auth`·`storage` 는 `--data-only`). **어느 조합이 실제로 통하는지는 리허설(§5)에서 정하고 여기에 적는다.**
5. Storage 객체를 §3 의 반대 방향으로 되돌린다.
6. 사후 확인(§6) 뒤 앱과 잡 타이머를 켠다.

로컬 스택의 복구는 `docs/runbook-user-db-apply.md` §5 에 있다(컨테이너를 내리고 볼륨을 새로 만든 뒤 `pg_restore --clean --if-exists --no-owner`).

## 5. 복구 리허설 (미검증 — 첫 원격에서 가장 먼저 할 일)

**복구해 보지 않은 백업은 백업이 아니다.** 덤프가 매일 쌓여도 복구 명령이 실제로 도는지는 해 봐야 안다.

1. 운영과 분리된 빈 대상(스테이징 프로젝트 또는 전용 로컬 스택)을 준비한다. **운영 DB 를 리허설 대상으로 쓰지 않는다.**
2. 가장 최근 덤프를 §4 의 4단계로 복구한다. 걸린 시간·오류·고친 명령을 적는다.
3. 대조: 운영에서 미리 적어 둔 행 수와 복구본의 행 수를 비교한다.
   ```sql
   select 'workspaces', count(*) from public.workspaces union all
   select 'projects', count(*) from public.projects union all
   select 'wbs_items', count(*) from public.wbs_items union all
   select 'issues', count(*) from public.issues union all
   select 'minutes', count(*) from public.minutes union all
   select 'profiles', count(*) from public.profiles union all
   select 'auth.users', count(*) from auth.users union all
   select 'storage.objects', count(*) from storage.objects;
   select max(version) from supabase_migrations.schema_migrations;      -- 복구본의 마이그레이션 번호 = 덤프 시점의 번호
   ```
4. §6 의 사후 확인을 그대로 돈다.
5. Storage: 버킷마다 파일 몇 개를 골라 실제로 열어 본다(회의록 첨부 하나, 로고 하나, 보고서 양식 하나).
6. 리허설 대상을 지운다(계정·해시가 든 사본이다).
7. 결과를 이 문서에 반영한다 — 통한 명령으로 예시를 고치고, 해 본 절의 `(미검증)` 을 뗀다. 주기는 분기 1회를 권고한다.

## 6. 복구 뒤 확인

| 확인 | 방법 | 통과 기준 |
|---|---|---|
| 스키마 버전 | `select max(version) from supabase_migrations.schema_migrations` | 덤프 시점의 번호. 배포할 코드가 전제하는 번호보다 낮으면 **앱을 켜기 전에** 모자란 마이그레이션을 적용한다(`npm run db:apply -- <파일> --target …`) |
| 설정 값 | `npm run settings:verify` | 문제 0 — 저장된 설정이 지금 코드의 레지스트리를 통과한다. **이 명령은 로컬 주소의 DB 에만 붙는다**(하네스가 `127.0.0.1`·`localhost` 만 받는다 — `tests/rls/harness.ts`). 원격 복구본을 직접 검사하는 길은 없다: 같은 덤프를 로컬 전용 스택에 복구해 돌린다(그 스택의 DSN 은 `RLS_DATABASE_URL` 로 준다 — 주지 않으면 `.env.local` 이 가리키는 로컬 메인 스택에 붙으므로 **엉뚱한 DB 의 "문제 0" 을 복구본의 결과로 읽지 않게** 한다) |
| 헬스체크 | `GET /api/health?deep=1`(+ `CRON_SECRET` Bearer) | 200 `{"ok":true,"db":"ok"}` |
| 로그인 | 플랫폼 관리자 계정으로 로그인 → `/admin/workspaces` | 워크스페이스 목록의 수가 §5 의 행 수와 같다 |
| 파일 | 회의록 첨부 하나 열기 | 내려받기가 된다(서명 URL 은 복구 대상의 Storage 를 가리킨다) |
| 잡 | 잡 하나를 수동으로 친다(`docs/runbook-selfhost.md` "잡(스케줄) 실행") | 200 |

복구 대상이 **다른 Supabase 프로젝트**면 좌표가 바뀐다: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` 는 빌드에 박히는 값이라 **다시 빌드**해야 하고, `SUPABASE_SERVICE_ROLE_KEY` 는 런타임 값을 바꾼다.
JWT 서명 키가 달라지므로 기존 로그인 세션은 모두 끊긴다(다시 로그인하면 된다). 응답 보안 헤더의 콘텐츠 보안 정책도 새 주소로 다시 만들어진다(빌드 때 파생).

## 7. 기록

백업·복구·리허설을 한 날짜, 덤프 크기, 걸린 시간, 행 수 대조 결과를 운영 기록에 한 줄 남긴다. 계정·해시·연결 문자열·키는 쓰지 않는다.

## 참고

| 항목 | 문서 · 경로 |
|---|---|
| 마이그레이션 롤백(구조만) | `docs/runbook-rollback.md` |
| 로컬 메인 스택 적용·덤프·되돌림(검증됨) | `docs/runbook-user-db-apply.md` |
| 자체호스트 실행·잡·헬스체크·첫 부트스트랩 | `docs/runbook-selfhost.md` |
| 스테이징 절차 | `docs/runbook-staging.md` |
