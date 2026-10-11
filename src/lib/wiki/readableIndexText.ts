/** 색인 본문의 '상태: in_progress' 같은 줄에서 코드를 사람이 읽는 이름으로 바꿀 때 쓰는 이름표 — 이슈의 제품 기본 상태·심각도 */
const LABELS: Record<string, Record<string, string>> = {
  '상태': { open: '열림', in_progress: '진행중', resolved: '해결', on_hold: '보류' },
  '심각도': { high: '높음', medium: '보통', low: '낮음' },
}
const LINE = /^(상태|심각도): ([a-z_]+)$/gm

/**
 * 검색 색인 본문을 화면에 보일 때만 읽기 좋게 바꾼다 — 색인은 상태·심각도를 저장된 코드(in_progress·high)로 적는데,
 * 그대로 보이면 영문 코드가 검색 결과에 드러난다(2026-10-11 사용자 테스트). 색인 자체(검색·AI 가 읽는 글)는 건드리지 않는다.
 * 프로젝트가 따로 만든 코드는 이름표에 없으므로 그대로 둔다.
 */
export function readableIndexText(content: string): string {
  return content.replace(LINE, (line, field: string, code: string) => {
    const label = LABELS[field]?.[code]
    return label ? `${field}: ${label}` : line
  })
}
