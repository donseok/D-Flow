// 설정 표 직접 접근 게이트(개정 §2.11 ⑦, 스펙 §3.4) — service_role 은 쓰기 권한을 가지므로 서버 코드의 우회를 막는 유일한 게이트다(S8).
// tests 는 제외(tests/rls 는 거부를 단언하려고 일부러 쓴다). 목록에 있는데 쓰지 않는 파일도 실패다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const TABLES = ['project_settings', 'workspace_settings', 'project_settings_history', 'workspace_settings_history', 'authz_events'] as const
const RE = new RegExp(`from\\((['"\`])(${TABLES.join('|')})\\1\\)`, 'g')

/** 파일 → 허용 표와 사유 */
const ALLOW: Record<string, { tables: (typeof TABLES)[number][]; why: string }> = {
  'src/lib/settings/projectConfig.ts': { tables: ['project_settings'], why: '해석기 — 유일한 읽기 경로' },
  'src/lib/settings/workspaceConfig.ts': { tables: ['workspace_settings'], why: '해석기 — 유일한 읽기 경로' },
  'src/lib/settings/write.ts': { tables: ['project_settings'], why: 'revision 판독 뒤 RPC' },
  // src/lib/settings/history.ts(이력 읽기, D24)는 client.from(table) 로 표 이름을 변수로 넘긴다 — 이 정규식이 보지 못해 목록에 두면 죽은 예외다.
  // scripts/settings-verify.check.ts(전 행을 해석기로 검사)는 pg 로 SQL 을 보낸다 — from() 이 없다.
  'scripts/dev-bootstrap.mjs': { tables: ['workspace_settings'], why: 'revision 판독 뒤 apply_workspace_settings' },
  'scripts/e2e-local.mjs': { tables: ['project_settings', 'project_settings_history', 'workspace_settings'], why: '결과 확인 읽기, B 의 revision 판독 뒤 apply_workspace_settings' },
  // Phase D: 'src/lib/authz/events.ts': { tables: ['authz_events'], why: '권한 이력 읽기' },
}

/** 설정 RPC(개정 §2.11 ⑦) → 부르는 파일과 사유. 권한 RPC(set_platform_admin 등)는 이 게이트 밖이다. */
const RPCS = ['apply_project_settings', 'apply_workspace_settings', 'create_project_with_settings'] as const
const RPC_RE = new RegExp(`(['"\`])(${RPCS.join('|')})\\1`, 'g')
const RPC_ALLOW: Record<string, { rpcs: (typeof RPCS)[number][]; why: string }> = {
  'src/lib/settings/write.ts': { rpcs: ['apply_project_settings'], why: '서버 내부 쓰기 한 함수(W5 양식 저장·W6 골격 단계 이름)' },
  'src/app/actions/settings.ts': { rpcs: ['apply_project_settings', 'apply_workspace_settings'], why: '설정 액션 — 가드 뒤 RPC' },
  'src/app/actions/project.ts': { rpcs: ['create_project_with_settings'], why: 'createProject — requireWorkspaceAdmin 뒤 생성·복사' },
  'scripts/dev-bootstrap.mjs': { rpcs: ['apply_workspace_settings'], why: '부트스트랩 워크스페이스의 modules.allowed(로컬 전용)' },
  'scripts/e2e-local.mjs': { rpcs: ['apply_workspace_settings'], why: '워크스페이스 B 의 modules.allowed — 생성 화면(Phase C) 전이라 service_role(로컬 전용)' },
  'scripts/perf-baseline.mjs': { rpcs: ['create_project_with_settings'], why: 'PERF 프로젝트 시드(로컬 전용)' },
}

const files = [...walk('src'), ...walk('scripts', undefined, /\.(ts|tsx|mjs)$/)]
const hits = new Map<string, Set<string>>()
const rpcHits = new Map<string, Set<string>>()
for (const f of files) {
  const code = codeLines(readFileSync(f, 'utf8')).join('\n')
  for (const m of code.matchAll(RE)) (hits.get(f) ?? hits.set(f, new Set()).get(f)!).add(m[2])
  for (const m of code.matchAll(RPC_RE)) (rpcHits.get(f) ?? rpcHits.set(f, new Set()).get(f)!).add(m[2])
}

/** 허용 목록과 실측이 파일마다 정확히 같은지 — 다르면 "파일: 목록 / 실측" 줄 */
function staleEntries(allow: Record<string, readonly string[]>, got: Map<string, Set<string>>): string[] {
  const stale: string[] = []
  for (const [f, want] of Object.entries(allow)) {
    const g = [...(got.get(f) ?? [])].sort().join(',')
    if (g !== [...want].sort().join(',')) stale.push(`${f}: 목록 ${want.join(',')} / 실측 ${g || '(없음)'}`)
  }
  return stale
}

describe('settings-writes', () => {
  it('허용 목록 밖에서 설정 표 from() 이 0건이다', () => {
    const offenders = [...hits].filter(([f]) => !ALLOW[f]).map(([f, t]) => `${f}: ${[...t].join(', ')}`)
    expect(offenders, '설정은 해석기로 읽고 RPC 로 쓴다').toEqual([])
  })
  it('허용 목록의 파일은 적힌 표를 실제로 쓴다(죽은 예외 없음)', () => {
    expect(staleEntries(Object.fromEntries(Object.entries(ALLOW).map(([f, a]) => [f, a.tables])), hits)).toEqual([])
  })
  it('설정 RPC 는 허용 목록 밖에서 0건이고, 목록의 파일은 적힌 RPC 를 실제로 부른다', () => {
    const offenders = [...rpcHits].filter(([f]) => !RPC_ALLOW[f]).map(([f, r]) => `${f}: ${[...r].join(', ')}`)
    expect(offenders, '설정 쓰기는 설정 액션·내부 쓰기 한 함수·생성 액션을 지난다').toEqual([])
    expect(staleEntries(Object.fromEntries(Object.entries(RPC_ALLOW).map(([f, a]) => [f, a.rpcs])), rpcHits)).toEqual([])
  })
  it('옛 넓은 열 이름을 src·scripts 가 더는 쓰지 않는다', () => {
    // 새 키 문자열('core.level_labels'·'wbs.excel_profile' 등 — 레지스트리·사전·catalog-meta·validateConfig)은 옛 열이 아니다 — 앞의 네임스페이스로 뺀다
    const OLD = /(?<!\b(?:core|wbs|workflow|invites|calendar)\.)\b(level_labels|max_depth|milestone_keywords|excel_profile|extra_axis_label|enabled_modules|weekly_sections|working_days|preset_applied|stage_credits|allowed_domains)\b/
    // 외부 계약의 같은 이름 — GET /api/v1/wbs/structure 의 질의 인자 max_depth(스킬 계약, 2026-09-28 실측 2줄)는 옛 열이 아니다.
    // OLD 에서 max_depth 를 빼면 다른 파일의 옛 열 접근까지 놓치므로 그 파일에서만 이 단어를 지우고 본다
    const CONTRACT_TERMS: Record<string, RegExp> = { 'src/app/api/v1/wbs/structure/route.ts': /\bmax_depth\b/g }
    const offenders: string[] = []
    for (const f of files) {
      if (f.startsWith('scripts/lib/baseline') || f.startsWith('scripts/baseline-dump')) continue   // 기준선 도구는 옛 스키마를 읽는다
      const lines = codeLines(readFileSync(f, 'utf8'))
      lines.forEach((raw, i) => {
        const l = CONTRACT_TERMS[f] ? raw.replace(CONTRACT_TERMS[f], '') : raw
        if (OLD.test(l) && !/max_depth:|maxDepth/.test(l)) offenders.push(`${f}:${i + 1}: ${raw.trim()}`)
      })
    }
    // 외부 API 응답 필드 max_depth(스킬 계약)와 코드의 maxDepth 는 예외 — 위 필터가 뺀다
    expect(offenders).toEqual([])
  })
})
