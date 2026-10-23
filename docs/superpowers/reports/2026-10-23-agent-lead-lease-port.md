# 팀장 lease 계약 2.5 이식 검증 — 2026-10-23

구현 계획: `docs/superpowers/plans/2026-10-23-agent-lead-lease-port.md`의 1단계.
원본 wbs-web의 `bfea5805` 파서·파서 시험과 `f27859b5`·`762457c7` watch 변경을 파일 단위로 이식했다.
원본 git 이력이나 DB는 가져오지 않았다. 마이그레이션은 추가하지 않는다.

## 구현

- `POST /api/v1/agent/lead/lease`: acquire·renew·release. PAT `work:claim`, 자격증명 범위, 소유자의 워크스페이스로 좁힌 멤버십, agents 모듈을 판정한다.
- acquire의 범위 밖·비멤버·모듈 꺼짐은 404. renew는 멤버십·모듈에서 빠진 프로젝트를 RPC에 넘기지 않고 lost로 돌려준다.
- release는 자기 신원·holder·generation의 정리라 멤버십·모듈 관문 전에 처리한다.
- watch의 선택 holder는 유효 lease 프로젝트로 주문 조회를 먼저 좁히고 결과에도 같은 집합을 적용한다. lease 없음은 주문 조회 없이 빈 배열, 조회 오류는 null과 사유·로그다.
- 계약 버전·문서·경로 목록·관문 매니페스트·admin 클라이언트 감사표를 갱신했다.
- `dflow-key-select.test.ts`의 문서 제목 단언만 v2.5로 갱신했다. 가짜 서버의 `contract_version: 2.4` 응답은 유지한다.

## 검증

2026-10-23 로컬 검증 완료.

| 검사 | 결과 |
|---|---|
| `npm run test -- --maxWorkers=4` | 1,176개 파일 · 16,154건 전수 통과 |
| `npm run lint` | 오류 0건 · 기존 경고 15건 |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck` | 통과. 기본 Node 힙 약 2GB로 실행한 첫 시도는 메모리 부족으로 종료되어 한도를 늘렸다 |
| `npm run build` | 통과. Supabase 좌표는 `http://127.0.0.1:55821`, 키는 CI와 같은 더미 값으로 셸에서 지정 |
| 별도 Supabase `db reset --local` | 기준선부터 `0061_minute_wbs_links`까지 적용·시드·컨테이너 재시작 통과 |
| 실제 HTTP + 로컬 DB | `next start`에서 아래 12건 통과 |
| `git diff --check` | 통과 |

기존 메인 DB를 초기화하지 않도록 `/tmp/dflow-lease-verify-9fRMCg`에 `supabase/config.toml`·마이그레이션·시드만 복사했다.
프로젝트 ID는 `d-flow-lease-verify`, API/DB 포트는 `55821`/`55822`다. `.env.local`은 변경하지 않았다.
실제 HTTP 검증에서는 이 스택의 service_role과 익명 키를 자식 서버의 환경변수로만 전달했다.
새 임시 사용자·워크스페이스·프로젝트·PAT를 별도 DB에 만들었고, PAT 평문과 비밀번호는 파일이나 로그에 남기지 않았다.
설정 변경도 `apply_workspace_settings`·`create_project_with_settings`·`apply_project_settings` RPC를 사용했다.

HTTP 확인 항목:

1. 정상 acquire 본문 + Authorization 없음 → 401.
2. acquire → 200, generation 1, 미래 만료 시각.
3. renew + 알 수 없는 `heavy` 필드 → 200, `lost: []`.
4. 다른 holder의 acquire → 409 `lead_lease_held`.
5. holder가 있는 watch → 200, lease 조회 오류 없이 재개 목록 반환.
6. takeover → 200, generation 증가.
7. 이전 holder·generation의 renew → `lost`.
8. 이전 holder·generation의 release → `released: 0`, 새 소유자의 lease 유지.
9. agents 모듈을 끈 뒤 acquire → 404.
10. agents 모듈을 끈 뒤 renew → `lost`.
11. agents 모듈을 끈 뒤 현재 소유자의 release → 200, `released: 1`.
12. `/me` → `contract_version: "2.5"`.

로컬 카탈로그에서 `lead_lease_acquire`·`lead_lease_renew`·`lead_lease_release`·`lead_lease_force_release`는
service_role 실행 허용, authenticated·anon 실행 거부임을 확인했다. TTL 조회 함수는 authenticated도 실행할 수 있으나 쓰기는 하지 않는다.
스모크 스크립트는 위 임시 디렉터리의 `http-smoke.mjs`, 결과 로그는 `/tmp/dflow-lease-http-smoke.log`에 있다.
전체 RLS 시험은 이번에 별도로 실행하지 않았다. 새 DB 스키마 변경 없이 실제 라우트에서 기존 함수를 호출하는 경로를 검증했다.
검증 서버와 별도 Supabase 스택은 종료했다. 검증을 위해 켰던 colima도 원래의 정지 상태로 돌렸다.

## 배포 전 확인

Supabase Management API로 D-Flow 운영(`dflow-prod`, `aivjcfoeshnhqdrfteyq`)에 읽기 전용 쿼리만 실행했다.
`lead_lease_acquire`, `lead_lease_force_release`, `lead_lease_release`, `lead_lease_renew`, `lead_lease_ttl`의 5행을 확인했고,
`agent_lead_leases`의 count 조회도 성공했다(0행). 운영 DB 쓰기는 실행하지 않았다.

계획 §3-10의 본문 없는 POST 예시는 JSON 파싱이 먼저라 400이므로, 정상 acquire 본문을 보내고 Authorization만 생략하는 명령으로 고쳤다.

push는 운영 배포이므로 사람 확인 후 진행한다. 배포 뒤 CI·운영 smoke와 oranda의 실제 dmes 클라이언트 확인은 남아 있다.
계약 2.6~2.11·콘솔은 이 계획의 후속 별도 범위다.
