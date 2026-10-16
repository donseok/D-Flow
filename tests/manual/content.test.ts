import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderGenerated } from '../../scripts/manual-build.mjs'
import { manualChapters } from '@/lib/manual/chapters'

const ROOT = process.cwd()
const chapters = manualChapters()

/** 사용자에게 보이면 안 되는 개발 용어(본문 검사) */
const BANNED = [/\bRPC\b/, /\bRLS\b/, /service_role/, /\bSupabase\b/i, /\bsupabase\b/, /\bAPI\b/, /\btoken\b/i, /\bJSON\b/, /\bmigration\b/i, /마이그레이션/, /\bDB\b/, /모듈/]

describe('사용자 매뉴얼 본문', () => {
  it('생성 파일이 원본과 같다(다르면 npm run manual:build)', () => {
    expect(readFileSync(join(ROOT, 'src/content/manual/chapters.generated.ts'), 'utf8')).toBe(renderGenerated(ROOT))
  })
  it('장이 있고 slug·순서가 유일하다', () => {
    expect(chapters.length).toBeGreaterThan(0)
    expect(new Set(chapters.map((c) => c.slug)).size).toBe(chapters.length)
    expect(new Set(chapters.map((c) => c.order)).size).toBe(chapters.length)
  })
  it.each(chapters.map((c) => [c.file, c] as const))('%s — 본문·절이 비지 않았고 제목에 표기 기호가 없다', (_f, c) => {
    expect(c.body.trim().length).toBeGreaterThan(200)
    expect(c.sections.length).toBeGreaterThan(0)
    for (const s of c.sections) expect(s.title).not.toMatch(/[`*_[\]]/)
  })
  it.each(chapters.map((c) => [c.file, c] as const))('%s — /help 링크와 앵커가 실제로 있다', (_f, c) => {
    const bySlug = new Map(chapters.map((x) => [x.slug, x]))
    const links = [...c.body.matchAll(/\]\((\/help[^)\s]*|#[^)\s]+)\)/g)].map((m) => m[1])
    for (const href of links) {
      const [path, hash] = href.split('#')
      const target = path === '' ? c : path === '/help' ? null : bySlug.get(path.replace(/^\/help\//, ''))
      if (path !== '' && path !== '/help') expect(target, `${c.file}: ${href}`).toBeDefined()
      if (hash) expect(target?.sections.some((s) => s.id === decodeURIComponent(hash)), `${c.file}: ${href}`).toBe(true)
    }
  })
  it.each(chapters.map((c) => [c.file, c] as const))('%s — 개발 용어를 쓰지 않는다', (_f, c) => {
    for (const re of BANNED) expect(c.body, `${c.file}: ${re}`).not.toMatch(re)
  })
})
