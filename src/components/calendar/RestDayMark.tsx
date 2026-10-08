// 달력 칸의 '쉬는 날' 보조 단서(SP5 A — A-5 리뷰 O4). 배경(bg-weekend)은 다크에서 surface 대비 1.06:1 이라 색만으로는 쉬는 날이
// 보이지 않는다(토큰 값 조정은 레인 B UI-3 몫). 이름 없는 쉬는 날은 날짜 옆 작은 글자 표지(시각) + sr-only 문구(보조기기),
// 이름 있는 휴무는 이름이 이미 글자 단서라 sr-only 문구만. 근태·회의·회의록 달력 셋이 같이 쓴다.
export function RestDayMark({ named, mark, label }: { named: boolean; mark: string; label: string }) {
  if (named) return <span className="sr-only">{label}</span>
  return (
    <span data-rest-mark className="text-[10px] font-medium leading-tight text-fg-muted">
      <span aria-hidden="true">{mark}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
