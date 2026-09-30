import { redirect } from 'next/navigation'
import { Settings2, Palette, Mail, Menu, History } from 'lucide-react'
import { listSettingsHistory } from '@/app/actions/settings'
import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { ModuleAllowEditor } from '@/components/settings/ModuleAllowEditor'
import { LogoEditor } from '@/components/settings/LogoEditor'
import { AccentEditor } from '@/components/settings/AccentEditor'
import { MenuOrderEditor } from '@/components/settings/MenuOrderEditor'
import { SettingsHistoryList } from '@/components/settings/SettingsHistoryList'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { WorkspaceFieldsEditor, type WorkspaceField, type SimpleWorkspaceKey } from '@/components/settings/WorkspaceFieldsEditor'
import { SectionCard } from '@/components/ui/SectionCard'
import { getServerLocale } from '@/lib/i18n/server'

const SIMPLE: Record<SimpleWorkspaceKey, Omit<WorkspaceField, 'key' | 'value' | 'source' | 'error'>> = {
  'branding.product_name': { label: '제품 이름', description: '워크스페이스의 제품 이름입니다.', kind: 'text' },
  'branding.mail_from_name': { label: '메일 발신 이름', description: '비우면 제품 이름을 사용합니다.', kind: 'text' },
  'ai.enabled': { label: 'AI 기능', description: '워크스페이스의 AI 기능 사용 여부입니다.', kind: 'boolean' },
  'invites.allowed_domains': { label: '초대 허용 도메인', description: '한 줄에 한 도메인을 적습니다. 비우면 새 초대를 허용하지 않습니다. * 단독 입력은 모든 도메인을 허용합니다.', kind: 'domains' },
}

function field(config: Awaited<ReturnType<typeof getWorkspaceConfig>>, key: SimpleWorkspaceKey): WorkspaceField {
  const state = config.keys[key]
  const kind = SIMPLE[key].kind
  const valid = state.status === 'set' || state.status === 'default'
  const raw = valid ? state.value : null
  const value = kind === 'boolean' ? raw === true : kind === 'domains' ? (Array.isArray(raw) ? raw.join('\n') : '') : (typeof raw === 'string' ? raw : '')
  const source = state.status === 'set' ? '워크스페이스 설정' : state.status === 'default' ? (state.from === 'deploy' ? '배포 기본값' : '제품 기본값') : '설정 손상'
  return { key, ...SIMPLE[key], value, source, error: state.status === 'invalid' ? state.error : undefined }
}

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await workspacePageAccess(slug)
  if (!access.isAdmin) redirect('/projects')
  const locale = await getServerLocale()
  let config: Awaited<ReturnType<typeof getWorkspaceConfig>>
  try {
    config = await getWorkspaceConfig(access.id)
  } catch (error) {
    if (!(error instanceof ConfigUnavailableError)) throw error
    console.error('[workspace settings] 설정 조회 실패:', { workspaceId: access.id, cause: error.message })
    return <ConfigLoadError locale={locale} error="워크스페이스 설정을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요." />
  }

  const allowed = config.keys['modules.allowed']
  const history = await listSettingsHistory({ workspaceId: access.id })
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-20">
      <div>
        <p className="eyebrow">Workspace settings</p>
        <h1 className="mt-1 text-2xl font-bold text-ink">{access.name} 설정</h1>
      </div>
      <SettingsShell items={[
        { id: 'workspace-general', label: '일반' }, { id: 'workspace-modules', label: '모듈·AI' },
        { id: 'workspace-invites', label: '초대' }, { id: 'workspace-menu', label: '메뉴' },
        { id: 'workspace-history', label: '기록' },
      ]}>
      <SectionCard id="workspace-general" searchText="branding.product_name branding.mail_from_name branding.logo branding.accent" eyebrow="일반" title="이름과 메일" icon={Palette}>
        <div className="space-y-6">
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision}
            fields={[field(config, 'branding.product_name'), field(config, 'branding.mail_from_name')]} />
          <LogoEditor workspaceId={access.id} revision={config.revision}
            initialLogo={config.keys['branding.logo'].status === 'set' || config.keys['branding.logo'].status === 'default' ? config.keys['branding.logo'].value : null}
            invalidReason={config.keys['branding.logo'].status === 'invalid' ? config.keys['branding.logo'].error : undefined} />
          <AccentEditor workspaceId={access.id} revision={config.revision}
            initialAccent={config.keys['branding.accent'].status === 'set' || config.keys['branding.accent'].status === 'default' ? config.keys['branding.accent'].value : null}
            invalidReason={config.keys['branding.accent'].status === 'invalid' ? config.keys['branding.accent'].error : undefined} />
        </div>
      </SectionCard>
      <SectionCard id="workspace-modules" searchText={access.isSuperuser ? 'modules.allowed ai.enabled' : 'ai.enabled'}
        eyebrow="모듈·AI" title={access.isSuperuser ? '모듈 사용 범위' : 'AI 사용'} icon={Settings2}>
        <div className="space-y-5">
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} fields={[field(config, 'ai.enabled')]} />
          {access.isSuperuser ? (
            <ModuleAllowEditor workspaceId={access.id} revision={config.revision}
              initialAllowed={allowed.status === 'set' || allowed.status === 'default' ? allowed.value : null}
              invalidReason={allowed.status === 'invalid' ? allowed.error : undefined} />
          ) : null}
        </div>
      </SectionCard>
      <SectionCard id="workspace-invites" searchText="invites.allowed_domains" eyebrow="초대" title="초대 정책" icon={Mail}>
        <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} fields={[field(config, 'invites.allowed_domains')]} />
      </SectionCard>
      <SectionCard id="workspace-menu" searchText="navigation.menu" eyebrow="메뉴" title="메뉴 순서와 이름" icon={Menu}>
        <MenuOrderEditor workspaceId={access.id} revision={config.revision}
          initialMenu={config.keys['navigation.menu'].status === 'set' || config.keys['navigation.menu'].status === 'default' ? config.keys['navigation.menu'].value : null}
          invalidReason={config.keys['navigation.menu'].status === 'invalid' ? config.keys['navigation.menu'].error : undefined} />
      </SectionCard>
      <SectionCard id="workspace-history" searchText="settings history revision 기록 이력" eyebrow="기록" title="설정 변경 이력" icon={History}>
        <SettingsHistoryList scope={{ workspaceId: access.id }} initial={history} />
      </SectionCard>
      </SettingsShell>
    </div>
  )
}
