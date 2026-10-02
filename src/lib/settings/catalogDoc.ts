/** 설정 카탈로그의 자동 절. 값은 레지스트리와 메타데이터에서만 읽는다. */
import { REQUIRED_ON_CREATE, PROJECT_SETTINGS, WORKSPACE_SETTINGS, type SettingDef } from './registry'
import { CATALOG_META, PERSONAL_PREFS, PLANNED_KEYS, type CatalogMeta } from './catalog-meta'
import { OPERATIONAL_SETTINGS } from './operational'
import { settingsKo } from '@/lib/i18n/dict/settings'

const cols = ['설정 키', '스코프', '편집 주체', '편집 UI/API', '저장소', '기본값(출처)', '검증기', '소비처', '적용 시점', '기존 데이터 영향', '테스트', '현재 상태', '담당 SP']
const row = (cells: readonly string[]) => `| ${cells.map(cell => cell.replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`
const code = (value: string) => `\`${value}\``
const paths = (values: readonly string[]) => values.length ? values.map(code).join(', ') : '—'
const editor = { platform_admin: '플랫폼 관리자', workspace_admin: '워크스페이스 관리자', project_admin: '프로젝트 관리자' } as const
const scopeLabel = { workspace: '워크스페이스', project: '프로젝트' } as const
const impactLabel = { none: '없음', recompute: '파생 보기 재계산', future_only: '이후 작업부터', guarded: '기존 데이터 검사' } as const

function defaultText(def: SettingDef): string {
  if (def.default === REQUIRED_ON_CREATE) return '생성 시 필수'
  const value = JSON.stringify(def.default)
  return `${code(value ?? 'null')} (${def.deployDefault ? `배포 ${code(def.deployDefault.env)} → 제품 기본값` : '제품 기본값'})`
}

function settingRow(def: SettingDef, meta: CatalogMeta): string {
  const widget = def.widget.kind === 'custom' ? def.widget.component : def.widget.kind
  const label = settingsKo[`settings.${def.key}.label` as keyof typeof settingsKo] ?? def.key
  return row([
    `${code(def.key)}<br>${label}`, scopeLabel[def.scope], editor[def.editor], `${code(widget)} / ${code('update' + (def.scope === 'workspace' ? 'Workspace' : 'Project') + 'Settings')}`,
    '설정 JSON 문서', defaultText(def), `parse${def.scope === 'project' ? ' · validateProjectConfig' : ' · validateWorkspaceConfig'}${def.sql ? ` · SQL: ${def.sql.readers.join(', ')}` : ''}`,
    paths(meta.consumers), def.apply, def.impact.map(x => impactLabel[x]).join(', '), paths(meta.tests), meta.status, meta.sp,
  ])
}

function scopeSection(scope: 'workspace' | 'project'): string {
  const defs = scope === 'workspace' ? WORKSPACE_SETTINGS : PROJECT_SETTINGS
  const registered = defs.map(def => settingRow(def, CATALOG_META[def.key]))
  const planned = PLANNED_KEYS.filter(item => item.scope === scope).map(item => row([
    `${code(item.key)}<br>${item.shape}`, scopeLabel[scope], '—', '—', '미등록', '—', '—', '—', '—', '—', '—', 'planned', item.sp,
  ]))
  return [row(cols), row(cols.map(() => '---')), ...registered, ...planned].join('\n')
}

function operationalSection(): string {
  return [row(cols), row(cols.map(() => '---')), ...OPERATIONAL_SETTINGS.map(def => row([
    code(def.name), '플랫폼', def.editor, def.kind === 'table' ? code('/admin/llm-config') : '배포 환경',
    def.kind === 'table' ? 'DB 표' : def.kind, '운영자 설정', def.kind === 'table' ? '관리 화면·DB' : '배포 점검',
    paths(def.owner), def.apply, '—', '—', '운영 설정', 'SP3a',
  ]))].join('\n')
}

function personalSection(): string {
  return [row(cols), row(cols.map(() => '---')), ...PERSONAL_PREFS.map(pref => row([
    code(pref.key), `개인·${pref.scope}`, '본인', '계정·화면',
    pref.scope === '계정' ? '계정 개인 설정(자기 행)' : '워크스페이스 개인 설정(그 워크스페이스 행)', pref.desc, '개인 설정 API',
    '사용자 화면', 'immediate', '표시만', '—', 'stored', 'SP3b / SPU1',
  ]))].join('\n')
}

export function catalogAutoSections(): Readonly<Record<'1' | '2' | '4' | '5', string>> {
  return { '1': scopeSection('workspace'), '2': scopeSection('project'), '4': operationalSection(), '5': personalSection() }
}

export function replaceCatalogAutoSections(markdown: string): string {
  let next = markdown
  for (const [section, content] of Object.entries(catalogAutoSections())) {
    const start = `<!-- catalog:auto:${section}:start -->`
    const end = `<!-- catalog:auto:${section}:end -->`
    const from = next.indexOf(start)
    const to = next.indexOf(end)
    if (from < 0 || to < from || next.indexOf(start, from + start.length) >= 0 || next.indexOf(end, to + end.length) >= 0) {
      throw new Error(`카탈로그 자동 절 ${section}의 마커가 올바르지 않습니다.`)
    }
    next = `${next.slice(0, from + start.length)}\n${content}\n${next.slice(to)}`
  }
  return next
}
