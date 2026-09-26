// service_role 클라이언트를 직접 만드는 파일 = 감사표(docs/sp2-admin-client-audit.md)의 행. 표에 없는 새 파일은 실패 —
// 스코프를 정하고(adminFor) 쓰거나, 표에 분류·근거를 적어야 한다. '경계 넘음' 분류는 남아 있으면 실패.
//
// 이 불변식이 검사하는 것은 **문서화의 완결성**이지 쿼리의 스코프가 아니다(SP2 컨트롤러 판정 — weak-test ruling).
// 파일마다 각 admin 체인이 워크스페이스·프로젝트 id 로 좁혀졌는지는 정적으로 판정할 수 없다. 여기서는
// ① createAdminClient 를 언급하는 src 파일이 전부 표에 있고, ② 표의 모든 행이 허용된 분류 하나와 한 줄 근거를
// 가졌는지만 본다. 근거가 사실인지는 사람 리뷰(최종 리뷰의 표본 확인)가 판정한다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
const DEFINITIONS = new Set(['src/lib/supabase/admin.ts', 'src/lib/supabase/env.ts'])
const CATEGORIES = new Set(['플랫폼', '외부 API·서비스', '세션 가드 뒤 id 스코프', 'adminFor 정의'])

function importers(): string[] {
  return walk(ROOT).map((f) => relative(process.cwd(), f))
    .filter((f) => !DEFINITIONS.has(f) && /\bcreateAdminClient\b/.test(readFileSync(f, 'utf8'))).sort()
}
function auditRows(): Array<{ file: string; category: string; reason: string }> {
  const doc = readFileSync('docs/sp2-admin-client-audit.md', 'utf8')
  const body = doc.split('<!-- audit:start -->')[1]?.split('<!-- audit:end -->')[0]
  if (!body) throw new Error('감사표 표지(audit:start/end)가 없다')
  return body.split('\n').filter((l) => /^\|\s*src\//.test(l)).map((l) => {
    const [file, category, reason] = l.split('|').slice(1, 4).map((s) => s.trim())
    return { file, category, reason }
  })
}

describe('admin 클라이언트 스코프(SP2 §4.2) — 감사표 완결성', () => {
  it('createAdminClient 를 쓰는 파일 = 감사표 행', () => {
    expect(importers()).toEqual(auditRows().map((r) => r.file).sort())
  })
  it('분류는 허용된 넷 중 하나이고 근거가 비어 있지 않다(경계 넘음 0)', () => {
    const bad = auditRows().filter((r) => !CATEGORIES.has(r.category) || r.reason.length < 4)
    expect(bad).toEqual([])
  })
  it('adminFor 정의 행은 adminFor.ts 하나뿐', () => {
    expect(auditRows().filter((r) => r.category === 'adminFor 정의').map((r) => r.file))
      .toEqual(['src/lib/supabase/adminFor.ts'])
  })
})
