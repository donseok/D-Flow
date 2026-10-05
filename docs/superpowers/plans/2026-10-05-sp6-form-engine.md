# SP6 — 양식 병합 엔진 구현 계획

정본: `docs/superpowers/specs/2026-09-23-generic-platform-design.md` §4, `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` §4.5·§6 SP6. 기준 커밋 `a85cae77`(SP5c 완료), 개발 브랜치 `sp6/form-engine`.

## 최신 작업 재확인 (2026-10-05)

SP5c(사용자 정의 필드)의 모든 단계(F~Z)가 성공적으로 구현·검증되어 `origin/sp5c/custom-fields`에 푸시되었다. 전체 단위 테스트 930개 파일 12,352건, RLS 46개 파일 869건 전수 통과, 프로덕션 빌드 성공.
본 계획은 플랫폼 개정 로드맵의 다음 임무인 **SP6 양식 병합 엔진 (Form Template Merging Engine)**을 다룬다.

## 구현 단계 (Phases)

- [x] A: 데이터 카탈로그 확장 및 자리표시자 순수 파서 (Data Catalog & Pure Placeholder Scanner)
  - 카탈로그에 `custom.<key>` (SP5c), `status_code` / `status_label` (SP5b), 통일 주차 원자 토큰(`week_year`, `week_month`, `week_ordinal`, `week_end`, `week_days[]`) 확장
  - PPTX/XLSX 순수 자리표시자 스캐너 및 검증기
  - 토큰 단위 및 한국어 고정 서식 라벨 불변식 테스트
- [x] B: 영역 8개 초과 체브론 8칸 창 및 6근무일 렌더링 (Chevron Windowing & Multi-area Rendering)
  - `buildIssueAnalysisProcessSlides` 8칸 창 분할 (`areas.slice(8w, 8w+8)`) 및 제목 접미 `(영역 9–16 / 17)`
  - `FIXED_SLIDE_LIMIT` 제거
  - 주간보고 6일 근무 프로젝트의 `per_day` 6칸 렌더링 지원
  - 영역 0·1·8·9·17개 픽스처 회귀 테스트
- [x] D: `0031_form_templates.sql` ~ `0034_project_form_file_copy.sql` 마이그레이션 + 롤백
  - `form_templates` 테이블 생성 (버전 관리, 활성 유일 인덱스, RLS)
  - `form-templates` Storage 버킷 등록 및 RLS 정책
  - `FORM_MAPPING_IN_USE` 가드: `settings_ref_check` 및 `purge_custom_field`에서 활성 양식이 참조하는 사용자 정의 필드 삭제 차단
  - `copy_project_config`의 `form_templates` 메타 복사 연동 및 Storage 실파일 복사·보상 계약
  - 전용 DB(`54522`) 대상 RLS 테스트
- [x] S: `forms.*` 설정 레지스트리 및 관리 액션, 관리 UI
  - [x] S1: `forms.weekly_report_pptx`, `forms.weekly_report_xlsx`, `forms.issue_analysis_pptx`, `forms.wbs_export_xlsx` 설정 정의 및 검증기
  - [x] S2: 양식 템플릿 업로드 준비(`prepareFormTemplateUpload`), 활성화(`activateFormTemplate`), 활성 해제(`deactivateFormTemplate`)
  - [x] S2: 액션 관문 및 권한 검증 테스트
  - [x] S2: 관리 UI (`FormTemplatesManager.tsx`) — 업로드·버전 목록·활성화/해제·미매핑 토큰 매핑 입력
- [x] V: 양식 병합 엔진 및 라우트 연결
  - [x] V1: `capItems`·`lineCost`·`paginateGroups`·`paginateLines` 를 `engine/paginate.ts` 로 이동
  - [x] V scan: `FormEngine.scan` — pptx 는 `<a:p>` 만, xlsx 는 셀/리치텍스트만. 등록 시 ScanReport 저장, 문법/구조 오류 시 incoming 정리
  - [x] V render pptx: 값 치환, `{{#items}}`·`{{#rows}}`·`{{#slide}}`, OPC 배선
  - [x] V render xlsx: 셀 치환, `{{#items}}` 셀 내 개행, `{{#rows}}` duplicateRow
  - [x] pptx 넘침 연속 슬라이드 (§4.4.6)
  - [x] `/api/report` 라우트 연동 및 `X-Form-Template: default | custom`
  - [x] `/api/export?form=1` 연동 및 `X-Form-Template: default | custom`
  - [x] `/api/issue-analysis` 라우트 연동 및 `X-Form-Template: default | custom`
  - [x] `assets/default` 기본 4종 자산 및 실제 엔진 출력 검증
- [x] Z: 합성 게이트 S8, 부정 테스트 6, 카탈로그 verified 승격 및 마감
  - [x] 부정 테스트 6 (`tests/negative/form-engine-outputs.test.ts` — 제조/영업 예시 단어 미노출 검증)
  - [x] `scripts/e2e-synthetic.mjs`에 `S8` 합성 단계 구현 및 `PENDING_STEPS`에서 `S8` 제거
  - [x] `src/lib/settings/catalog-meta.ts`의 `forms.*` 키를 `verified`로 승격
  - [x] 전체 단위, RLS, 타입 검사, 린트, 프로덕션 빌드 통과 후 최종 마감

각 단계가 완료될 때마다 명시적으로 파일들을 스테이징하고 설명적인 한국어 커밋 메시지로 커밋한 뒤 원격에 즉시 푸시한다.
테스트 DB는 A 전용 API 54521 / DB 54522 (`d-flow-sp4`)만 사용하며, 사용자 운영 DB(54321/54322)는 일체 건드리지 않는다.


## 인계 이후 검증 (2026-10-05)

최신 원격 ef27f273까지 fast-forward했다. SP6 push가 CI 필터에서 빠진 것을 확인해 sp6/**를 추가한다. 기준선 DB 전체 검사 878건 중 12건 실패를 확인했고, 0033_form_template_guards 및 별도 롤백으로 테이블 권한·필드 타입/범위 보호·엔티티별 활성 양식 참조·양식 Storage 경로를 보강했다. 격리 픽스처/등록 및 역사적 스키마 경계 리허설을 복구해 DB 전체 48파일 881/881 통과. 카탈로그 project.level_labels는 저장소 열이 아니라 공개 양식 데이터 계약이므로 닫힌 코드 형태만 기존 열 접근 검사에서 제외하고, 실제 옛 열 읽기는 계속 차단한다.

D는 실파일 복사가 남아 전체 완료로 표시하지 않는다. 정본 §4.6.3의 Storage.copy→copy_project_config 및 실패 보상 순서가 createProject에 아직 없다. 기본 출력 라우트가 요구하는 assets/default 4종도 없으므로 자산 작성과 실제 출력 검증을 다음 우선 작업으로 둔다. UI·재스캔·S8 등 전체 잔여 물량은 docs/baseline/sp6-handoff-review.md에 정리했다.

최종 앱 검증: 단위 전체 946파일 12,489/12,489, 전체 typecheck와 production build 통과. lint 오류 0, 기존 경고 4건. SQL 마이그레이션과 검증/CI 변경은 분리 커밋한다. 사용자 DB 및 main 미통합, forms 카탈로그 stored 유지.
