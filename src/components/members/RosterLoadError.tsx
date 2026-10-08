/**
 * 명단 조회 실패 표시 — 명단이 곁가지인 화면(담당자·참석자 선택, 이름 표시)에서 본문은 그대로 두고 이 경고를 띄운다.
 * 선택 목록이 비어 보이는 것을 '명단 0명' 으로 읽지 않게 하는 것이 목적이다(에러 처리 3원칙 ①).
 * 상태도 이벤트도 없어 서버·클라이언트 어느 쪽에서든 그린다. error 는 getProjectRoster 의 사유 문구.
 */
export function RosterLoadError({ error }: { error: string }) {
  return (
    <p role="alert" data-roster-load-error className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">
      {error} 담당자·참석자 목록이 비어 보이는 것은 명단이 없어서가 아니라 불러오지 못해서입니다. 새로고침하세요.
    </p>
  )
}
