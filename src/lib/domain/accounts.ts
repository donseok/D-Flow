// 계정 관련 순수 함수 — 클라이언트/서버 공용, 부수효과 없음.
// 계정 전역 팀은 0003 에서 폐지됐다 — 팀은 프로젝트 명단 행의 속성이다.
import { isValidEmail } from '@/lib/domain/validate'

/** 프로젝트 권한 화이트리스트. 'viewer' 는 명단 행 access_role 을 null 로 둔다는 뜻(조회 전용).
 *  옛 전역 권한 값(pmo_admin·team_editor)은 받지 않는다. */
export const ACCOUNT_ROLES = ['admin', 'member', 'viewer'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

export function isAccountRole(v: string): v is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(v)
}

/** 비밀번호 정책 — 최소 8자(Supabase 기본 정책과 정합). */
export function isValidPassword(pw: unknown): boolean {
  return typeof pw === 'string' && pw.length >= 8
}

/** 일괄 등록 한 줄의 파싱 결과. ok=false 이면 error 에 사유. */
export interface ParsedAccountLine {
  lineNo: number          // 파일 기준 1-base 행번호(빈 줄 포함해 계산)
  raw: string
  ok: boolean
  email?: string
  role?: AccountRole
  password?: string
  name?: string | null
  error?: string
}

/**
 * 일괄 붙여넣기 텍스트를 행 단위로 파싱·검증한다.
 * 형식: 고정 3열 `이메일, 권한, 초기비번` + 선택 4열 `이름`. 권한은 대상 프로젝트의 권한(admin·member·viewer).
 * 구분자는 콤마 또는 탭(엑셀 붙여넣기 대응). 빈 줄은 결과에서 제외한다.
 * 주의: 초기비번에는 콤마·탭을 쓸 수 없다(구분자로 해석됨).
 */
export function parseBulkAccounts(text: string): ParsedAccountLine[] {
  const out: ParsedAccountLine[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const trimmed = raw.trim()
    if (!trimmed) return // 빈 줄 제외
    const lineNo = i + 1
    const cols = trimmed.split(/\s*[,\t]\s*/)
    const [email, role, password, name] = cols
    if (cols.length < 3) {
      out.push({ lineNo, raw: trimmed, ok: false, error: '열 부족 — 이메일, 권한, 초기비번이 필요합니다.' })
      return
    }
    if (!isValidEmail(email)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: '이메일 형식 오류' })
      return
    }
    if (!isAccountRole(role)) {
      // 팀 열이 있던 옛 파일(이메일, 팀, 권한, 비번)을 그대로 붙여넣으면 팀 코드가 권한 자리에 온다 —
      // '알 수 없는 권한: PMO' 로는 무엇을 고칠지 모른다. 형식을 알려준다.
      if (cols.length >= 4 && isAccountRole(password)) {
        out.push({ lineNo, raw: trimmed, ok: false, email, error: '팀 열이 있는 옛 형식입니다. 이메일, 권한, 초기비번[, 이름] 순서로 바꾸세요.' })
        return
      }
      // 옛 권한 값을 조용히 흘리면 예전 일괄 등록 파일이 그대로 통과해 전원이 잘못된 권한으로 만들어진다.
      const hint = role === 'pmo_admin' || role === 'team_editor'
        ? ' — 옛 권한 값입니다. admin·member·viewer 로 바꾸세요.'
        : ''
      out.push({ lineNo, raw: trimmed, ok: false, email, error: `알 수 없는 권한: ${role}${hint}` })
      return
    }
    if (!isValidPassword(password)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: '비밀번호는 8자 이상이어야 합니다.' })
      return
    }
    out.push({
      lineNo, raw: trimmed, ok: true,
      email: email.trim(), role, password,
      name: name?.trim() || null,
    })
  })
  return out
}
