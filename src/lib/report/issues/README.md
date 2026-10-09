# 이슈 분석서 — 보고서 모델과 출력

이 디렉터리는 이슈 분석서의 **데이터 쪽**만 가진다. PPT 를 그리는 코드는 여기 없다 — 출력은 양식 병합 엔진
(`src/lib/report/engine`)이 양식 파일의 자리표시자를 카탈로그 값으로 채워 만든다(정본 §4).

| 파일 | 역할 |
|---|---|
| `model.ts` | 직렬화 가능한 보고서 모델(`IssueAnalysisReport`) — 사전 점검, 입력 스냅샷, 영역별 요약·원인 분석·개선기회 결합, 계약 상한 |
| `storedRun.ts` | `issue_analysis_runs.analysis_json` 을 다운로드 시 다시 검증해 읽는다(스키마 버전·프로젝트·영역 순서·이슈 코드·원인/개선기회의 이슈 UUID 연결) |
| `textRows.ts` | 표 행 셀의 긴 텍스트를 줄 예산에 맞춰 손실 없이 나눈다 — 엔진의 `{{#rows}}` 셀 넘침이 쓴다(§4.4.6) |
| `export.ts` | 다운로드 파일명(프로젝트 시간대의 생성 날짜)과 MIME |

## 흐름

1. 화면(`IssueAnalysisModal`) → 서버 액션 `ensureIssueAnalysisAction` 이 원본을 서버에서 다시 읽어 사전 점검하고,
   AI 가 이슈별 직접·근본 원인과 영역별 개선기회를 만든다(`src/lib/ai/issue-analysis.ts`). 결과는 `issue_analysis_runs` 에 저장된다.
   브라우저가 보낸 분석 본문은 출력 입력으로 쓰지 않는다.
2. `/api/issue-analysis?projectId&runId` 가 저장 실행을 `storedRun.ts` 로 읽고, 카탈로그
   (`src/lib/report/catalog/issueAnalysisBuild.ts` — 경로는 정본 §4.5.2)로 바꿔 엔진에 넘긴다.
3. 양식은 프로젝트 설정 `forms.issue_analysis_pptx` 가 고른다 — 프로젝트가 올린 활성 양식, 없으면 제품 기본 양식
   `src/lib/report/assets/default/issue_analysis_pptx.pptx`.

다운로드 버튼은 ① 이슈 분석 모듈이 켜져 있고 ② 저장된 실행(runId)이 있고 ③ 양식 설정이 읽힐 때 열린다
(`src/lib/report/forms/issueAnalysisExport.ts`). 설정을 못 읽으면 닫는다.

## 제품 기본 양식

`scripts/forms/build-defaults.mjs` 가 다른 Office 파일을 읽지 않고 만든다(테마·슬라이드 크기도 스크립트 안). 구성은 다섯 장이다.

| 장 | 반복 | 싣는 것 |
|---|---|---|
| 표지 | — | 프로젝트·일자·영역 수·이슈 수·작성자 |
| 영역별 종합 | `{{#rows areas}}` | 영역마다 전체·상태 범주별 건수, 주관 부서, 관련 시스템 |
| 영역별 이슈 목록 | `{{#slide areas}}` + `{{#rows .issues}}` | 그 영역의 심각도별 건수와 이슈(코드·제목·본문·심각도·상태·주관 부서) |
| 영역별 원인 분석 | `{{#slide areas}}` + `{{#rows .issues}}` + 셀 안 `{{#items .causes}}` | 그 영역의 이슈가 행, 이슈의 원인(분류·직접 원인 / 근본 원인)이 그 행의 문단 |
| 영역별 개선기회 | `{{#slide areas}}` + `{{#rows .opportunities}}` + 셀 안 `{{#items .issues}}` | 그 영역의 개선기회가 행(번호·제목·개선 방향), 연결 이슈가 그 행의 문단 |

- 뒤 세 장은 영역마다 한 장이다. 행이 `max_rows_per_slide` 를 넘으면 같은 영역의 이어지는 장으로 넘어간다(제목에 `continuation_label`).
- 긴 본문·원인은 `{{#rows}}` 행에 두어 엔진이 연속 행·연속 장으로 나눈다(원문을 줄이지 않는다). 셀 안 목록(`{{#items}}`)은 문단 경계에서
  나뉜다 — 원인 하나가 두 행에 찢기지 않는다. 행 수·셀 줄 수는 양식 설정의 옵션이다.
- 원인이 0건인 이슈는 행은 남고 원인 칸이 빈다. 개선기회가 0건인 영역은 표에 머리 행만 남는다(저장 실행은 이슈가 있는 영역마다
  개선기회를 하나 이상 요구하므로 화면 경로에서는 생기지 않는다).
- 조직 고유의 장표(방법론 전용 도식 등)는 제품에 넣지 않는다. 양식을 올려 해결한다 — 결정 기록은
  `docs/baseline/sp6-issue-analysis-decision.md`.
- 양식을 고치면 스크립트를 다시 돌리고 `tests/report/forms/issue-analysis-default.test.ts` 를 맞춘다.
