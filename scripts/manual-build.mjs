// 사용자 매뉴얼 원본(src/content/manual/NN-slug.md)을 문자열 배열 모듈로 묶는다 — 배포 번들이 런타임 파일 읽기·파일 추적에 기대지 않게(스펙 2026-10-16 §4.1).
// 생성물은 커밋한다. tests/manual/content.test.ts 가 원본과 어긋나면 실패한다 → `npm run manual:build`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANUAL_DIR = 'src/content/manual'
export const GENERATED_FILE = 'src/content/manual/chapters.generated.ts'

/** @param {string} [root] */
export function renderGenerated(root = process.cwd()) {
  const dir = join(root, MANUAL_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  const items = files.map((f) => `  { file: ${JSON.stringify(f)}, raw: ${JSON.stringify(readFileSync(join(dir, f), 'utf8'))} },`)
  return [
    '// 자동 생성 — 직접 고치지 말 것. src/content/manual/*.md 를 고친 뒤 `npm run manual:build`(tests/manual/content.test.ts 가 어긋남을 잡는다).',
    'export const MANUAL_SOURCES: readonly { file: string; raw: string }[] = [',
    ...items,
    ']',
    '',
  ].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(process.cwd(), GENERATED_FILE), renderGenerated())
  console.log(`[manual:build] ${GENERATED_FILE} 를 다시 만들었습니다.`)
}
