import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Settings2, Palette, Mail, Menu, History, CalendarDays, Paperclip, FolderTree, KeyRound, ShieldCheck, Bell } from 'lucide-react'
import { listSettingsHistory } from '@/app/actions/settings'
import { listAuthzEvents } from '@/app/actions/authzEvents'
import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'
import { wsHref } from '@/lib/workspace/paths'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { pickCalendar } from '@/lib/settings/pick'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { ModuleAllowEditor } from '@/components/settings/ModuleAllowEditor'
import { LogoEditor } from '@/components/settings/LogoEditor'
import { AccentEditor } from '@/components/settings/AccentEditor'
import { MenuOrderEditor } from '@/components/settings/MenuOrderEditor'
import { PortalWidgetsEditor } from '@/components/settings/PortalWidgetsEditor'
import { LocalDraftsEditor } from '@/components/settings/LocalDraftsEditor'
import { NotifyPolicyEditor } from '@/components/settings/NotifyPolicyEditor'
import { SettingsHistoryList } from '@/components/settings/SettingsHistoryList'
import { AuthzEventsList } from '@/components/settings/AuthzEventsList'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { WorkspaceFieldsEditor, type WorkspaceField, type SimpleWorkspaceKey } from '@/components/settings/WorkspaceFieldsEditor'
import { WorkspaceNameEditor } from '@/components/settings/WorkspaceNameEditor'
import { SectionCard } from '@/components/ui/SectionCard'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { CalendarSettingsPanel } from '@/components/settings/CalendarSettingsPanel'
import { AttachmentPolicyEditor } from '@/components/settings/AttachmentPolicyEditor'
import { RootFoldersEditor } from '@/components/settings/RootFoldersEditor'
import { parseAttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { workspaceCalendarFieldsOf } from '@/lib/settings/calendarField'
import { todayIn } from '@/lib/domain/calendar'
import { getServerLocale } from '@/lib/i18n/server'

/** 탭 제목 — 화면 언어를 따른다(ko 는 종전의 '설정') */
export async function generateMetadata() { return { title: t(await getServerLocale(), 'nav.settings') } }   // 레이아웃 템플릿이 '설정 · {워크스페이스} | {제품}' 을 만든다(V6)

const SIMPLE: Record<SimpleWorkspaceKey, { label: DictKey; description: DictKey; kind: WorkspaceField['kind'] }> = {
  'branding.product_name': { label: 'pages.wsSettings.field.productName.label', description: 'pages.wsSettings.field.productName.desc', kind: 'text' },
  'branding.mail_from_name': { label: 'pages.wsSettings.field.mailFromName.label', description: 'pages.wsSettings.field.mailFromName.desc', kind: 'text' },
  'ai.enabled': { label: 'pages.wsSettings.field.aiEnabled.label', description: 'pages.wsSettings.field.aiEnabled.desc', kind: 'boolean' },
  'invites.allowed_domains': { label: 'pages.wsSettings.field.inviteDomains.label', description: 'pages.wsSettings.field.inviteDomains.desc', kind: 'domains' },
}

function field(config: Awaited<ReturnType<typeof getWorkspaceConfig>>, key: SimpleWorkspaceKey, locale: Locale): WorkspaceField {
  const state = config.keys[key]
  const kind = SIMPLE[key].kind
  const valid = state.status === 'set' || state.status === 'default'
  const raw = valid ? state.value : null
  const value = kind === 'boolean' ? raw === true : kind === 'domains' ? (Array.isArray(raw) ? raw.join('\n') : '') : (typeof raw === 'string' ? raw : '')
  const source = state.status === 'set' ? 'workspace' : state.status === 'default' ? (state.from === 'deploy' ? 'deploy' : 'product') : 'corrupted'
  return { key, label: t(locale, SIMPLE[key].label), description: t(locale, SIMPLE[key].description), kind, value, source, error: state.status === 'invalid' ? state.error : undefined }
}

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await workspacePageAccess(slug)
  if (!access.isAdmin) redirect(wsHref(access.slug))
  const locale = await getServerLocale()
  const pageTitle = t(locale, 'pages.wsSettings.title')      // 프로젝트 설정 머리와 같은 로케일 갈래(u3-3 리뷰 P2-9)
  let config: Awaited<ReturnType<typeof getWorkspaceConfig>>
  try {
    config = await getWorkspaceConfig(access.id)
  } catch (error) {
    if (!(error instanceof ConfigUnavailableError)) throw error
    console.error('[workspace settings] 설정 조회 실패:', { workspaceId: access.id, cause: error.message })
    return <PageFrame header={<PageHeader title={pageTitle} meta={access.name} />}>
      <ConfigLoadError locale={locale} error={t(locale, 'pages.wsSettings.loadFailed')} />
    </PageFrame>
  }

  const allowed = config.keys['modules.allowed']
  // 회의록 첨부 정책(SP5 B3 과제9) — 손상 값도 편집기를 그린다(복구 경로). 저장 값의 재검증은 편집기와 같은 순수 파서.
  const attState = config.keys['minutes.attachments']
  const attParsed = attState.status === 'set' || attState.status === 'default' ? parseAttachmentPolicy(attState.value) : null
  const attPolicy = attParsed?.ok ? attParsed.value : null
  // 최상위 폴더 모드(SP5 B2) — 상태 그대로(손상은 invalid). 화면은 teams 만 고르게 하고 되돌리기는 플랫폼 관리자만(D21)
  const rootState = config.keys['minutes.root_folders']
  const rootFolders = rootState.status === 'set' || rootState.status === 'default' ? rootState.value : null
  // 달력 절(스펙 D36·§5.1 A 둘째 행) — 손상 키도 편집기를 그린다(복구 경로). '오늘'은 tz 가 유효할 때만
  const calendarFields = workspaceCalendarFieldsOf(config.keys)
  const calendarToday = calendarFields.timezone.value ? todayIn(calendarFields.timezone.value, new Date()) : null
  const [history, authzEvents] = await Promise.all([listSettingsHistory({ workspaceId: access.id }), listAuthzEvents(access.id)])
  // 이력 시각의 tz = 워크스페이스 달력. 손상이면 이력 칸에만 사유를 그린다 — 달력을 고치는 화면이 이 페이지다(계획 D-21a)
  const historyCal = pickCalendar(config)
  const historyCalError = historyCal.ok ? null
    : <ConfigLoadError error={historyCal.error} keyName={historyCal.key} kind={historyCal.kind} locale={locale} />
  return (
    // 머리 하나(PageHeader — 개정 §5.9.3). 본문 폭 800·저장 바 예약은 SettingsShell 이 맡는다(SP3b 스펙 §6.4)
    <PageFrame header={<PageHeader title={pageTitle} meta={access.name} />}>
      <SettingsShell items={[
        { id: 'workspace-general', label: t(locale, 'pages.settingsNav.general') }, { id: 'workspace-modules', label: t(locale, 'pages.wsSettings.nav.modulesAi') },
        { id: 'workspace-invites', label: t(locale, 'pages.wsSettings.nav.invites') }, { id: 'workspace-calendar', label: t(locale, 'pages.settingsNav.calendar') }, { id: 'workspace-minutes', label: t(locale, 'pages.settingsNav.minutes') }, { id: 'workspace-minute-roots', label: t(locale, 'pages.wsSettings.nav.minuteRoots') }, { id: 'workspace-menu', label: t(locale, 'pages.wsSettings.nav.menu') }, { id: 'workspace-notify', label: t(locale, 'pages.wsSettings.nav.notify') }, { id: 'workspace-security', label: t(locale, 'pages.wsSettings.nav.security') },
        { id: 'workspace-history', label: t(locale, 'pages.settingsNav.history') },
      ]}>
      <SectionCard id="workspace-general" searchText="workspace name branding.product_name branding.mail_from_name branding.logo branding.accent" eyebrow={t(locale, 'pages.settingsNav.general')} title={t(locale, 'pages.wsSettings.generalTitle')} icon={Palette}>
        <div className="space-y-6">
          {/* 워크스페이스 이름 — 설정 키가 아니라 워크스페이스 행의 이름이다(0055 rename_workspace). 주소(slug)는 바뀌지 않는다 */}
          <WorkspaceNameEditor key={access.name} workspaceId={access.id} slug={access.slug} initialName={access.name} />
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} locale={locale}
            fields={[field(config, 'branding.product_name', locale), field(config, 'branding.mail_from_name', locale)]} />
          <LogoEditor workspaceId={access.id} revision={config.revision}
            initialLogo={config.keys['branding.logo'].status === 'set' || config.keys['branding.logo'].status === 'default' ? config.keys['branding.logo'].value : null}
            invalidReason={config.keys['branding.logo'].status === 'invalid' ? config.keys['branding.logo'].error : undefined} />
          <AccentEditor workspaceId={access.id} revision={config.revision}
            initialAccent={config.keys['branding.accent'].status === 'set' || config.keys['branding.accent'].status === 'default' ? config.keys['branding.accent'].value : null}
            invalidReason={config.keys['branding.accent'].status === 'invalid' ? config.keys['branding.accent'].error : undefined} />
        </div>
      </SectionCard>
      <SectionCard id="workspace-modules" searchText={access.isSuperuser ? 'modules.allowed ai.enabled integrations api 연동 자격증명' : 'ai.enabled integrations api 연동 자격증명'}
        eyebrow={t(locale, 'pages.wsSettings.nav.modulesAi')} title={t(locale, access.isSuperuser ? 'pages.wsSettings.modulesTitleSuperuser' : 'pages.wsSettings.modulesTitle')} icon={Settings2}>
        <div className="space-y-5">
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} locale={locale} fields={[field(config, 'ai.enabled', locale)]} />
          {access.isSuperuser ? (
            <ModuleAllowEditor workspaceId={access.id} revision={config.revision} locale={locale}
              initialAllowed={allowed.status === 'set' || allowed.status === 'default' ? allowed.value : null}
              invalidReason={allowed.status === 'invalid' ? allowed.error : undefined}
              requiredMissing={allowed.status === 'required_missing'} />
          ) : null}
          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-fg">{t(locale, 'pages.wsSettings.integrationsTitle')}</h4>
            <p className="mt-1 text-xs leading-5 text-fg-secondary">
              {t(locale, 'pages.wsSettings.integrationsDesc')}
            </p>
            <div className="mt-3">
              <Link
                href={wsHref(access.slug, 'settings/integrations')}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover hover:border-border-input transition-colors shadow-xs"
              >
                <KeyRound className="size-3.5 text-fg-secondary" />
                {t(locale, 'pages.wsSettings.integrationsLink')}
              </Link>
            </div>
          </div>
        </div>
      </SectionCard>
      <SectionCard id="workspace-invites" searchText="invites.allowed_domains" eyebrow={t(locale, 'pages.wsSettings.nav.invites')} title={t(locale, 'pages.wsSettings.invitesTitle')} icon={Mail}>
        <div className="space-y-4">
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} locale={locale} fields={[field(config, 'invites.allowed_domains', locale)]} />
          {/* 공용 팀은 그 워크스페이스 관리자가 연다(SP3b D22) — 이 화면은 관리자만 들어오므로(위 redirect) 링크가 튕기지 않는다. */}
          <p className="text-sm text-fg-secondary">{t(locale, 'pages.wsSettings.teamsHintPre')}<Link href={wsHref(access.slug, 'admin/teams')} className="font-medium text-action underline">{t(locale, 'pages.wsSettings.teamsHintLink')}</Link>{t(locale, 'pages.wsSettings.teamsHintPost')}</p>
        </div>
      </SectionCard>
      <SectionCard id="workspace-calendar" searchText="calendar.working_days calendar.timezone calendar.week_start 달력 시간대 근무 요일 주 시작"
        eyebrow={t(locale, 'pages.settingsNav.calendar')} title={t(locale, 'pages.wsSettings.calendarTitle')} icon={CalendarDays}>
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">{t(locale, 'pages.wsSettings.calendarDesc')}</p>
          {/* 이 페이지는 워크스페이스 관리자만 들인다(access.isAdmin 아니면 redirect) — 키 정의의 editor 도 workspace_admin 이라 액션이 다시 판정한다 */}
          <CalendarSettingsPanel scope={{ workspaceId: access.id }} revision={config.revision} todayIso={calendarToday} locale={locale}
            canEdit suggestBrowserTimezone {...calendarFields} />
        </div>
      </SectionCard>
      <SectionCard id="workspace-minutes" searchText="minutes.attachments 회의록 첨부 정책 용량 개수 형식 미리보기" eyebrow={t(locale, 'pages.settingsNav.minutes')} title={t(locale, 'settings.minutes.attachments.label')} icon={Paperclip}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t(locale, 'settings.minutes.attachments.desc')}</p>
        {/* 이 페이지는 워크스페이스 관리자만 들인다 — 키 정의의 editor 도 workspace_admin 이라 액션이 다시 판정한다 */}
        <AttachmentPolicyEditor key={`${access.id}-${config.revision}`} scope={{ workspaceId: access.id }} revision={config.revision} canEdit
          policy={attPolicy} invalid={attPolicy === null} />
      </SectionCard>
      <SectionCard id="workspace-minute-roots" searchText="minutes.root_folders 회의록 최상위 폴더 팀 폴더" eyebrow={t(locale, 'pages.wsSettings.nav.minuteRoots')} title={t(locale, 'settings.minutes.root_folders.label')} icon={FolderTree}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t(locale, 'settings.minutes.root_folders.desc')}</p>
        <RootFoldersEditor key={`${access.id}-${config.revision}`} workspaceId={access.id} revision={config.revision} canEdit={access.isSuperuser}
          value={rootFolders} invalid={rootFolders === null} />
      </SectionCard>
      <SectionCard id="workspace-menu" searchText="navigation.menu portal.widgets 홈 위젯" eyebrow={t(locale, 'pages.wsSettings.nav.menu')} title={t(locale, 'pages.wsSettings.menuTitle')} icon={Menu}>
        <MenuOrderEditor workspaceId={access.id} revision={config.revision}
          initialMenu={config.keys['navigation.menu'].status === 'set' || config.keys['navigation.menu'].status === 'default' ? config.keys['navigation.menu'].value : null}
          invalidReason={config.keys['navigation.menu'].status === 'invalid' ? config.keys['navigation.menu'].error : undefined} />
        {/* 홈 위젯(portal.widgets — SP3b UI-3 W20) — 같은 '메뉴' 범주 안 구역(목차 항목을 늘리지 않는다) */}
        <section aria-labelledby="workspace-portal-widgets" data-settings-search="portal.widgets 홈 위젯" className="mt-8 border-t border-border pt-6">
          <h4 id="workspace-portal-widgets" className="mb-3 text-sm font-semibold text-fg">{t(locale, 'settings.portal.widgets.label')}</h4>
          <PortalWidgetsEditor workspaceId={access.id} revision={config.revision}
            initial={config.keys['portal.widgets'].status === 'set' || config.keys['portal.widgets'].status === 'default' ? config.keys['portal.widgets'].value : null}
            invalidReason={config.keys['portal.widgets'].status === 'invalid' ? config.keys['portal.widgets'].error : undefined} />
        </section>
      </SectionCard>
      {/* 관리자 알림 정책(notify.policy — 개정 §4.10). 끈 유형은 이 워크스페이스에서 발행되지 않는다. 개인 토글(/account)은 그 뒤 조회 시점 필터 */}
      <SectionCard id="workspace-notify" searchText="notify.policy 알림 정책 알림 유형 발행" eyebrow={t(locale, 'pages.wsSettings.nav.notify')} title={t(locale, 'settings.notify.policy.label')} icon={Bell}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t(locale, 'settings.notify.policy.desc')}</p>
        <NotifyPolicyEditor workspaceId={access.id} revision={config.revision}
          initial={config.keys['notify.policy'].status === 'set' || config.keys['notify.policy'].status === 'default' ? config.keys['notify.policy'].value : null}
          invalidReason={config.keys['notify.policy'].status === 'invalid' ? config.keys['notify.policy'].error : undefined} />
      </SectionCard>
      {/* 보안 제한(개정 §2.9 워크스페이스 전역 키) — 로컬 초안 정책(security.local_drafts, §5.8.5). 모든 편집 화면이 이 값을 따른다 */}
      <SectionCard id="workspace-security" searchText="security.local_drafts 로컬 초안 보존 기간 보안" eyebrow={t(locale, 'pages.wsSettings.nav.security')} title={t(locale, 'settings.security.local_drafts.label')} icon={ShieldCheck}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t(locale, 'settings.security.local_drafts.desc')}</p>
        <LocalDraftsEditor workspaceId={access.id} revision={config.revision}
          initial={config.keys['security.local_drafts'].status === 'set' || config.keys['security.local_drafts'].status === 'default' ? config.keys['security.local_drafts'].value : null}
          invalidReason={config.keys['security.local_drafts'].status === 'invalid' ? config.keys['security.local_drafts'].error : undefined} />
      </SectionCard>
      <SectionCard id="workspace-history" searchText="settings history revision authz 기록 이력 설정 변경 권한 변경" eyebrow={t(locale, 'pages.settingsNav.history')} title={t(locale, 'pages.wsSettings.historyTitle')} icon={History}>
        <div className="space-y-8">
          <section aria-label={t(locale, 'pages.wsSettings.settingsChanges')}>
            <h4 className="mb-3 text-sm font-semibold text-fg">{t(locale, 'pages.wsSettings.settingsChanges')}</h4>
            {historyCal.ok
              ? <SettingsHistoryList scope={{ workspaceId: access.id }} initial={history} timeZone={historyCal.calendar.timezone} />
              : historyCalError}
          </section>
          <section aria-label={t(locale, 'pages.wsSettings.authzChanges')} className="border-t border-border pt-6">
            <h4 className="mb-1 text-sm font-semibold text-fg">{t(locale, 'pages.wsSettings.authzChanges')}</h4>
            <p className="mb-3 text-xs text-fg-secondary">{t(locale, 'pages.wsSettings.authzDesc')}{access.isSuperuser ? t(locale, 'pages.wsSettings.authzDescSuperuser') : ''}</p>
            {historyCal.ok
              ? <AuthzEventsList workspaceId={access.id} initial={authzEvents} timeZone={historyCal.calendar.timezone} />
              : historyCalError}
          </section>
        </div>
      </SectionCard>
      </SettingsShell>
    </PageFrame>
  )
}
