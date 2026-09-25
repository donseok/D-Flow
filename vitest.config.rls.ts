import { defineConfig } from 'vitest/config'
import path from 'node:path'

// tests/rls — 로컬 Postgres 에 authenticated 세션을 흉내 내 RLS·트리거·컬럼 권한을 실측한다(npm run test:rls).
// 단위 테스트(vitest.config.ts)와 분리한 이유: 이쪽은 DB 가 떠 있어야 하고, 한 DB 를 공유하므로 파일을 직렬로 돌린다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rls/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
