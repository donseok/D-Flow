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
- [ ] D: `0031_form_templates.sql` 마이그레이션 + 롤백
  - `form_templates` 테이블 생성 (버전 관리, 활성 유일 인덱스, RLS)
  - `form-templates` Storage 버킷 등록 및 RLS 정책
  - `FORM_MAPPING_IN_USE` 가드: `settings_ref_check` 및 `purge_custom_field`에서 활성 양식이 참조하는 사용자 정의 필드 삭제 차단
  - `copy_project_config`의 `form_templates` 메타 복사 연동
  - 전용 DB(`54522`) 대상 RLS 테스트
- [ ] S: `forms.*` 설정 레지스트리 및 관리 액션
  - [x] S1: `forms.weekly_report_pptx`, `forms.weekly_report_xlsx`, `forms.issue_analysis_pptx`, `forms.wbs_export_xlsx` 설정 정의 및 검증기(형태·카탈로그 경로·options). 편집 화면은 아직 없다
  - [x] S2: 양식 템플릿 업로드 준비(`prepareFormTemplateUpload`), 활성화(`activateFormTemplate`), 활성 해제(`deactivateFormTemplate` — 계획의 삭제. 버전 행을 지우는 액션은 정본에 없다)
  - [x] S2: 액션 관문 및 권한 검증 테스트
  - 활성화의 `engineVersion` 불일치는 재스캔하지 않고 재등록 오류로 막는다(OPC `scan` 미구현).
  - [x] S2 등록: registerFormTemplate — 패키지 검증과 토큰 스캔 후 버전 파일로 이동하고 active=false 및 ScanReport를 저장한다. incoming GC는 후속이다.
- [ ] V: 양식 병합 엔진 및 라우트 연결
  - [x] V1: `capItems`·`lineCost`·`paginateGroups`·`paginateLines` 를 `engine/paginate.ts` 로 이동(정본 §4.3·§4.8). `templateFill.ts` 는 재수출만 한다. 렌더 삭제·라우트 전환은 render 이후
  - [x] V scan: `FormEngine.scan` — pptx 는 `slideN.xml` 의 `<a:p>` 만, xlsx 는 셀 문자열·리치텍스트만(§4.4.1·§4.7.2). 등록은 `ScanReport` 를 저장하고 문법·구조 오류면 incoming 을 지운다. `tokenScan:false` 행은 활성화 거부. 카탈로그 매핑 판정은 활성화에 둔다
  - [x] V render pptx: 값 치환(런 병합·빈 값·개행 문단), `{{#items}}`·`{{#rows}}`·`{{#slide}}`, OPC 배선. §4.4.6 넘침은 아래 별도 항목에서 구현했다
  - [x] V render xlsx: 셀 값 치환, `{{#items}}` 는 셀 안 개행, `{{#rows}}` 는 duplicateRow. 0건이면 그 행을 지운다
  - [x] pptx 넘침 연속 슬라이드 (§4.4.6 `max_lines_per_cell`·`max_rows_per_slide`). 값 토큰 단독은 나누지 않는다
  - [ ] 활성화의 `engineVersion` 불일치 재스캔(§4.7.3) — 지금은 재등록 오류다
  - [x] `/api/report` 라우트 연동 (활성 템플릿 우선, 미등록 시 기본 템플릿 폴백)와 그 응답의 `X-Form-Template: default | custom`
  - [x] `/api/export` 프로파일 경로는 유지. `GET /api/export?form=1` 은 `wbs_export_xlsx` 와 `X-Form-Template: default | custom`. 가드는 `requireProjectMember` (wbs 는 core)
  - [x] `/api/issue-analysis` 같은 전환과 그 응답의 `X-Form-Template: default | custom`. 고정 슬라이드 삽입(§4.9 A/B)은 스파이크라 이 전환에 넣지 않는다
  - [x] `assets/default` 기본 4종: 무매핑 카탈로그 토큰, OPC 참조, scan error 0·warning 0, 0·1·8·17건 실제 엔진 출력 검증. 생성기 및 다운로드 라우트 파일 추적 포함
  - [ ] `assets/fixed/issue-analysis-process.pptx`, 기존 SP0 자산 제거 및 전체 Office/장문 출력 검증
- [ ] Z: 합성 게이트 S8, 부정 테스트 6, 카탈로그 verified 승격 및 마감
  - 부정 테스트 6 (제조/영업 예시 단어 미노출 검증)
  - `scripts/e2e-synthetic.mjs`에 `S8` 합성 단계 구현 및 `PENDING_STEPS`에서 `S8` 제거
  - `src/lib/settings/catalog-meta.ts`의 `forms.*` 키를 `verified`로 승격
  - 전체 단위, RLS, 타입 검사, 린트, 프로덕션 빌드 통과 후 최종 마감

각 단계가 완료될 때마다 명시적으로 파일들을 스테이징하고 설명적인 한국어 커밋 메시지로 커밋한 뒤 원격에 즉시 푸시한다.
테스트 DB는 A 전용 API 54521 / DB 54522 (`d-flow-sp4`)만 사용하며, 사용자 운영 DB(54321/54322)는 일체 건드리지 않는다.


## 인계 이후 검증 (2026-10-05)

최신 원격 ef27f273까지 fast-forward했다. SP6 push가 CI 필터에서 빠진 것을 확인해 sp6/**를 추가한다. 기준선 DB 전체 검사 878건 중 12건 실패를 확인했고, 0033_form_template_guards 및 별도 롤백으로 테이블 권한·필드 타입/범위 보호·엔티티별 활성 양식 참조·양식 Storage 경로를 보강했다. 격리 픽스처/등록 및 역사적 스키마 경계 리허설을 복구해 DB 전체 48파일 881/881 통과. 카탈로그 project.level_labels는 저장소 열이 아니라 공개 양식 데이터 계약이므로 닫힌 코드 형태만 기존 열 접근 검사에서 제외하고, 실제 옛 열 읽기는 계속 차단한다.

D는 실파일 복사가 남아 전체 완료로 표시하지 않는다. 정본 §4.6.3의 Storage.copy→copy_project_config 및 실패 보상 순서가 createProject에 아직 없다. 기본 출력 라우트가 요구하는 assets/default 4종도 없으므로 자산 작성과 실제 출력 검증을 다음 우선 작업으로 둔다. UI·재스캔·S8 등 전체 잔여 물량은 docs/baseline/sp6-handoff-review.md에 정리했다.

최종 앱 검증: 단위 전체 946파일 12,489/12,489, 전체 typecheck와 production build 통과. lint 오류 0, 기존 경고 4건. SQL 마이그레이션과 검증/CI 변경은 분리 커밋한다. 사용자 DB 및 main 미통합, forms 카탈로그 stored 유지.
