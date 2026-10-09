# SP6 결정 — 이슈 분석서의 제품 고정 슬라이드를 넣지 않는다 (2026-10-08)

- **뺀 것**: 정본 설계 §4.9 의 "제품 고정 슬라이드"(프로세스 체계도·정의 장표와 그 8칸 창 분할). 계획·렌더 코드
  (`issues/processPages.ts`·`processSlideRenderer.ts`), 그 좌표에 묶인 옛 렌더러(`jszipRenderer`·`slideXml`·`deckPlan`·`template`,
  주간 `templateFill`), 원본 양식 두 개(`assets/issue-analysis-template.pptx`·`weekly-template.pptx`)를 함께 지웠다.
- **왜**: 그 장표는 특정 컨설팅 방법론 전용이고 원본 리포의 양식 자산(도형 ID·좌표)에서만 그릴 수 있다. 어느 조직·프로젝트에나
  쓰는 플랫폼의 기본 출력에 둘 이유가 없고, 원본 자산에는 지워야 할 샘플 문구가 남아 있었다. 실제 출력 라우트는 이미 양식 엔진과
  중립 기본 양식만 쓰고 있어 옛 경로는 호출되지 않는 코드였다.
- **대신**: 기본 이슈 분석서 양식은 카탈로그(§4.5.2)만으로 표지 → 영역별 종합 → 영역별 이슈 목록 → 원인 분석 → 개선기회를 싣는다.
  조직 고유의 장표는 프로젝트가 양식을 올려(`forms.issue_analysis_pptx`) 해결한다.
- **남긴 것**: 분석 실행의 `processDefinitions`(AI 가 만드는 영역·하위 분류 정의)는 저장 모델·프롬프트에 그대로다 — 출력에서 읽지
  않을 뿐이며, 그 용어 정리는 범용성 작업의 몫이다.
- **되살리려면**: ① 도형 반복을 표현할 방법(§4.9 의 마커 토큰 A안 또는 옵션 B안 — 둘 다 엔진 규약 개정)과 ② 원본에 기대지 않는
  새 장표 자산, ③ 카탈로그에 정의 값(`processDefinitions`) 경로 추가가 필요하다. 지운 코드는 git 이력(`9a1443fa` 까지의 main)에 있다.
- **지키는 장치**: `tests/invariants/report-assets.test.ts`(assets 에는 `default/` 4종뿐·옛 파일 부재),
  `tests/negative/form-engine-outputs.test.ts`(출력에 원본 샘플 문구·방법론 용어 0건).

## 덧붙임 — 원인 분석·개선기회를 영역당 한 장으로 (2026-10-09)

- **바꾼 것**: 기본 양식의 원인 분석(`{{#slide issues}}` — 이슈마다 한 장)과 개선기회(`{{#slide opportunities}}` — 기회마다 한 장)를
  영역마다 한 장으로 묶었다. 원인 분석은 `{{#slide areas}}` + `{{#rows .issues}}` + 셀 안 `{{#items .causes}}`, 개선기회는
  `{{#slide areas}}` + `{{#rows .opportunities}}` + 셀 안 `{{#items .issues}}` 다. 영역에 이슈가 20건이면 20장이던 것이 4장(행 상한 5)이 된다.
- **규약은 그대로다**: 행 셀 안의 `{{#items}}` 는 정본 §4.4.3 이 처음부터 정한 것이고 카탈로그 경로(`areas[].issues[].causes[]`·
  `areas[].opportunities[].issues[]`)도 §4.5.2 에 있었다. 엔진이 그 셀의 줄 수를 재다 멈추던 결함을 고쳤을 뿐이라 `engineVersion` 은
  올리지 않았다(올리면 저장된 스캔 전부가 재등록 대상이 된다).
- **넘침**: §4.4.6 그대로 — 행 수가 `max_rows_per_slide` 를 넘으면 같은 영역의 이어지는 장, 한 이슈의 원인이 `max_lines_per_cell` 을
  넘으면 연속 행(`(계속) i/n`)이다. 셀 안 목록은 문단 경계에서 나눈다(표 밖 `{{#items}}` 의 `paginateLines` 와 같은 규칙).
- **지키는 장치**: `tests/report/engine/pptx-nested.test.ts`(중첩·넘침·거부·단일 반복 양식의 출력 해시 불변),
  `tests/report/forms/issue-analysis-default.test.ts`(영역 수·행 수·잘림 0건).
