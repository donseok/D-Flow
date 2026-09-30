import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPERATIONAL_SETTINGS } from '@/lib/settings/operational'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? sources(join(dir, item.name))
    : /\.[cm]?[jt]sx?$/.test(item.name) ? [join(dir, item.name)] : [])
}
const files = [...sources('src'), 'next.config.ts']
const codeLines = (file: string) => readFileSync(file, 'utf8').split('\n').filter(line => !/^\s*(?:\/\/|\*|#)/.test(line)).join('\n')

describe('운영 설정 목록', () => {
  it('직접 읽는 환경 변수는 목록과 소유 파일에 있으며 비밀값은 목록에 없다', () => {
    const defs = new Map(OPERATIONAL_SETTINGS.map(def => [def.name, def]))
    const unknown: string[] = []
    const wrongOwner: string[] = []
    for (const file of files) {
      for (const match of codeLines(file).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        const name = match[1]
        if (name === 'NODE_ENV' || name === 'WIKI_') continue // WIKI_ 조각은 serviceState의 타입 설명. 실제 판독은 flags.ts에서 한다.
        const def = defs.get(name)
        if (!def) unknown.push(`${file}: ${name}`)
        else if (!def.owner.includes(file)) wrongOwner.push(`${file}: ${name}`)
      }
    }
    expect(unknown).toEqual([])
    expect(wrongOwner).toEqual([])
    expect(OPERATIONAL_SETTINGS.some(def => 'value' in def)).toBe(false)
  })

  it('계산된 이름·환경 객체 전달은 검토한 파일에만 있다', () => {
    const allowed = new Set([
      'src/lib/mail/transport.ts', 'src/lib/settings/resolve.ts', 'src/lib/modules/flags.ts',
      'src/lib/wiki/serviceState.ts', 'src/app/api/track/route.ts',
    ])
    const readers = files.filter(file => /process\.env\s*(?:\[|\)|\s*[,;]|\s*:\s*|\s*\?\?)/.test(codeLines(file)))
    expect(readers.filter(file => !allowed.has(file))).toEqual([])
  })

  it('모든 env 이름은 예시 파일에 있다', () => {
    const example = readFileSync('.env.local.example', 'utf8')
    const names = new Set([...example.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]))
    expect(OPERATIONAL_SETTINGS.filter(def => def.kind !== 'table' && !names.has(def.name)).map(def => def.name)).toEqual([])
    for (const def of OPERATIONAL_SETTINGS) for (const owner of def.owner) expect(existsSync(owner), owner).toBe(true)
  })
})
