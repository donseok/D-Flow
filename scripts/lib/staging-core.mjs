// scripts/lib/staging-core.mjs
// staging-sync / db-apply / predev 가드가 공유하는 순수 로직.
// 부작용(키체인·psql·fetch)은 여기 두지 않는다 — vitest 로 검증하기 위해서다.

export function parseDsnRef(dsn) {
  const user = dsn.match(/^postgresql:\/\/([^:@/]+)[:@]/)?.[1] ?? ''
  const byUser = user.match(/^[a-z_]+\.([a-z0-9]{20})$/)?.[1]
  if (byUser) return byUser
  const byHost = dsn.match(/@db\.([a-z0-9]{20})\.supabase\.co/)?.[1]
  return byHost ?? null
}

export function maskDsn(dsn) {
  return dsn.replace(/(:\/\/[^:@/]+:).+@/, '$1***@')
}
