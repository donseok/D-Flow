import { spawnSync } from 'node:child_process'

const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/settings/catalog-sync.test.ts'], {
  stdio: 'inherit', env: { ...process.env, CATALOG_WRITE: '1' },
})
if (run.error) throw run.error
process.exit(run.status ?? 1)
