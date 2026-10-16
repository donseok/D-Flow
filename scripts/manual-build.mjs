// 사용자 매뉴얼 원본(src/content/manual/NN-slug.md)을 JSON 으로 묶는다 — 배포 번들이 런타임 파일 읽기·파일 추적에 기대지 않게(스펙 2026-10-16 §4.1).
// 생성물은 커밋한다 — .json 인 이유: 본문의 시간대 예시(Asia/Seoul 등)가 코드의 고정 시간대를 막는 검사(tests/settings/no-runtime-constants, D45)에 .ts 로는 걸린다. 읽는 쪽은 chapters.generated.ts 의 한 줄 import 다.
// tests/manual/content.test.ts 가 원본과 어긋나면 실패한다 → `npm run manual:build`.
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANUAL_DIR = 'src/content/manual'
export const GENERATED_FILE = 'src/content/manual/chapters.generated.json'

/** @param {string} [root] */
export function renderGenerated(root = process.cwd()) {
  const dir = join(root, MANUAL_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  const items = files.map((file) => ({ file, raw: readFileSync(join(dir, file), 'utf8') }))
  return JSON.stringify(items, null, 1) + '\n'
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 조용히 아무것도 안 하지 않게 둘 다 실경로로 맞댄다
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  writeFileSync(join(process.cwd(), GENERATED_FILE), renderGenerated())
  console.log(`[manual:build] ${GENERATED_FILE} 를 다시 만들었습니다.`)
}
