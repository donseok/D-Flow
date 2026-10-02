/**
 * 회의록 영구 링크 형식의 기준 경로(D6) — 옛 전역 경로 스텁이 행의 워크스페이스로 보낸다. 범위를 모르는 출처(봇 출처·범위 조회 실패 폴백)만 쓴다.
 * 범위를 아는 화면은 wsHref(slug, 'minutes') 를 쓴다. 링크 함수(minuteSourceHref·wikiMinuteSourceHref)는 기준 경로를 필수로 받는다 —
 * 기본값으로 두면 빠뜨린 호출부가 조용히 스텁을 한 번 더 도는 링크를 만든다(U2b-5 리뷰 수정 CC6).
 * 의존성이 없는 파일이다 — 위키 공용 컴포넌트가 마크다운 파서(blocks.ts)를 끌지 않고 가져다 쓴다.
 */
export const MINUTES_PERMALINK_BASE = '/minutes'
