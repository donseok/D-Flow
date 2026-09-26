// tests/invariants/_walk.ts — 소스 트리 재귀 파일 목록(.ts/.tsx)의 단일 출처. 불변식 테스트마다 따로
// 베끼지 않는다(리뷰 D3 — walk() 가 no-legacy-org·domain-layering·roster-writes 세 곳에 중복돼 있었다).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.next'])

/** dir 아래 .ts/.tsx 파일 전체(재귀). skipDirs 는 이름만 보고 건너뛴다(기본: node_modules·.next). */
export function walk(dir: string, skipDirs: Set<string> = DEFAULT_SKIP_DIRS): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p, skipDirs))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
