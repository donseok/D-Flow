// 팀 표시 라벨 순수 도메인 — JSX·I/O 없음. 화면에 보이는 팀 글자는 바꿀 수 있는 이름(teams.name)이고, 바꿀 수 없는 code 는
// 식별자(담당·엑셀 팀 열·URL 필터·봇 반환 키·변경 이력)로만 쓴다. 화면이 code 를 그리면 이름을 바꿔도 옛 글자가 남는다.

/** 라벨을 정하는 데 필요한 팀 필드 — Team 이 그대로 맞는다 */
export type TeamLabelRef = { code: string; name: string }

const baseLabel = (t: TeamLabelRef): string => t.name.trim() || t.code

/** 한 팀의 표시 라벨 — 이름. 같은 목록에 같은 이름의 다른 팀이 있으면(공용·전용 동명, 개명으로 겹친 이름) `이름 (code)` 로 가른다.
 *  이름이 비었으면 code. teams 는 그 화면이 함께 보여 주는 팀 목록이다(겹침은 그 안에서만 본다).
 *  code 까지 같은 두 팀(공용과 전용이 같은 code·같은 이름)은 글자로 가를 수 없다 — 같은 라벨이 된다. */
export function teamLabel(team: TeamLabelRef, teams: readonly TeamLabelRef[]): string {
  const base = baseLabel(team)
  if (base === team.code) return base
  const clash = teams.some((o) => o !== team && o.code !== team.code && baseLabel(o) === base)
  return clash ? `${base} (${team.code})` : base
}

/** code → 표시 라벨. 목록에 없는 code(비활성 팀 담당·다른 범위의 전용 팀·공급자가 없는 공유 화면)는 code 그대로 —
 *  이름을 지어내지 않는다. 같은 code 가 둘이면 목록의 앞 팀이 이긴다(색 슬롯 teamSlotFor 와 같은 팀). */
export function teamLabelLookup(teams: readonly TeamLabelRef[]): (code: string) => string {
  const byCode = new Map<string, string>()
  for (const t of teams) if (!byCode.has(t.code)) byCode.set(t.code, teamLabel(t, teams))
  return (code: string) => byCode.get(code) ?? code
}

/** 색인 본문·봇 문맥의 팀 표기 — `이름 (code)`. code 를 함께 적어 code 로 묻는 검색(엑셀·옛 문서의 표기)도 계속 맞는다.
 *  이름이 code 와 같거나 없으면 한 번만 적는다 */
export function teamNameWithCode(code: string, name: string | null | undefined): string {
  const n = (name ?? '').trim()
  return n && n !== code ? `${n} (${code})` : code
}
