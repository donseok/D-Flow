import 'server-only'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import type { AdminClient } from '@/lib/supabase/adminFor'
import type { MailPreset } from './settingsInput'

// 워크스페이스 발송 메일 설정(0059 workspace_mail_settings)의 행 형·env 꼴 매핑·조회·발송 직전 서버 주소 검사.
// 판정(MailStatus·resolveMailStatus·발송 설정 고르기)은 transport.ts 에 있다 — 이 파일은 transport.ts 를 import 하지 않는다(순환 방지).
// 클라이언트는 호출자가 adminFor({ workspaceId }) 로 만들어 넘긴다 — 이 파일은 service_role 클라이언트를 직접 만들지 않는다
// (그래서 감사표 docs/sp2-admin-client-audit.md 에 행이 생기지 않는다 — tests/invariants/admin-scope.test.ts).

/** workspace_mail_settings 한 행(설계 §1.1). password 는 평문이다 — 응답·로그·오류 어디에도 싣지 않는다 */
export interface WorkspaceMailRow {
  workspace_id: string
  preset: MailPreset
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  from_address: string | null
  password_set_by: string | null
  password_set_at: string
  updated_by: string | null
  updated_at: string
}

/** select 열 목록 — WorkspaceMailRow 의 필드 전부(순서 같음) */
export const WORKSPACE_MAIL_COLUMNS =
  'workspace_id, preset, host, port, secure, username, password, from_address, password_set_by, password_set_at, updated_by, updated_at'

const ROW_KEYS = WORKSPACE_MAIL_COLUMNS.split(', ') as ReadonlyArray<keyof WorkspaceMailRow>

/**
 * 행 → env 꼴 레코드(순수). 검증은 하지 않는다 — 기존 resolveSmtpSettings 한 벌이 env 와 같은 규칙으로 본다.
 * SMTP_AUTH 는 비운다(계정 로그인만 — 워크스페이스 행에는 무인증 릴레이가 없다, 설계 §1.1). 보내는 주소가 없으면 빈 값 → 계정이 발신 주소.
 */
export function rowToSmtpEnv(
  row: Pick<WorkspaceMailRow, 'host' | 'port' | 'secure' | 'username' | 'password' | 'from_address'>,
): Record<string, string> {
  return {
    SMTP_HOST: row.host,
    SMTP_PORT: String(row.port),
    SMTP_SECURE: row.secure ? 'true' : 'false',
    SMTP_AUTH: '',
    SMTP_USER: row.username,
    SMTP_PASS: row.password,
    SMTP_FROM_ADDRESS: row.from_address ?? '',
  }
}

export type WorkspaceMailLoad = { kind: 'row'; row: WorkspaceMailRow } | { kind: 'none' } | { kind: 'archived' }

/**
 * 그 워크스페이스의 메일 설정 행 — 워크스페이스의 보관 시각(0056)을 workspaces!inner 임베드로 함께 읽는다.
 * 조회 실패는 throw(미설정으로 위장하지 않는다 — 3원칙 ①). 임베드를 못 읽으면(키 없음·null·archived_at 없음·형이 다름) throw —
 * 모르면 닫는다(inviteRedeem.ts loadInvite 와 같은 규칙). 행이 없는 보관 워크스페이스는 조인할 행이 없어 'none' 이다 —
 * 발송 호출자는 가드(buildActor, 0056)가 먼저 닫는다. 캐시하지 않는다(저장한 다음 발송부터 바로 쓰인다).
 */
export async function loadWorkspaceMailRow(admin: Pick<AdminClient, 'from'>, workspaceId: string): Promise<WorkspaceMailLoad> {
  const { data, error } = await admin
    .from('workspace_mail_settings')
    .select(`${WORKSPACE_MAIL_COLUMNS}, workspaces!inner(archived_at)`)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  // 오류 원문은 호출자(transport.ts)가 서버 로그에만 남긴다 — 사용자 문구는 MAIL_SETTINGS_UNAVAILABLE
  if (error) throw new Error(`메일 설정 조회 실패: ${error.message}`)
  if (!data) return { kind: 'none' }
  const rec = data as unknown as Record<string, unknown>
  const e = rec.workspaces
  const w = Array.isArray(e) ? e[0] : e
  if (!w || typeof w !== 'object' || !('archived_at' in w)) throw new Error('메일 설정 조회: 워크스페이스 보관 여부를 읽지 못했다')
  const archivedAt = (w as { archived_at: unknown }).archived_at
  if (typeof archivedAt === 'string') return { kind: 'archived' }
  if (archivedAt !== null) throw new Error('메일 설정 조회: 워크스페이스 보관 시각의 형이 다르다')
  // 임베드(workspaces)는 행 밖으로 내보내지 않는다 — 행 형의 필드만 옮긴다
  const row = Object.fromEntries(ROW_KEYS.map((k) => [k, rec[k]])) as unknown as WorkspaceMailRow
  return { kind: 'row', row }
}

// ── 발송 직전 서버 주소 검사(설계 §2.4) ──
// 관리자가 넣은 호스트로 서버가 직접 접속한다 — 내부망 탐침 통로가 되지 않게 사설·예약 대역으로 풀리는 이름을 거부한다.

/** 거부하는 IPv4 대역 [기준 주소, 접두 길이] — 이 망(0/8)·루프백·사설 셋·링크 로컬·CGNAT, 그리고 멀티캐스트·예약(224/4·240/4) */
const V4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['169.254.0.0', 16], ['100.64.0.0', 10], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function v4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const o = m.slice(1).map(Number)
  if (o.some((x) => x > 255)) return null
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
}

function v4Forbidden(n: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0
    return ((n & mask) >>> 0) === ((v4ToInt(base)! & mask) >>> 0)
  })
}

/** IPv6 → 16비트 묶음 8개. 영역 표시(%eth0)는 떼고, 끝의 점 표기 IPv4 는 묶음 둘로 바꾼다. 형태가 아니면 null */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const n = v4ToInt(tail)
    if (n === null) return null
    s = `${s.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - rest.length
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null
  const parts = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...rest]
  if (parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null
  return parts.map((p) => parseInt(p, 16))
}

/**
 * 연결하면 안 되는 주소인가(순수). 형태를 모르는 값은 거부한다(fail-closed).
 * IPv6: ::(미지정)·::1·fc00::/7(고유 로컬)·fe80::/10(링크 로컬)·ff00::/8(멀티캐스트), 그리고 IPv4 를 품은 꼴 —
 * ::ffff:a.b.c.d(매핑)·::a.b.c.d(호환, :: 와 ::1 도 여기 든다)·::ffff:0:a.b.c.d(변환)·64:ff9b::/96(NAT64 잘 알려진 접두)·
 * 2002::/16(6to4 — 16~47비트) — 은 품은 IPv4 를 위 대역으로 본다(NAT64·6to4 경로가 있는 망에서 사설 IPv4 로 닿는다).
 * 64:ff9b:1::/48(NAT64 지역 사용 접두, RFC 8215)은 통째로 거부한다 — 그 망이 정한 접두 길이에 따라 IPv4 가 RFC 6052 의 어느 자리에든
 * 들어갈 수 있어 끝 32비트만 봐서는 품은 주소를 알 수 없다.
 */
export function isForbiddenAddress(ip: string): boolean {
  const kind = isIP(ip.split('%')[0])
  if (kind === 4) {
    const n = v4ToInt(ip)
    return n === null || v4Forbidden(n)
  }
  if (kind !== 6) return true
  const g = v6Groups(ip)
  if (!g) return true
  if (g.every((x) => x === 0)) return true                       // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true                    // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true                    // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true                    // ff00::/8
  const tailV4 = ((g[6] << 16) | g[7]) >>> 0
  const embedsV4 = g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)
  if (embedsV4) return v4Forbidden(tailV4)
  const translated = g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0   // ::ffff:0:a.b.c.d
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)    // 64:ff9b::/96
  if (translated || nat64) return v4Forbidden(tailV4)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true                        // 64:ff9b:1::/48
  if (g[0] === 0x2002) return v4Forbidden(((g[1] << 16) | g[2]) >>> 0)                  // 2002::/16
  return false
}

/** DNS 해석 시간 한도 — 넘으면 거부로 닫는다(멈춘 리졸버가 발송·테스트 발송을 붙잡지 않게) */
const LOOKUP_TIMEOUT_MS = 5_000

/**
 * 발송 직전 DNS 검사 — 결과가 비었거나 하나라도 금지 대역이면 거부. 해석이 LOOKUP_TIMEOUT_MS 안에 끝나지 않아도 거부. 통과하면 연결할 IP(IPv4 우선, 없으면 첫 결과)를 돌려준다 —
 * verbatim 순서라 IPv6 가 먼저 올 수 있지만 Vercel 함수는 IPv6 로 나가지 못하는 경우가 많고, IP 고정 접속은 nodemailer 의 대체 시도를 건너뛴다.
 * 호출자가 그 IP 로 접속해(재해석·DNS 리바인딩 차단) 인증서는 원래 이름으로 검사한다(transport.ts connectTo).
 * 해석 오류 원문은 결과에 싣지 않는다(서버 로그에 오류 코드만). 로컬 개발 예외는 두지 않는다 — 로컬 시험은 env(inbucket)로 한다.
 */
export async function vetMailHost(host: string): Promise<{ ok: true; address: string } | { ok: false }> {
  if (typeof host !== 'string' || !host) return { ok: false }
  let found: Array<{ address: string; family: number }>
  // 타이머는 unref·clearTimeout — 대기 중에도 끝난 뒤에도 프로세스를 붙잡지 않는다. 늦게 끝난 해석의 거부는 race 가 받아 둔다
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), LOOKUP_TIMEOUT_MS)
    timer.unref?.()
  })
  try {
    // all: true 는 DNS 결과 전부를 받는 옵션이다 — tests/invariants/teams-source.test.ts 가 이 한 줄만 가시 범위 검사에서 따로 허용한다
    const r = await Promise.race([dns.lookup(host, { all: true, verbatim: true }), timeout])
    if (r === 'timeout') {
      console.error('[mail] 메일 서버 주소 해석 실패:', 'timeout')
      return { ok: false }
    }
    found = r
  } catch (e) {
    console.error('[mail] 메일 서버 주소 해석 실패:', (e as { code?: unknown } | null)?.code ?? 'unknown')
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
  if (!Array.isArray(found) || found.length === 0) return { ok: false }
  if (found.some((a) => typeof a?.address !== 'string' || isForbiddenAddress(a.address))) return { ok: false }
  const pick = found.find((a) => a.family === 4) ?? found[0]
  return { ok: true, address: pick.address }
}
