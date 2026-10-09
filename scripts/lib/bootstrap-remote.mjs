// scripts/lib/bootstrap-remote.mjs — 원격 첫 부트스트랩(scripts/bootstrap-remote.mjs)의 순수 부분. I/O 없음 — vitest 로 검증한다.
// 대상 해석은 scripts/lib/targets.mjs 를 그대로 쓴다: 금지 ref(원본 DB)는 어떤 경로로 들어와도 멈추고, 그 검사를 끄는 인자·환경 변수는 없다.
import { assertNotForbidden, classifySupabaseUrl, resolveTarget } from './targets.mjs'

export const MIN_PASSWORD = 8 // 앱 규칙(src/lib/domain/accounts.ts isValidPassword)·dev-bootstrap 과 같다
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/ // 0003 workspaces.slug check 와 같은 식
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // 0003 people.email check 와 같은 식

/**
 * 인자 — `--target staging|prod` 필수, `--yes` 는 확인 질문만 생략한다(대상 검사는 생략되지 않는다). 그 밖의 인자는 거부한다
 * (오타 난 플래그를 조용히 무시하면 의도와 다른 실행이 된다). 비밀값을 인자로 받지 않는다 — 셸 기록·프로세스 목록에 남는다.
 */
export function parseBootstrapArgs(argv) {
  let target
  let yes = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes') yes = true
    else if (a === '--target') {
      target = argv[++i]
      if (target === undefined || target.startsWith('--')) return { ok: false, error: '--target 에 값이 없다' }
    } else return { ok: false, error: `모르는 인자: ${a}` }
  }
  if (target === undefined) return { ok: false, error: '--target 이 없다' }
  return { ok: true, target, yes }
}

/**
 * 접속 좌표 — { name, ref, url }. 규칙:
 *  ① 대상은 staging|prod 뿐(local 은 npm run dev:bootstrap). ref 는 targets.mjs 의 resolveTarget(STAGING_REF·PROD_REF, 금지 목록 검사 포함).
 *  ② URL 은 BOOTSTRAP_SUPABASE_URL(자체호스트 — Supabase API 주소), 없으면 https://<ref>.supabase.co.
 *  ③ URL 은 https, userinfo 없음, 보이지 않는 문자 없음이고, classifySupabaseUrl 로 다시 본 대상이 지정한 대상과 같아야 한다
 *     (= URL 이 그 ref 를 담는다 — "이름 붙인 곳"과 "실제로 붙는 곳"이 갈라지지 않게). 로컬 주소·금지 ref·다른 대상의 ref 는 여기서 멈춘다.
 * @param {string} name
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveBootstrapTarget(name, env = process.env) {
  if (name === 'local') throw new Error('로컬은 npm run dev:bootstrap 을 쓴다 — 이 스크립트는 원격 전용이다')
  if (name !== 'staging' && name !== 'prod') throw new Error(`대상은 staging|prod 중 하나 (현재: ${name})`)
  const { ref } = resolveTarget(name, env)
  const url = env.BOOTSTRAP_SUPABASE_URL?.trim() || `https://${ref}.supabase.co`
  assertNotForbidden(url)
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('BOOTSTRAP_SUPABASE_URL 이 URL 이 아니다') }
  if (parsed.protocol !== 'https:') throw new Error('원격 Supabase 주소는 https 여야 한다 — service_role 키를 평문으로 보내지 않는다')
  if (parsed.username || parsed.password) throw new Error('Supabase 주소에 계정 정보(user:pass@)를 넣지 않는다')
  // 다른 대상의 ref 를 env 로 함께 주면 classify 가 그쪽으로 읽을 수 있다 — 두 ref 를 모두 넘겨 어긋남을 잡는다
  const kind = classifySupabaseUrl(url, { STAGING_REF: env.STAGING_REF, PROD_REF: env.PROD_REF })
  if (kind === 'forbidden') throw new Error('금지된 원본 DB 좌표 — D-Flow 는 원본 DB 에 접속하지 않는다')
  if (kind === 'local') throw new Error('로컬 주소다 — 로컬은 npm run dev:bootstrap 을 쓴다')
  if (kind !== name) throw new Error(`Supabase 주소가 ${name} 의 ref 를 담고 있지 않다 — 대상(${name})과 주소가 어긋난다`)
  return { name, ref, url: parsed.origin, host: parsed.host }
}

/**
 * 멱등 판정 — 플랫폼 관리자가 이미 있으면 아무것도 하지 않는다(재실행 안전). 수를 읽지 못했으면 멈춘다(모르는 채로 만들지 않는다 — fail-closed).
 * @param {{ count: number | null | undefined, error?: { message: string } | null }} input
 * @returns {{ action: 'skip' | 'proceed' | 'abort', reason: string }}
 */
export function bootstrapDecision({ count, error }) {
  if (error) return { action: 'abort', reason: `플랫폼 관리자 수를 읽지 못했다: ${error.message}` }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return { action: 'abort', reason: '플랫폼 관리자 수(count)를 받지 못했다' }
  if (count > 0) return { action: 'skip', reason: `이미 플랫폼 관리자가 ${count}명 있다` }
  return { action: 'proceed', reason: '플랫폼 관리자가 없다 — 첫 관리자를 만든다' }
}

/** 계정·워크스페이스 입력 — 문제 목록(빈 배열이면 통과). 비밀번호는 길이만 보고 값은 어디에도 싣지 않는다 */
export function bootstrapInputProblems({ email, password, slug, workspaceName }) {
  const out = []
  if (typeof email !== 'string' || email !== email.trim().toLowerCase() || !EMAIL_RE.test(email)) out.push('이메일 형식이 아니다(소문자, 공백 없음)')
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) out.push(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 한다`)
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) out.push('워크스페이스 slug 형식: 소문자·숫자·하이픈 2~63자')
  if (typeof workspaceName !== 'string' || !workspaceName.trim()) out.push('워크스페이스 이름이 비어 있다')
  return out
}

/** 실행 전 출력 — 대상과 할 일. 비밀값(비밀번호·키)은 넣지 않는다 */
export function bootstrapPlanLines({ target, email, slug, workspaceName, modules, timezone }) {
  return [
    `대상: ${target.name} (ref ${target.ref}) — ${target.host}`,
    '할 일:',
    `  1. 워크스페이스 ${slug}(${workspaceName}) — 있으면 그대로 쓴다`,
    `  2. 계정 ${email} 생성(이메일 확인 완료 상태)`,
    '  3. 그 계정을 플랫폼 관리자·워크스페이스 관리자로 지정하고 인물 원장에 잇는다',
    `  4. 워크스페이스 설정 — 허용 모듈 ${modules.length}개${timezone ? `, 시간대 ${timezone}` : '(시간대는 쓰지 않는다 — 제품 기본값)'}`,
  ]
}
