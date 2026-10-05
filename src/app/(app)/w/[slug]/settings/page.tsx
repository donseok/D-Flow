import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Settings2, Palette, Mail, Menu, History, CalendarDays, Paperclip, FolderTree, KeyRound } from 'lucide-react'
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
import { SettingsHistoryList } from '@/components/settings/SettingsHistoryList'
import { AuthzEventsList } from '@/components/settings/AuthzEventsList'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { WorkspaceFieldsEditor, type WorkspaceField, type SimpleWorkspaceKey } from '@/components/settings/WorkspaceFieldsEditor'
import { SectionCard } from '@/components/ui/SectionCard'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { CalendarSettingsPanel } from '@/components/settings/CalendarSettingsPanel'
import { AttachmentPolicyEditor } from '@/components/settings/AttachmentPolicyEditor'
import { RootFoldersEditor } from '@/components/settings/RootFoldersEditor'
import { parseAttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { t } from '@/lib/i18n/dict'
import { workspaceCalendarFieldsOf } from '@/lib/settings/calendarField'
import { todayIn } from '@/lib/domain/calendar'
import { getServerLocale } from '@/lib/i18n/server'

export const metadata = { title: '설정' }   // 레이아웃 템플릿이 '설정 · {워크스페이스} | {제품}' 을 만든다(V6)

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
  if (!access.isAdmin) redirect(wsHref(access.slug))
  const locale = await getServerLocale()
  const pageTitle = locale === 'ko' ? '워크스페이스 설정' : 'Workspace settings'      // 프로젝트 설정 머리와 같은 로케일 갈래(u3-3 리뷰 P2-9)
  let config: Awaited<ReturnType<typeof getWorkspaceConfig>>
  try {
    config = await getWorkspaceConfig(access.id)
  } catch (error) {
    if (!(error instanceof ConfigUnavailableError)) throw error
    console.error('[workspace settings] 설정 조회 실패:', { workspaceId: access.id, cause: error.message })
    return <PageFrame header={<PageHeader title={pageTitle} meta={access.name} />}>
      <ConfigLoadError locale={locale} error="워크스페이스 설정을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요." />
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
        { id: 'workspace-general', label: '일반' }, { id: 'workspace-modules', label: '모듈·AI' },
        { id: 'workspace-invites', label: '초대' }, { id: 'workspace-calendar', label: '달력' }, { id: 'workspace-minutes', label: '회의록' }, { id: 'workspace-minute-roots', label: '회의록 폴더' }, { id: 'workspace-menu', label: '메뉴' },
        { id: 'workspace-history', label: '기록' },
      ]}>
      <SectionCard id="workspace-general" searchText="branding.product_name branding.mail_from_name branding.logo branding.accent" eyebrow="일반" title="이름과 메일" icon={Palette}>
        <div className="space-y-6">
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} locale={locale}
            fields={[field(config, 'branding.product_name'), field(config, 'branding.mail_from_name')]} />
          <LogoEditor workspaceId={access.id} revision={config.revision}
            initialLogo={config.keys['branding.logo'].status === 'set' || config.keys['branding.logo'].status === 'default' ? config.keys['branding.logo'].value : null}
            invalidReason={config.keys['branding.logo'].status === 'invalid' ? config.keys['branding.logo'].error : undefined} />
          <AccentEditor workspaceId={access.id} revision={config.revision}
            initialAccent={config.keys['branding.accent'].status === 'set' || config.keys['branding.accent'].status === 'default' ? config.keys['branding.accent'].value : null}
            invalidReason={config.keys['branding.accent'].status === 'invalid' ? config.keys['branding.accent'].error : undefined} />
        </div>
      </SectionCard>
      <SectionCard id="workspace-modules" searchText={access.isSuperuser ? 'modules.allowed ai.enabled integrations api 연동 자격증명' : 'ai.enabled integrations api 연동 자격증명'}
        eyebrow="모듈·AI" title={access.isSuperuser ? '모듈 사용 범위' : 'AI 사용'} icon={Settings2}>
        <div className="space-y-5">
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} locale={locale} fields={[field(config, 'ai.enabled')]} />
          {access.isSuperuser ? (
            <ModuleAllowEditor workspaceId={access.id} revision={config.revision} locale={locale}
              initialAllowed={allowed.status === 'set' || allowed.status === 'default' ? allowed.value : null}
              invalidReason={allowed.status === 'invalid' ? allowed.error : undefined}
              requiredMissing={allowed.status === 'required_missing'} />
          ) : null}
          <div className="border-t border-line pt-4">
            <h4 className="text-sm font-semibold text-ink">외부 연동 자격증명</h4>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              회의록 자동 등록(v3 API) 및 에이전트 워크스페이스 권한을 위한 API 토큰을 발급하고 관리합니다.
            </p>
            <div className="mt-3">
              <Link
                href={wsHref(access.slug, 'settings/integrations')}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover hover:border-line-strong transition-colors shadow-xs"
              >
                <KeyRound className="size-3.5 text-ink-muted" />
                연동 자격증명 관리 바로가기
              </Link>
            </div>
          </div>
        </div>
      </SectionCard>
      <SectionCard id="workspace-invites" searchText="invites.allowed_domains" eyebrow="초대" title="초대 정책" icon={Mail}>
        <div className="space-y-4">
          <WorkspaceFieldsEditor workspaceId={access.id} revision={config.revision} locale={locale} fields={[field(config, 'invites.allowed_domains')]} />
          {/* 공용 팀은 그 워크스페이스 관리자가 연다(SP3b D22) — 이 화면은 관리자만 들어오므로(위 redirect) 링크가 튕기지 않는다. */}
          <p className="text-sm text-ink-muted">공용 팀 기준정보는 <Link href={wsHref(access.slug, 'admin/teams')} className="font-medium text-brand underline">공용 팀 관리</Link>에서 편집합니다.</p>
        </div>
      </SectionCard>
      <SectionCard id="workspace-calendar" searchText="calendar.working_days calendar.timezone calendar.week_start 달력 시간대 근무 요일 주 시작"
        eyebrow="달력" title="시간대·근무 요일·주 시작" icon={CalendarDays}>
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">워크스페이스 화면(내 회의·회의록 등)의 오늘 날짜와 달력이 이 값을 따르고, 새 프로젝트를 만들 때 초기값으로 복사됩니다. 이미 있는 프로젝트는 바뀌지 않습니다.</p>
          {/* 이 페이지는 워크스페이스 관리자만 들인다(access.isAdmin 아니면 redirect) — 키 정의의 editor 도 workspace_admin 이라 액션이 다시 판정한다 */}
          <CalendarSettingsPanel scope={{ workspaceId: access.id }} revision={config.revision} todayIso={calendarToday} locale={locale}
            canEdit suggestBrowserTimezone {...calendarFields} />
        </div>
      </SectionCard>
      <SectionCard id="workspace-minutes" searchText="minutes.attachments 회의록 첨부 정책 용량 개수 형식 미리보기" eyebrow="회의록" title={t(locale, 'settings.minutes.attachments.label')} icon={Paperclip}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">{t(locale, 'settings.minutes.attachments.desc')}</p>
        {/* 이 페이지는 워크스페이스 관리자만 들인다 — 키 정의의 editor 도 workspace_admin 이라 액션이 다시 판정한다 */}
        <AttachmentPolicyEditor key={`${access.id}-${config.revision}`} scope={{ workspaceId: access.id }} revision={config.revision} canEdit
          policy={attPolicy} invalid={attPolicy === null} />
      </SectionCard>
      <SectionCard id="workspace-minute-roots" searchText="minutes.root_folders 회의록 최상위 폴더 팀 폴더" eyebrow="회의록 폴더" title={t(locale, 'settings.minutes.root_folders.label')} icon={FolderTree}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">{t(locale, 'settings.minutes.root_folders.desc')}</p>
        <RootFoldersEditor key={`${access.id}-${config.revision}`} workspaceId={access.id} revision={config.revision} canEdit={access.isSuperuser}
          value={rootFolders} invalid={rootFolders === null} />
      </SectionCard>
      <SectionCard id="workspace-menu" searchText="navigation.menu portal.widgets 홈 위젯" eyebrow="메뉴" title="메뉴 순서와 이름" icon={Menu}>
        <MenuOrderEditor workspaceId={access.id} revision={config.revision}
          initialMenu={config.keys['navigation.menu'].status === 'set' || config.keys['navigation.menu'].status === 'default' ? config.keys['navigation.menu'].value : null}
          invalidReason={config.keys['navigation.menu'].status === 'invalid' ? config.keys['navigation.menu'].error : undefined} />
        {/* 홈 위젯(portal.widgets — SP3b UI-3 W20) — 같은 '메뉴' 범주 안 구역(목차 항목을 늘리지 않는다) */}
        <section aria-labelledby="workspace-portal-widgets" data-settings-search="portal.widgets 홈 위젯" className="mt-8 border-t border-border pt-6">
          <h4 id="workspace-portal-widgets" className="mb-3 text-sm font-semibold text-fg">홈 위젯</h4>
          <PortalWidgetsEditor workspaceId={access.id} revision={config.revision}
            initial={config.keys['portal.widgets'].status === 'set' || config.keys['portal.widgets'].status === 'default' ? config.keys['portal.widgets'].value : null}
            invalidReason={config.keys['portal.widgets'].status === 'invalid' ? config.keys['portal.widgets'].error : undefined} />
        </section>
      </SectionCard>
      <SectionCard id="workspace-history" searchText="settings history revision authz 기록 이력 설정 변경 권한 변경" eyebrow="기록" title="변경 이력" icon={History}>
        <div className="space-y-8">
          <section aria-label="설정 변경">
            <h4 className="mb-3 text-sm font-semibold text-ink">설정 변경</h4>
            {historyCal.ok
              ? <SettingsHistoryList scope={{ workspaceId: access.id }} initial={history} timeZone={historyCal.calendar.timezone} />
              : historyCalError}
          </section>
          <section aria-label="권한 변경" className="border-t border-line pt-6">
            <h4 className="mb-1 text-sm font-semibold text-ink">권한 변경</h4>
            <p className="mb-3 text-xs text-ink-muted">누가 누구의 권한을 바꿨는지 남는 기록입니다.{access.isSuperuser ? ' 플랫폼 관리자 지정·해제도 함께 보입니다.' : ''}</p>
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
