// tests/invariants/_walk.ts — 소스 트리 재귀 파일 목록(.ts/.tsx)과 주석 걷기(codeLines)의 단일 출처. 불변식 테스트마다 따로
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

/** 주석을 걷어낸 코드 줄들 — 설명문 속 가드 이름은 호출이 아니다([a38]). 문자열 속 '//' 는 이 검사에서 무시해도 된다. */
export function codeLines(text: string): string[] {
  let inBlock = false
  return text.split('\n').map((raw) => {
    let line = raw
    let out = ''
    while (line.length) {
      if (inBlock) {
        const end = line.indexOf('*/')
        if (end < 0) { line = ''; break }
        line = line.slice(end + 2); inBlock = false
        continue
      }
      const block = line.indexOf('/*')
      const slash = line.indexOf('//')
      if (slash >= 0 && (block < 0 || slash < block)) { out += line.slice(0, slash); break }
      if (block >= 0) { out += line.slice(0, block); line = line.slice(block + 2); inBlock = true; continue }
      out += line; break
    }
    return out
  })
}
