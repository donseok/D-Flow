/* ── 시트 프레즌스 도메인(순수) — 사용자 색상 배정·셀 매핑·온라인 목록. I/O 없음. ── */

import { compareKoreanName } from './nameSort'
import type { WeeklyCellKey } from './weeklySheet'

/** 타 사용자 프레즌스 팔레트 — 셀 위치 링(SheetCell border-2)·아바타·이름 칩 배경. 시트는 테마를 따르므로(SP4 B) 링은 다크 종이
 *  (surface = night-900) 위에서 비텍스트 대비 3:1 이상이어야 한다(tests/domain/presence-contrast — 옛 갈색 #7b5e57 은 2.8:1 이라 #a1887f 로).
 *  라이트 흰 종이 위에서는 #24c1e0·#f9ab00 이 3:1 아래다(시트가 늘 흰색이던 때부터 — 이월 관찰).
 *  자기 선택 링(border-focus)·저장 상태색(success·danger 토큰)과 겹치지 않게 구성. 칩 글자는 presenceForeground 가 배경 짝으로 고른다. */
export const PRESENCE_COLORS = [
  '#e8710a', '#34a853', '#a142f4', '#f538a0', '#24c1e0', '#ea4335', '#f9ab00', '#a1887f',
] as const

/** userId → 결정적 색상. 같은 사용자는 어느 세션·어느 셀에서든 항상 같은 색. */
export function presenceColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]
}

/** 아바타·이름 칩 글자색 후보 — 흰색과 거의 검정. 배경 짝으로 고른다(흰 글자 고정은 밝은 팔레트에서 3:1 안팎 — UI-1 axe 위반) */
const FG_LIGHT = '#ffffff'
const FG_DARK = '#111111'

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** 배경 위 글자색 — 흰 글자가 본문 기준(4.5:1)을 넘으면 흰색, 아니면 대비가 큰 쪽(테마와 무관 — 배경이 테마와 무관하므로) */
export function presenceForeground(bg: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(bg)) return FG_LIGHT
  if (contrast(FG_LIGHT, bg) >= 4.5) return FG_LIGHT
  return contrast(FG_DARK, bg) >= contrast(FG_LIGHT, bg) ? FG_DARK : FG_LIGHT
}

/** userId → 아바타 배경·글자색 짝(인라인 style) */
export function presenceStyle(userId: string): { background: string; color: string } {
  const background = presenceColor(userId)
  return { background, color: presenceForeground(background) }
}

/** Realtime presence track/state로 오가는 최소 페이로드 + 연결 키. */
export interface PresencePeer {
  connKey: string  // 연결(탭) 단위 presence 키 — 같은 사용자의 다중 탭 구분
  userId: string
  name: string
  rowId: string            // 활성 셀 좌표(없으면 '')
  col: WeeklyCellKey | ''
  editing: boolean
  ts: number               // 마지막 track 시각(ms) — 사용자당 최신 위치 판별용
}

export const CELL_PEERS_MAX = 3 // 한 셀에 겹칠 때 이름 칩 표시 상한(초과분은 +N)

/** 셀 키(`rowId:col`) → 그 셀에 있는 타인 목록.
 *  자기 자신(다른 탭 포함)은 제외(구글시트 동일).
 *  **사용자당 최신(ts 최대) 위치 1개만** — 같은 사람이 여러 탭/창으로 접속했거나 track이 겹치면
 *  각 연결의 마지막 셀이 전부 링으로 남아 '클릭 이력'처럼 보인다. 최종 위치만 표시한다. */
export function buildPresenceMap(peers: PresencePeer[], selfUserId: string): Map<string, PresencePeer[]> {
  const latest = new Map<string, PresencePeer>()
  for (const p of peers) {
    if (p.userId === selfUserId) continue
    if (!p.rowId || !p.col) continue
    const prev = latest.get(p.userId)
    if (!prev || (p.ts ?? 0) > (prev.ts ?? 0)) latest.set(p.userId, p)
  }
  const map = new Map<string, PresencePeer[]>()
  for (const p of latest.values()) {
    const k = `${p.rowId}:${p.col}`
    const list = map.get(k)
    if (list) list.push(p)
    else map.set(k, [p])
  }
  // 한 셀에 여러 명이 겹치면 이름 칩이 나란히 뜬다. presence 도착 순서를 그대로 두면
  // 같은 셀을 보는 두 사람에게 칩 순서가 다르게 보이고, 상한(CELL_PEERS_MAX)에 걸려
  // 잘려 나가는 사람도 세션마다 달라진다. 가나다순으로 고정한다.
  for (const list of map.values()) list.sort((a, b) => compareKoreanName(a.name, b.name))
  return map
}

/** 아바타 원 안에 넣을 짧은 라벨 — 2자까지(한글 이름 '홍길동'→'홍길', 라틴 'John'→'Jo'). */
export function avatarLabel(name: string): string {
  const t = name.trim()
  return t.length <= 2 ? t : t.slice(0, 2)
}

/** 온라인 사용자 목록(툴바 스트립용) — **본인 포함 전원**, userId 단위 dedupe, 이름 가나다순.
 *  (셀 링은 buildPresenceMap이 본인을 제외하지만, 접속자 아바타는 전원을 보여준다 — 사용자 결정.) */
export function onlinePeers(peers: PresencePeer[]): { userId: string; name: string }[] {
  const byId = new Map<string, string>()
  for (const p of peers) if (!byId.has(p.userId)) byId.set(p.userId, p.name)
  return [...byId].map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => compareKoreanName(a.name, b.name))
}
