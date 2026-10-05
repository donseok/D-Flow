# SPU3 계획 — 대량 변경·간트·모바일 (UI 트랙 3)

> **위상**: 실행 계획  
> **스펙 정본**: `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` §5.9.2, §5.9.3, §6.2 SPU3, UX-08, D6-§8-bulk, D6-§8-gantt, D6-§8-docs, D6-§9-mobile-a11y  
> **관련 품질 기준**: Q06(대량 변경), Q08(일정·간트), Q11(문서·첨부), Q12(모바일·접근성)  
> **브랜치**: `spu3/bulk-gantt`  
> **마이그레이션**: `0037_wbs_bulk_cas.sql` (기존 테이블에 항목별 CAS·이력 원자 저장 RPC 추가, 롤백 포함)

---

## 1. 배경 및 목표

1. **WBS 대량 변경 & 붙여넣기 (`UX-08`, `D6-§8-bulk`, `Q06`)**:
   - '선택한 N개' vs '현재 결과 전체 M개' 명시적 범위 선택.
   - 전체 선택 시 서버 대상 snapshot (`item_ids` 스냅샷)으로 중간 혼입 방어.
   - 필드 값 "혼합(Mixed)" 표시: 선택 항목들의 값이 다를 때 `(혼합)` 안내 및 `[변경 안 함 | 새 값 지정 | 값 지우기]` 3단 선택지 제공.
   - 대량 변경 결과 패널: 항목별 성공, 충돌, 권한 없음, 검증 실패 명시 및 **"실패한 건만 재시도(Retry failed only)"** 액션.
   - 숨긴 열이나 필터 제외 행에는 붙여넣기/변경 미적용.

2. **간트 차트 개선 (`D6-§8-gantt`, `Q08`)**:
   - 작업명 열 고정(sticky/pinned) + 시간축 수평 스크롤.
   - 의존선 렌더링 확장: 기존 hover뿐만 아니라 **선택 작업 기준**(`activeDepItemId = hoveredDepItemId || selectedItemId`)으로도 연결선 렌더링.
   - 바 드래그 시 원래 일정 점선(`stroke-dasharray="4 2"` / `border-dashed`) 및 예정 일정 실선 미리보기 제공.
   - 드래그 완료 시 선후행 영향 검토 다이얼로그(`GanttImpactConfirmDialog`): 전파 정책 없이 후속 자동 이동을 하지 않고, 사용자 검토 후 명시적 커밋.
   - 날짜 인라인/인스펙터 폼 등 드래그 없는 대체 경로 보장.

3. **문서 버전·최신 여부 & 산출물 첨부 상태 (`D6-§8-docs`, `Q11`, P7-2-DL)**:
   - 위키 및 회의록: 열람 버전, 최신 여부("이전 버전 열람 중" 칩 및 "최신으로 이동"), 초안/게시 구분 뱃지 표시.
   - 산출물 첨부 정직화: `listAttachments` 결과 `{ ok, rows, download }` 반영 및 권한 부재 시 `href="#"` 대신 비활성화+안내 툴팁.

4. **모바일 390px 완수·200% 확대 대응 및 높이 하한 방어 (`D6-§9-mobile-a11y`, `Q12`, SP4/SP5 이월)**:
   - 390px 뷰포트에서 오늘 업무 확인, 상세 읽기, 상태 변경, 승인/검토 완수 가능 보장.
   - 채움형 화면(WBS/주간 시트) 세로 극단 축소(1280x720의 400% 확대 ≈ 320x180 등) 시 시트 박스 0px 축소 방어(`min-h-[240px]` 등 높이 하한선 보장).
   - `StatusMessage` compact + blocking 오류 시 테두리/바탕 시각적 식별 보강.

---

## 2. 세부 과제 (Tasks)

### 과제 1: WBS 대량 변경 Server Action 및 데이터 모델 (`UX-08`, `D6-§8-bulk`, `Q06`)
- [ ] `src/app/actions/wbsBulk.ts`:
  - `bulkUpdateWbsItems(projectId: string, itemIds: string[], changes: WbsBulkChanges)`
  - 지원 필드: `plannedStart`, `plannedEnd`, `deliverable`, `biz`, `stage`, `assigneeMemberId` (프로젝트 로스터 ID), `teamCode`.
  - 3단 변경 정책: `unchanged`(변경 안 함) | `set`(값 지정) | `clear`(값 비우기).
  - 항목별 결과 반환: `{ total, succeeded: string[], failed: Array<{ itemId, name?, reason, message }> }`.
  - 실패 사유 분류: `permission`(권한 없음), `validation`(시작일>종료일 등), `conflict`(충돌/상태 잠금), `unknown`.
- [ ] `tests/actions/wbs-bulk.test.ts`: 배치 업데이트 성공, 부분 실패, 권한 검증 단위 테스트.

### 과제 2: WBS 대량 변경 다이얼로그 & 결과 패널 UI (`UX-08`, `D6-§8-bulk`)
- [ ] `src/components/wbs/WbsBulkEditDialog.tsx`:
  - '선택한 N개' vs '현재 결과 전체 M개' 라디오/칩 선택.
  - 필드별 "혼합" 상태 감지 및 변경 모드 선택기.
  - 작업 진행 중 프로그레스 및 실행 후 결과 패널 (성공 건수, 실패 항목 및 실패 사유).
  - "실패한 N건만 다시 시도" 버튼.
- [ ] `src/components/wbs/WbsBulkBar.tsx`:
  - 그리드에서 다중 행 선택 시 하단에 플로팅되는 대량 작업 바 ("N개 선택됨", "대량 수정", "선택 해제").
- [ ] `tests/ui/wbs-bulk-edit.test.tsx`: 혼합 필드 표시, 결과 패널, 재시도 인터랙션 테스트.

### 과제 3: 간트 차트 개선 (`D6-§8-gantt`, `Q08`)
- [ ] `src/components/wbs/WbsGanttSheet.tsx`:
  - 의존선 표시 기준을 hover에서 `hoveredDepItemId || selectedItemId`로 확장.
  - 드래그 중 원래 일정 점선(Dashed) 및 예정 일정 실선(Solid) 미리보기.
- [ ] `src/components/wbs/GanttImpactConfirmDialog.tsx`:
  - 일정 드래그 드롭 시 선후행 의존 작업과의 영향(선행 완료일 이후 시작 여부 등) 검토 모달.
  - 자동 후속 이동 없이 명시적 확인 후 적용.
- [ ] `tests/ui/wbs-gantt-interactions.test.tsx`: 의존선 선택 렌더링 및 드래그 영향 검토 테스트.

### 과제 4: 문서 버전·최신 여부 & 산출물 첨부 상태 (`D6-§8-docs`, `Q11`, P7-2-DL)
- [ ] `src/components/doc/DocumentVersionStatus.tsx` + `WikiTopicDetail`/`WikiDocumentEditor`/`MinuteViewer`:
  - 열람 버전 뱃지, 최신 버전 여부 판별 ("최신 버전이 아닙니다. 최신본 보기" 링크).
  - 편집 중 초안(draft) / 저장된 문서(saved) 구분 칩. 기존 DB에는 게시 상태가 없으므로 published를 추정하지 않는다.
- [ ] 기존 `src/components/wbs/RowDetailPanel.tsx` 첨부 영역:
  - 산출물 첨부 상태 표시 및 `can_attach` / download 가능 여부에 따른 정직한 링크/비활성화 처리.
- [ ] `tests/ui/document-version-status.test.tsx`: 문서 버전 안내 및 첨부 상태 UI 테스트.

### 과제 5: 모바일 390px 완수·200% 확대 대응 및 높이 하한 방어 (`D6-§9-mobile-a11y`, `Q12`, SP4/SP5 이월)
- [ ] `src/app/(app)/p/[projectId]/wbs/page.tsx` 및 `src/components/wbs/WbsGanttSheet.tsx`:
  - 390px 모바일 화면에서 핵심 조작(작업 목록 확인, 상태/진척도 변경, 인스펙터 상세) 보장.
  - 채움형 WBS/주간 시트에 `min-h-[300px]` 하한선 적용하여 극단 축소/확대 시 시트 상자가 0px이 되지 않도록 방어.
- [ ] `src/components/ui/StatusMessage.tsx`:
  - compact + blocking 에러 시 명확한 테두리(`border-red-300 dark:border-red-800`) 및 바탕색 부여.
- [ ] `tests/ui/mobile-a11y-layout.test.tsx`: 모바일 뷰포트 및 높이 하한 방어 테스트.

## 3. 인계 후 구현 결정 (2026-10-05)

- 새 테이블은 만들지 않지만 화면이 검토한 revision에서 팀·필드·이력을 함께 저장하려면 DB RPC가 필요해 0037을 추가했다.
- 일괄 수정은 관리자 전용이다. 단계·담당자는 기존 승인/배정 경로를 유지하고 각각 다른 필드와 분리해서 적용한다.
- 붙여넣기는 선택된 표시 행과 표시된 편집 열에 한정한 검토 모달로 제공한다. Excel 인용 TSV, 행별 값, 빈 셀 지우기, 200행 상한, revision 충돌 및 실패한 행만 재검토를 지원한다.
- 문서 버전은 실제 조회한 번호만 표시한다. 번호를 모르면 버전 정보 없음, 편집 중이면 초안, 저장된 위키/회의록이면 저장된 문서로 표시한다. 별도 게시 상태 모델 도입은 이 작업에 포함하지 않는다.
- 첨부는 기존 권한 구분 구현을 유지한다. 내려받기 denied/unknown에 가짜 링크를 만들지 않는다.
- 극단적인 짧은 화면은 바깥 문서 스크롤로 전환해 채움 시트 최소 300px을 보존한다.
- 간트 바를 놓은 뒤의 저장은 기존 단일 필드 갱신이 아니라 `bulkUpdateWbsItems`에 드래그 시작 시각을 넘긴다. 검토 중에 바뀐 행은 덮지 않고, 후속 작업은 자동으로 밀지 않는다.
