// npm run settings:verify 전용 — scripts/settings-verify.check.ts 하나만 돈다(tests/** 밖이라 npm run test 는 돌리지 않는다). 로컬 DB 필요.
import path from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', include: ['scripts/settings-verify.check.ts'], execArgv: ['--no-experimental-webstorage'], reporters: ['default'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js') } },
})
