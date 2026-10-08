#!/usr/bin/env node
// vercel.json 의 crons 를 잡 레지스트리에서 만든다(정본 §5.5.2 ①). 손으로 고치지 않는다.
//
//   npm run jobs:write            # vercel.json 을 다시 쓴다
//   npm run jobs:write -- --check # 다르면 exit 1(쓰지 않는다)
//
// 값의 출처는 scripts/lib/jobs-consts.mjs(레지스트리 사본 — tests/jobs/registry.test.ts 가 src/lib/jobs/registry.ts 와 대조한다).
// 자체호스트는 vercel.json 을 읽지 않는다 — 같은 URL 을 systemd timer·cron 으로 친다(docs/runbook-selfhost.md).
import { readFileSync, writeFileSync } from 'node:fs'
import { withCrons } from './lib/jobs-consts.mjs'

const FILE = 'vercel.json'
const current = readFileSync(FILE, 'utf8')
const next = withCrons(current)

if (process.argv.includes('--check')) {
  if (current !== next) {
    console.error('✗ vercel.json 의 crons 가 잡 레지스트리와 다르다 — npm run jobs:write')
    process.exit(1)
  }
  console.log('✓ vercel.json crons = 잡 레지스트리')
} else if (current === next) {
  console.log('✓ 바꿀 것 없음')
} else {
  writeFileSync(FILE, next)
  console.log('✓ vercel.json 의 crons 를 다시 썼다')
}
