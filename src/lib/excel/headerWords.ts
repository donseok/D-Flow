// 엑셀 머리 낱말의 단일 출처(SP4 D38·E30) — 두 빌더가 쓰는 머리 낱말, 감지기의 논리 별칭·담당 별칭. 팀 예약어는 여기서 파생한다
// (src/lib/domain/teams.ts 의 reservedTeamNames — 프로젝트 단계 이름·추가 축 이름을 더한다). 옛 단계 이름(Phase·Task·Activity)은
// 여기 두지 않는다 — 프로젝트 설정(core.level_labels)에서 온다. 낱말 비교는 감지기와 같게 대소문자·전각·앞뒤 공백을 무시한다.
import type { ExcelProfile } from '@/lib/excel/profile'

/** 빌더(내보내기)가 쓰는 머리 낱말 */
export const HEADER = Object.freeze({
  owner: '담당', deliverable: '산출물', plan: '계획', start: '시작', end: '종료', weight: '가중치',
  actualPct: '실적%', plannedPct: '계획%', vsPlan: '계획대비%', progress: '진척', status: '상태',
  extraAxis: 'Biz', subAct: '세부업무', code: '코드', name: '이름',
} as const)

/** 헤더 별칭 사전 — 완전일치(trim, 대소문자 무시) 우선, 부분일치 차선(감지기 규칙 5). detect.ts 가 재수출한다. */
export const LOGICAL_ALIASES: Record<keyof ExcelProfile['logical'], readonly string[]> = {
  extraAxis: ['Biz', 'Biz.', '업무영역', '사업영역'],
  code: ['코드', 'Code', 'No', 'No.', '번호'],
  deliverable: ['산출물', '산출물명', 'Deliverable', '결과물'],
  start: ['시작', '시작일', 'Start', 'Start Date', '착수일'],
  end: ['종료', '종료일', 'End', 'End Date', '완료일'],
  weight: ['가중치', 'Weight', '비중'],
  actualPct: ['실적%', '실적', 'Actual', 'Actual%', '진척률', '진척율'],
  // outline 계층 전용(규칙 5 물). columns 계층은 계층 열 자체가 이름의 출처라 이 별칭을 쓰지 않는다
  // (detectWorkbook 조립부가 hierarchy.kind==='columns' 면 무조건 null 로 강제한다) — 맨 뒤에 둬서
  // 기존 6개 필드의 열 선점 우선순위를 건드리지 않는다(리뷰 픽스: outline+1 무검증 관례 대체).
  name: ['이름', '업무명', '작업명', '제목', '내용', 'Name', 'Title'],
}

/** '담당' 열에 팀명을 직접 적는 방식(감지기 규칙 6 대안)을 인식하는 헤더 별칭. LOGICAL_ALIASES 밖 —
 *  팀은 ExcelProfile.logical 의 필드가 아니라 teamColumns 다. */
export const TEAM_HEADER_ALIASES: readonly string[] = ['담당', '담당팀', '담당자', 'Owner', 'Team', '팀']

/** 팀명 직접 방식의 표지 — teamColumns=[[열, TEAM_DIRECT_MARK]] 는 '담당' 열 하나에 팀명이 든 양식이고 팀 code 가 아니다(감지기 규칙 6 대안).
 *  소비처(감지·빌더·파서·교차 검증·가져오기 라우트·마법사)가 이 상수 하나를 쓴다 — 리터럴로 흩어져 한 곳이 빠진 회귀(A1-5 R5)가 있었다(A2 이월 Z5 F-4) */
export const TEAM_DIRECT_MARK = '*'

/** 팀 이름으로 쓸 수 없는 엑셀 머리 낱말 전부(중복 없음, 등장 순) */
export const EXCEL_HEADER_WORDS: readonly string[] = Object.freeze([...new Set([
  ...Object.values(HEADER),
  ...Object.values(LOGICAL_ALIASES).flat(),
  ...TEAM_HEADER_ALIASES,
])])

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase()
/** 감지기와 같은 비교 — 대소문자·전각·앞뒤 공백 무시 */
export function isHeaderWordMatch(a: string, b: string): boolean {
  return norm(a) === norm(b)
}
