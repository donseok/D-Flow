# SP7 워크스페이스 한정 에이전트 연결

2026-10-05 · `sp7/api-integration`

## 구현

- `0035_integration_credentials`는 서비스 전용/RLS 정책 0개 저장소를 만들고, 기존 PAT의 해시·메타데이터를 보존해 복사한다. 프로젝트 한정 PAT는 프로젝트의 WS, 무제한 PAT는 실제 소속이 정확히 하나인 WS에만 이관한다. 활성 토큰의 범위가 불명확하면 마이그레이션 전체를 거절한다.
- 기존 `agent_runners`, `agent_projects`는 원본을 보존한다. 새 저장소에 있는 prefix는 인증의 권위 있는 원천이다. 새 행의 회수/손상/조회 실패를 기존 저장소 인증으로 우회하지 않는다.
- 새 PAT는 현재 소유자 권한과 토큰의 WS/프로젝트 범위를 교차 판정한다. 플랫폼 관리자 권한은 토큰에 승계하지 않는다. 에이전트·WBS 라우트와 mine/me/watch를 이 판정에 연결했다. 새 토큰은 agents 모듈로 활성 여부를 판단하며 옛 등록 표를 요구하지 않는다.
- 계정 화면에서 실제 소속 WS 및 전체/선택 프로젝트를 고를 수 있다. 발급은 WS 소속·agents 관문 뒤에만 실행한다. 신규 저장소에 해시만 저장하고 평문은 발급 응답에서 한 번 표시한다. 목록/회수는 자기 소유의 agent_runner만 접근한다. 소속을 잃은 뒤에도 회수만 가능한 DB 트리거 예외를 둔다.
- 감시자 유니크 키는 `(workspace_id,user_id,agent)`이다. 새 토큰의 stop/정리/재개 조회와 응답도 범위로 제한한다.
- 롤백은 무변경 이관만 허용한다. 신규 발급, 삭제, 회수, 사용시각, 범위/메타 변경 및 다중 WS 감시자 행이 있으면 데이터 손실이나 옛 토큰 부활 대신 명시적으로 거절한다.
- 통합 자격증명의 WS 공용 팀 참조는 프로젝트 상속 팀 전환 대상이 아니다. 여러 프로젝트가 사용하는 외부 별칭을 한 프로젝트의 전용 팀으로 바꾸지 않는다.
- 회의록 v3 API(`POST /api/v1/minutes`, `meta`, `link`, `folder`)에 `integration_credentials`(`minutes_api`) 연동을 완료했다. 워크스페이스 한정, `minutes_integration` 모듈 게이트, 자격증명 허용 프로젝트 범위 검증, 팀 매핑 해석을 지원하며 비허용 프로젝트는 403 `project_not_allowed`, 타 워크스페이스는 404로 보호한다.
- 워크스페이스 관리자 전용 연동 자격증명 관리 화면(`/w/[slug]/settings/integrations`)과 Server Actions(`createMinutesApiCredential`, `revokeIntegrationCredential`, `listWorkspaceCredentials`)를 구현했다. 토큰 1회 노출, prefix/상태 배지, 회수 모달, 프로젝트/팀 매핑 관리를 지원한다.
- 에이전트 WBS 가져오기(`POST /api/v1/wbs/import`)에 `command_receipts` 기반 명령 멱등성을 적용했다. `command_id` 지정 시 payload digest를 검증하여 중복 요청에 대해 WBS 재수행 없이 기수행 결과를 즉시 반환(status: 'duplicate')하고, 다른 내용으로 재사용 시 409 `command_reused`로 차단한다.

## 남은 SP7 범위

회의록 v3 API, 관리자 통합 자격증명 관리, 에이전트 WBS 명령 멱등성 구현이 완료되었다. 남은 것은 외부 연동 시스템(또박또박 v3) 배포 이후 과도기 레거시 전역 비밀키/등록 표 호환 경로의 단계적 폐기다.

## 배포 순서와 검증 환경

새 스키마를 먼저 적용한 뒤 코드 배포가 필요하다. 활성 무제한 PAT 소유자의 소속이 0개 또는 여러 개면 운영자가 기존 관리 흐름으로 회수/회전하고 명시적 WS로 재발급해야 한다. 기존 애플리케이션 DB/환경 파일은 변경하지 않았다.

로컬 검증은 `.superpowers/sp7/db-core`의 독립 Supabase 프로젝트 `d-flow-sp7-core`에서만 수행했다(API 54721, DB 54722). 마이그레이션 왕복은 테스트 연결의 트랜잭션 롤백으로 격리했다. 일반 RLS 테스트와 DDL 왕복 테스트를 별도 프로세스로 동시에 실행하면 잠금 교착이 생길 수 있으므로 하나의 직렬 RLS 실행으로 검증한다.
