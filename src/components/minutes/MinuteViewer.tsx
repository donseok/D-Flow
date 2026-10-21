'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { DocumentVersionStatus } from '@/components/doc/DocumentVersionStatus'
import { useMinuteLinks } from './minuteLinks'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, Download, ExternalLink, FolderOpen, History, Maximize2, Minimize2,
  Share2,
} from 'lucide-react'
import type {
  InsightKind, Minute, MinuteFile, MinuteHighlight, MinuteInsight, ProjectMember,
} from '@/lib/domain/types'
import {
  MINUTE_BODY_FILE_MAX, MINUTE_BODY_MAX, stampedFileName,
} from '@/lib/domain/minutes'
import { makeStoragePath } from '@/lib/domain/storagePath'
import {
  getMinuteFileUrl, getMinuteVersionFileUrl, replaceMinuteBody, deleteMinute, toggleMinuteHighlight,
} from '@/app/actions/minutes'
import {
  createIssueFromMinuteBlock, fetchIssueProjectMembers, prepareMinuteIssueDraft,
  type IssueActionResult, type IssueInput, type MinuteIssueSourceInput,
} from '@/app/actions/issues'
import { createWbsItemsFromMinute, prepareMinuteWbsDrafts } from '@/app/actions/minuteWbs'
import {
  fnv1a64, isMarkableBlock, minuteBlockDraftText, splitMinuteBlocks, type BlockMarks,
} from '@/lib/minutes/blocks'
import { INS_PRIORITY, hlTier, visibleHighlights, visibleInsights } from '@/lib/minutes/annotations'
import { resolveMinuteSourceBlock, type MinuteSourceAnchor } from '@/lib/minutes/source'
import { compareKoreanName } from '@/lib/domain/nameSort'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { MarkdownView } from './MarkdownView'
import { MinuteMetaModal } from './MinuteMetaModal'
import { MinuteShareModal } from './MinuteShareModal'
import { MinuteChatPanel } from './MinuteChatPanel'
import { MinuteInsightCard } from './MinuteInsightCard'
import { MinuteToc } from './MinuteToc'
import { useMinuteTocSpy } from './useMinuteTocSpy'
import { MinuteBlockPopover, type PopoverState } from './MinuteBlockPopover'
import { MinuteSelectionBubble, type MinuteSelectionTarget } from './MinuteSelectionBubble'
import { MinuteFontSizeControl } from './MinuteFontSizeControl'
import { useMinuteFontSize } from './useMinuteFontSize'
import { MinuteVersionPanel, type MinuteVersionListItem } from './MinuteVersionPanel'
import { MinuteAttachmentsPanel } from './MinuteAttachmentsPanel'
import { MinuteWikiImpactCard, type MinuteWikiImpactCardProps } from './MinuteWikiImpactCard'
import { TeamBar } from '@/components/minutes/TeamBar'
import {
  type IssueMinuteSourceKind,
  type MinuteLinkedIssue,
} from '@/lib/domain/issueMinuteSource'
import { activeLinkedWbsItems, type MinuteLinkedWbsItem, type MinuteWbsDrafts } from '@/lib/domain/minuteWbs'
import { fill } from '@/lib/i18n/translate'
import {
  buildFallbackMinuteIssueDraft, type MinuteIssueDraft,
} from '@/lib/ai/minute-issue-draft'
import { IssueFormModal, type IssueFormDraft } from '@/components/issues/IssueModals'
import { MinuteWbsRegisterModal } from './MinuteWbsRegisterModal'

const EMPTY_WIKI_IMPACT: MinuteWikiImpactCardProps = {
  status: 'unlinked',
  counts: { created: 0, changed: 0, reaffirmed: 0, conflicted: 0 },
  items: [],
}

/**
 * `linkedIssues = []` 기본값을 인라인으로 두면 **렌더마다 새 배열**이라 activeLinkedIssues →
 * marks 의 useMemo 가 연쇄로 다시 돌고, MarkdownView 의 memo 가 뚫려 글자크기 1px 조절마다
 * 본문 전체가 재파싱된다(스펙 §3 성능 계약, tests/ui/minute-font-size.test.tsx 가 가드).
 * `linkedWbsItems` 도 같다(activeLinkedWbs → marks).
 */
const EMPTY_LINKED_ISSUES: MinuteLinkedIssue[] = []
const EMPTY_LINKED_WBS_ITEMS: MinuteLinkedWbsItem[] = []
const EMPTY_PROJECT_WORKSPACES: Record<string, string> = {}
const EMPTY_WBS_ADMIN_PROJECT_IDS: string[] = []

/** 이슈·WBS 등록의 원천 — 블록 팝오버(블록 전체)와 드래그 선택(부분 발췌)이 같은 상태 기계를 공유한다. */
type IssueOrigin =
  | { type: 'block'; index: number }
  | {
      type: 'selection'
      startIndex: number
      endIndex: number
      startHash: string
      endHash: string
      text: string
      /** 버블이 클라에서 대조해 얻은 서버 파생 발췌 — 미리보기·폴백 초안이 저장 발췌와 일치. */
      excerpt: string
    }

/**
 * 열린 WBS 등록 창 — 준비 액션의 초안과 그 초안을 만든 원문 앵커(prepareMinuteWbsDrafts 에 보낸 배열 그대로, 같은 순서).
 * 등록 줄의 source 는 이 앵커다(창이 원문을 다시 만들지 않는다). 한꺼번에(bulk)는 beginWbsBulk 가 연다(프로젝트 없는 회의록은 선택 창 뒤
 * continueWbsWithProject 가).
 */
type WbsModalState = { mode: 'single' | 'bulk'; projectId: string; drafts: MinuteWbsDrafts; sources: MinuteIssueSourceInput[] }

export function MinuteViewer({
  minute, files, filesError = null, canManage, annotations, userId, projects, sourceAnchor = null,
  initialFontSize = null, versions = [], versionsError = null, wikiImpact = EMPTY_WIKI_IMPACT,
  historicalVersion = null, issueMembers = [], issueMembersError = null, linkedIssues = EMPTY_LINKED_ISSUES,
  linkedWbsItems = EMPTY_LINKED_WBS_ITEMS, linkedWbsItemsError = null, wbsAdminProjectIds = EMPTY_WBS_ADMIN_PROJECT_IDS,
  folderPath = null, timeZone,
  myProjectIds = null, projectWorkspaces = EMPTY_PROJECT_WORKSPACES,
}: {
  minute: Minute
  files: MinuteFile[]
  /** 파일 목록 조회 실패 사유 — 있으면 files 는 [] 이고 머리 영역에 경고를 띄운다(첨부가 없는 회의록으로 보이지 않게). */
  filesError?: string | null
  canManage: boolean
  annotations: { highlights: MinuteHighlight[]; insights: MinuteInsight[] }
  userId: string | null
  projects: { id: string; name: string }[]
  sourceAnchor?: MinuteSourceAnchor | null
  initialFontSize?: number | null
  versions?: MinuteVersionListItem[]
  /** 버전 목록 조회 실패 사유 — 있으면 versions 는 [] 이고 버전 패널이 사유와 재시도를 띄운다('버전 없음'으로 보이지 않게). */
  versionsError?: string | null
  /** null = 위키 모듈이 꺼진 범위(P20) — 카드를 그리지 않는다 */
  wikiImpact?: MinuteWikiImpactCardProps | null
  historicalVersion?: { id: string; versionNo: number } | null
  issueMembers?: ProjectMember[]
  /** 고정 프로젝트(issueMembers)의 명단 조회 실패 사유 — 있으면 빈 담당자 목록으로 이슈 폼을 열지 않는다. */
  issueMembersError?: string | null
  linkedIssues?: MinuteLinkedIssue[]
  /** 이 회의록 문단에 연결된 WBS 작업(모든 버전) — 표시는 현재 본문의 문단 내용(block hash)으로 맞춘 것만(activeLinkedWbsItems). */
  linkedWbsItems?: MinuteLinkedWbsItem[]
  /** 연결된 작업 조회 실패 사유 — 있으면 linkedWbsItems 는 [] 이고 "등록됨"을 판정할 수 없으므로 WBS 등록을 열지 않는다. */
  linkedWbsItemsError?: string | null
  /** WBS 로 등록할 수 있는(관리자인) 프로젝트 id — 서버가 액션 가드(requireProjectAdmin)와 같은 판정으로 내려준다. */
  wbsAdminProjectIds?: string[]
  /** 소속 폴더의 root-first 경로명. null = 미분류이거나 경로 해석 실패(둘은 렌더에서 구분). */
  folderPath?: string[] | null
  /** 버전·처리 시각의 시간대 — 회의록 범위 tz(서버가 정한다, 계획 P8). null 이면 범위 달력을 읽지 못한 것(시각 '—') */
  timeZone: string | null
  /** 내가 멤버로 등록된 프로젝트 id — 수정 모달의 프로젝트 기본 선택 근거. */
  myProjectIds?: string[] | null
  /** 프로젝트 → 워크스페이스(서버의 actor.projectWorkspace) — 블록에서 만드는 이슈의 첨부 경로 scope. */
  projectWorkspaces?: Record<string, string>
}) {
  const router = useRouter()
  // 화면 안 링크의 범위(D38 ①) — 슬러그 워크스페이스의 목록·상세(범위가 없으면 옛 형식 — minuteLinks)
  const links = useMinuteLinks()
  const listHref = links.list
  const currentHref = links.minute(minute.id)
  const { t } = useLocale()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [focus, setFocus] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const fs = useMinuteFontSize({ initial: initialFontSize })
  const bodyFile = historicalVersion ? null : files.find(f => f.role === 'body') ?? null
  const attachments = historicalVersion ? [] : files.filter(f => f.role === 'attachment')
  // breadcrumb 세그먼트 — 루트가 팀 코드면 접는다. 바로 왼쪽 배지가 이미 같은 글자를
  // 보여주고 있어 'MES [MES › 생산계획]' 이 되고, 한 행에 넣으면 그 폭이 제목을 밀어낸다.
  // 팀 루트에 바로 꽂힌 회의록(경로 1칸)은 접으면 남는 게 없으므로 그대로 둔다.
  const pathSegments = folderPath && folderPath.length > 0
    ? (folderPath.length > 1 && folderPath[0] === minute.teamCode ? folderPath.slice(1) : folderPath)
    : null
  // 잘린 세그먼트는 hover 로 전체 경로를 확인한다 — 접은 팀 루트까지 포함한 원본을 쓴다.
  const pathTitle = folderPath && folderPath.length > 0 ? folderPath.join(' / ') : undefined

  const bodyRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  // 현재 사용자가 하이라이트/이슈 등록 대상으로 지정한 영역(저장 전 임시 표시).
  const [selectionPreview, setSelectionPreview] = useState<{ startIndex: number; endIndex: number } | null>(null)
  const [hlBusy, setHlBusy] = useState(false)
  const [issueOrigin, setIssueOrigin] = useState<IssueOrigin | null>(null)
  const [issueFormOpen, setIssueFormOpen] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [issueProjectId, setIssueProjectId] = useState(
    minute.projectId ?? minute.meetingProjectId ?? '',
  )
  const [issueMemberOptions, setIssueMemberOptions] = useState<ProjectMember[]>(issueMembers)
  const [preparedIssueDraft, setPreparedIssueDraft] = useState<MinuteIssueDraft | null>(null)
  const [issueBusy, setIssueBusy] = useState(false)
  const [issueProjectError, setIssueProjectError] = useState<string | null>(null)
  const issueProjectRequestRef = useRef(0)
  // 선택 흐름 prepare 의 진행 중 여부 — issueBusy 상태로 판정하면 안 된다. 성공 연속 코드의
  // removeAllRanges 가 만든 selectionchange 는 React 커밋보다 먼저 실행될 수 있어, 그 시점의
  // 클로저는 아직 busy=true 로 보이고 dismiss 취소가 방금 연 폼의 origin 을 지워
  // issueFormOpen=true·issueBlock=null 유령 상태(폼 미렌더 + 버블 영구 비활성)를 만든다.
  const issuePrepareInFlightRef = useRef(false)
  // 회의록 문단 → WBS 작업(설계 2026-10-21-minutes-to-wbs §3.1) — 이슈 흐름과 같은 뼈대: 요청 번호로 낡은 준비 응답을 버리고,
  // 고정 프로젝트면 바로 준비, 아니면 같은 선택 창을 pickerFor='wbs'(관리자인 같은 워크스페이스 프로젝트만)로 먼저 띄운다.
  const [wbsOrigin, setWbsOrigin] = useState<IssueOrigin | null>(null)
  // 준비 중인 WBS 흐름 — 'single'(문단·선택 한 건) / 'bulk'(요약 카드의 한꺼번에). 「작업 초안 준비 중…」은 그 흐름의 단추에만 쓰고,
  // 다른 등록 단추(이슈 포함)는 막기만 한다 — 두 준비가 겹쳐 창 둘이 열리지 않게
  const [wbsBusyKind, setWbsBusyKind] = useState<'single' | 'bulk' | null>(null)
  const wbsBusy = wbsBusyKind !== null
  const [wbsModal, setWbsModal] = useState<WbsModalState | null>(null)
  // 추천이 없는 줄의 처음 위치 — 이 화면에서 마지막으로 고른 위치(설계 §4.2, 저장하지 않는다). 맨 위면 WBS_ROOT_PARENT.
  // 다른 프로젝트의 id 일 수 있다 — 등록 창은 위치 후보에 없는 id 를 위치로 치지 않는다
  const [lastWbsParentId, setLastWbsParentId] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<'issue' | 'wbs'>('issue')
  const [wbsProjectId, setWbsProjectId] = useState('')
  const [wbsProjectError, setWbsProjectError] = useState<string | null>(null)
  // 프로젝트 없는 회의록의 한꺼번에 등록 — 선택 창이 이어 갈 원문 앵커들. null = 한 건(선택 창이 wbsOrigin 에서 앵커를 만든다)
  const [wbsPickerBulkSources, setWbsPickerBulkSources] = useState<MinuteIssueSourceInput[] | null>(null)
  const wbsRequestRef = useRef(0)
  // 준비 진행 중 — 취소 경로(팝오버 닫기·버블 이탈)는 issuePrepareInFlightRef 와 같은 이유로 상태가 아니라 이 동기 ref 로 판정한다
  const wbsPrepareInFlightRef = useRef(false)

  const blocks = useMemo(() => splitMinuteBlocks(minute.bodyMd), [minute.bodyMd])
  const { activeToc, jumpTo } = useMinuteTocSpy(blocks, bodyRef, { flash: true })
  const bodyHash = useMemo(() => fnv1a64(minute.bodyMd), [minute.bodyMd])
  const currentVersion = useMemo(
    () => [...versions].sort((a, b) => b.versionNo - a.versionNo)[0] ?? null,
    [versions],
  )
  const activeLinkedIssues = useMemo(() => {
    const versionId = historicalVersion?.id ?? currentVersion?.id
    if (!versionId) return []
    return linkedIssues.filter(link =>
      link.minuteVersionId === versionId
      && link.bodyHash === bodyHash
      && blocks[link.blockIndex]?.hash === link.blockHash)
  }, [blocks, bodyHash, currentVersion?.id, historicalVersion?.id, linkedIssues])
  // WBS 연결은 버전이 아니라 문단 내용으로 판정한다(설계 2026-10-21-minutes-to-wbs §5.6) — 이슈(버전 id·본문 hash 가 모두 맞아야)와 달리
  // 오타만 고친 새 버전에서도 같은 문단이면 "등록됨"이고, 연결은 그 문단의 지금 블록 index 로 옮겨 붙는다.
  const activeLinkedWbs = useMemo(
    () => activeLinkedWbsItems(linkedWbsItems, blocks),
    [blocks, linkedWbsItems],
  )
  const fixedProjectId = minute.projectId ?? minute.meetingProjectId ?? ''
  // 프로젝트 없는 회의록의 WBS 선택 창 후보 — 관리자인 프로젝트 중 이 회의록의 워크스페이스 것만(서버가 다른 워크스페이스를 거부한다, 설계 §3.1)
  const wbsPickerProjects = useMemo(() => {
    const admin = new Set(wbsAdminProjectIds)
    return projects.filter(project =>
      admin.has(project.id) && !!minute.workspaceId && projectWorkspaces[project.id] === minute.workspaceId)
  }, [minute.workspaceId, projectWorkspaces, projects, wbsAdminProjectIds])
  // 이 사람·이 화면이 WBS 로 등록할 수 있는가 — 현재 버전·보관 아님·관리자(고정 프로젝트면 그 프로젝트의, 아니면 같은 워크스페이스에서 하나라도)
  const wbsCouldRegister = !historicalVersion && !minute.archivedAt
    && (fixedProjectId ? wbsAdminProjectIds.includes(fixedProjectId) : wbsPickerProjects.length > 0)
  // 「WBS로 등록」을 여는가 — 연결 목록까지 읽었어야 한다("등록됨" 판정의 근거, 계획 "설계와의 차이")
  const wbsEnabled = wbsCouldRegister && !linkedWbsItemsError
  const sourceBlockIndex = useMemo(
    () => sourceAnchor ? resolveMinuteSourceBlock(blocks, bodyHash, sourceAnchor) : null,
    [blocks, bodyHash, sourceAnchor],
  )
  const attemptedSourceRef = useRef<string | null>(null)

  useEffect(() => {
    if (!sourceAnchor) {
      attemptedSourceRef.current = null
      return
    }
    const sourceKey = [
      minute.id, bodyHash, sourceAnchor.bodyHash, sourceAnchor.blockIndex, sourceAnchor.blockHash,
    ].join(':')
    if (attemptedSourceRef.current === sourceKey) return

    if (sourceBlockIndex === null) {
      attemptedSourceRef.current = sourceKey
      toast({ title: t('min.source.missing'), variant: 'info' })
      return
    }
    // Strict Mode의 effect setup→cleanup→setup에서도 첫 frame 취소 뒤 두 번째 setup이 다시 예약되게,
    // 실제 점프가 실행된 뒤에만 완료 키를 기록한다.
    const frame = requestAnimationFrame(() => {
      jumpTo(sourceBlockIndex)
      const target = bodyRef.current?.querySelector<HTMLElement>(`[data-mblock="${sourceBlockIndex}"]`)
      if (target) {
        target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
      attemptedSourceRef.current = sourceKey
    })
    return () => cancelAnimationFrame(frame)
  }, [bodyHash, jumpTo, minute.id, sourceAnchor, sourceBlockIndex, t, toast])

  // 낙관적 병합 계약(스펙 §6.4): 내 하이라이트는 로컬 단독 소유(서버 prop 은 초기값),
  // 타인 하이라이트는 항상 서버 prop 파생 — revalidate 가 와도 이중 계산/역전 없음.
  const [myIndexes, setMyIndexes] = useState<Set<number>>(() => new Set(
    visibleHighlights(annotations.highlights, blocks)
      .filter(h => h.createdBy === userId).map(h => h.blockIndex),
  ))
  const others = useMemo(
    () => visibleHighlights(annotations.highlights, blocks).filter(h => h.createdBy !== userId),
    [annotations.highlights, blocks, userId],
  )
  const insights = useMemo(
    () => visibleInsights(annotations.insights, blocks, bodyHash),
    [annotations.insights, blocks, bodyHash],
  )
  // 한꺼번에 등록의 원천(설계 §3.2) — 지금 본문의 「액션」 요약이 붙은 문단, 문단 순서(같은 위치에 붙는 순서다). insights 는 이미
  // visibleInsights(본문 hash·문단 hash·렌더·(문단, kind) 중복 제거)를 거쳤다. 제목 줄은 뺀다 — 준비 액션이 제목 줄이 섞인 묶음을 통째로
  // 거부한다. 앵커는 한 건 등록과 같고 kind 만 'action'(DB 가 같은 문단의 action 연결 중복을 막는다)
  const actionSources = useMemo<MinuteIssueSourceInput[]>(() => {
    if (!currentVersion) return []
    return insights
      .filter(insight => insight.kind === 'action' && blocks[insight.blockIndex] !== undefined && !blocks[insight.blockIndex].headingDepth)
      .sort((a, b) => a.blockIndex - b.blockIndex)
      .map(insight => ({
        minuteId: minute.id,
        minuteVersionId: currentVersion.id,
        bodyHash,
        blockIndex: insight.blockIndex,
        blockHash: blocks[insight.blockIndex].hash,
        kind: 'action',
      }))
  }, [blocks, bodyHash, currentVersion, insights, minute.id])
  // 요약 카드의 「WBS로 한꺼번에 등록」 — 한 건 등록을 열 수 있고(프로젝트 없는 회의록은 선택 창 뒤) 액션 문단이 하나라도 있을 때
  const canBulkWbs = wbsEnabled && actionSources.length > 0
  const issueAnchorIndex = issueOrigin === null
    ? null
    : issueOrigin.type === 'block' ? issueOrigin.index : issueOrigin.startIndex
  const issueBlock = issueAnchorIndex === null ? null : blocks[issueAnchorIndex] ?? null
  const issueInsight = useMemo(() => {
    if (issueOrigin?.type !== 'block') return null
    const candidates = insights.filter(i =>
      i.blockIndex === issueOrigin.index && (i.kind === 'risk' || i.kind === 'action'))
    return candidates.find(i => i.kind === 'risk') ?? candidates.find(i => i.kind === 'action') ?? null
  }, [insights, issueOrigin])
  const issueSourceText = issueOrigin?.type === 'selection'
    ? issueOrigin.excerpt
    : issueBlock ? minuteBlockDraftText(issueBlock) : ''
  const issueDraft = useMemo<IssueFormDraft | undefined>(() => {
    if (!issueBlock || !issueSourceText) return undefined
    const draft = preparedIssueDraft
      ?? buildFallbackMinuteIssueDraft(
        issueSourceText,
        issueOrigin?.type === 'block' ? issueInsight?.label : null,
      )
    if (!draft) return undefined
    return {
      title: draft.title, body: draft.body, areaId: draft.areaId,
      analysis: draft.analysis ? { ...draft.analysis, sourceType: 'minutes' } : null,
      severity: 'medium',
      assigneeMemberIds: [],
      startDate: null,
      dueDate: null,
    }
  }, [issueBlock, issueInsight, issueOrigin, issueSourceText, preparedIssueDraft])

  const marks = useMemo<BlockMarks>(() => {
    const m: BlockMarks = {}
    for (const i of insights) {
      const k = i.kind as InsightKind
      const cur = m[i.blockIndex]?.ins
      // 복수 kind 는 우선순위 최상위 1개만 인라인 표시(스펙 §6.3)
      if (!cur || INS_PRIORITY.indexOf(k) < INS_PRIORITY.indexOf(cur)) {
        m[i.blockIndex] = { ...m[i.blockIndex], ins: k }
      }
    }
    const counts = new Map<number, Set<string>>()
    for (const h of others) {
      if (!counts.has(h.blockIndex)) counts.set(h.blockIndex, new Set())
      counts.get(h.blockIndex)!.add(h.createdBy)
    }
    for (const idx of myIndexes) {
      if (!counts.has(idx)) counts.set(idx, new Set())
      counts.get(idx)!.add('me')
    }
    for (const [idx, users] of counts) {
      m[idx] = { ...m[idx], hlTier: hlTier(users.size), hlCount: users.size }
    }
    const issueCounts = new Map<number, number>()
    for (const issue of activeLinkedIssues) {
      issueCounts.set(issue.blockIndex, (issueCounts.get(issue.blockIndex) ?? 0) + 1)
    }
    for (const [idx, count] of issueCounts) {
      m[idx] = { ...m[idx], issueCount: count }
    }
    const wbsCounts = new Map<number, number>()
    for (const link of activeLinkedWbs) {
      wbsCounts.set(link.blockIndex, (wbsCounts.get(link.blockIndex) ?? 0) + 1)
    }
    for (const [idx, count] of wbsCounts) {
      m[idx] = { ...m[idx], wbsCount: count }
    }
    // 저장된 마킹과 구분되는 현재 작업 영역 — 이슈 폼·WBS 등록 창을 열어도 지정 범위를 유지한다.
    const activeOrigin = issueOrigin ?? wbsOrigin
    const activeRange = activeOrigin
      ? activeOrigin.type === 'selection'
        ? { startIndex: activeOrigin.startIndex, endIndex: activeOrigin.endIndex }
        : { startIndex: activeOrigin.index, endIndex: activeOrigin.index }
      : popover
        ? { startIndex: popover.blockIndex, endIndex: popover.blockIndex }
        : selectionPreview
    if (activeRange) {
      for (let idx = activeRange.startIndex; idx <= activeRange.endIndex; idx += 1) {
        m[idx] = { ...m[idx], activeSelection: true }
      }
    }
    return m
  }, [activeLinkedIssues, activeLinkedWbs, insights, issueOrigin, myIndexes, others, popover, selectionPreview, wbsOrigin])

  // 블록 클릭 → 팝오버 (이벤트 위임 — 링크/버튼/드래그 선택 제외, 스펙 §6.4)
  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('a, button')) return
    if (window.getSelection()?.toString()) return
    const blockEl = target.closest<HTMLElement>('[data-mblock]')
    if (!blockEl) return
    const idx = Number(blockEl.dataset.mblock)
    if (!blocks[idx] || !isMarkableBlock(blocks[idx])) return
    const r = blockEl.getBoundingClientRect()
    setPopover({ blockIndex: idx, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width } })
  }, [blocks])

  async function onToggleHighlight() {
    if (!popover) return
    const idx = popover.blockIndex
    const wasOn = myIndexes.has(idx)
    const rollback = () =>
      setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.add(idx); else s.delete(idx); return s })
    // 낙관적 업데이트 → 실패/예외 시 롤백 + 토스트
    setMyIndexes(prev => { const s = new Set(prev); if (wasOn) s.delete(idx); else s.add(idx); return s })
    setHlBusy(true)
    try {
      const res = await toggleMinuteHighlight(minute.id, idx, blocks[idx].hash)
      if (!res.ok) {
        rollback()
        toast({ title: t('min.hl.failed'), description: res.error, variant: 'error' })
      }
    } catch {
      // 네트워크 드롭·500·직렬화 오류 등 reject 경로 — busy 고착·팝오버 잔존·미롤백 방지(스펙 §6.4)
      rollback()
      toast({ title: t('min.hl.failed'), variant: 'error' })
    } finally {
      setHlBusy(false)
      setPopover(null)
    }
  }

  /** 블록의 인사이트 파생 kind·라벨 — 소스 빌더와 폴백 초안이 공유한다. */
  function blockInsightAt(index: number) {
    const candidates = insights.filter(insight =>
      insight.blockIndex === index && (insight.kind === 'risk' || insight.kind === 'action'))
    const insight = candidates.find(candidate => candidate.kind === 'risk')
      ?? candidates.find(candidate => candidate.kind === 'action')
      ?? null
    const kind: IssueMinuteSourceKind = insight?.kind === 'risk'
      ? 'risk'
      : insight?.kind === 'action' ? 'action' : 'manual'
    return { insight, kind }
  }

  /** 초안 준비(prepare)와 최종 저장(create)이 같은 원문 앵커를 쓰도록 원천에서 소스를 만든다. */
  function issueSourceInputFor(origin: IssueOrigin): MinuteIssueSourceInput | null {
    if (!currentVersion) return null
    if (origin.type === 'block') {
      const block = blocks[origin.index]
      if (!block) return null
      return {
        minuteId: minute.id,
        minuteVersionId: currentVersion.id,
        bodyHash,
        blockIndex: block.index,
        blockHash: block.hash,
        kind: blockInsightAt(origin.index).kind,
      }
    }
    const start = blocks[origin.startIndex]
    const end = blocks[origin.endIndex]
    if (!start || !end) return null
    return {
      minuteId: minute.id,
      minuteVersionId: currentVersion.id,
      bodyHash,
      blockIndex: start.index,
      blockHash: start.hash,
      kind: 'manual',
      selection: { text: origin.text, endBlockIndex: end.index, endBlockHash: end.hash },
    }
  }

  function issueContextFor(origin: IssueOrigin) {
    const source = issueSourceInputFor(origin)
    if (!source) return null
    if (origin.type === 'selection') {
      return { source, fallback: buildFallbackMinuteIssueDraft(origin.excerpt, null) }
    }
    const block = blocks[origin.index]
    if (!block) return null
    return {
      source,
      fallback: buildFallbackMinuteIssueDraft(
        minuteBlockDraftText(block),
        blockInsightAt(origin.index).insight?.label,
      ),
    }
  }

  async function beginIssueCreateFrom(origin: IssueOrigin) {
    const requestId = ++issueProjectRequestRef.current
    // 앞 요청을 대신한다 — 그 요청의 finally 는 낡아서 플래그를 건드리지 않으므로 여기서 내린다(남으면 한꺼번에 등록이 막힌 채로 남는다)
    issuePrepareInFlightRef.current = false
    setIssueBusy(false)
    if (!currentVersion) {
      toast({ title: t('min.issue.versionMissing'), variant: 'error' })
      setPopover(null)
      return
    }
    const context = issueContextFor(origin)
    if (!context) {
      toast({ title: t('min.issue.versionMissing'), variant: 'error' })
      setPopover(null)
      return
    }
    setIssueOrigin(origin)
    setPreparedIssueDraft(null)
    setIssueProjectError(null)
    if (fixedProjectId) {
      // 담당자 명단을 못 읽었으면 폼을 열지 않는다 — 프로젝트를 고르는 흐름(continueWithProject)의 membersFailed 와 같은 규칙.
      if (issueMembersError) {
        toast({ title: t('min.issue.membersFailed'), description: issueMembersError, variant: 'error' })
        setIssueOrigin(null)
        setPopover(null)
        return
      }
      setIssueProjectId(fixedProjectId)
      setIssueMemberOptions(issueMembers)
      setIssueBusy(true)
      issuePrepareInFlightRef.current = true
      try {
        const result = await prepareMinuteIssueDraft(fixedProjectId, context.source)
        if (issueProjectRequestRef.current !== requestId) return
        if (!result.ok || !result.draft) {
          toast({
            title: t('min.issue.prepareFailed'),
            description: result.error,
            variant: 'error',
          })
          setIssueOrigin(null)
          setPopover(null)
          return
        }
        setPreparedIssueDraft(result.draft)
      } catch {
        if (issueProjectRequestRef.current !== requestId) return
        // 네트워크 단절은 원문 검증 실패와 다르다. 로컬 결정형 초안으로 편집 흐름을 계속한다.
        if (!context.fallback) {
          toast({
            title: t('min.issue.draftUnavailable'),
            variant: 'error',
          })
          setIssueOrigin(null)
          setPopover(null)
          return
        }
        setPreparedIssueDraft(context.fallback)
        toast({ title: t('min.issue.fallbackUsed'), variant: 'info' })
      } finally {
        // requestId 가 낡았다면 취소 주체가 이미 정리했다 — 새 요청의 플래그를 건드리지 않는다.
        if (issueProjectRequestRef.current === requestId) {
          issuePrepareInFlightRef.current = false
          setIssueBusy(false)
        }
      }
      if (issueProjectRequestRef.current !== requestId) return
      setPopover(null)
      // 선택 흐름은 폼이 열리면 선택을 해제해 버블을 정리한다(블록 흐름에는 영향 없음).
      window.getSelection()?.removeAllRanges()
      setIssueFormOpen(true)
      return
    }
    setPopover(null)
    window.getSelection()?.removeAllRanges()
    setIssueProjectId('')
    setIssueMemberOptions([])
    setPickerFor('issue')
    setProjectPickerOpen(true)
  }

  function beginIssueCreate() {
    if (!popover) return
    void beginIssueCreateFrom({ type: 'block', index: popover.blockIndex })
  }

  function onSelectionIssue(target: MinuteSelectionTarget) {
    if (!target.excerpt) return
    void beginIssueCreateFrom({ type: 'selection', ...target })
  }

  // 선택 흐름의 prepare 진행 중 사용자가 버블을 떠나면(바깥 클릭·선택 해제) 요청을 취소해
  // 뒤늦게 도착한 응답이 이슈 폼을 돌발 오픈하지 않게 한다(팝오버 onClose 와 같은 원칙).
  function onSelectionDismiss() {
    // WBS 준비도 같은 규칙 — 선택에서 시작한 준비만, 등록 창·선택 창이 열리기 전까지만 취소한다
    if (wbsPrepareInFlightRef.current && wbsOrigin?.type === 'selection' && !wbsModal && !projectPickerOpen) {
      cancelWbsPrepare()
    }
    // 진행 중 판정은 동기 ref 로만 한다 — selectionchange 가 커밋을 앞지르면 issueBusy
    // 클로저는 낡은 true 라서, 완료된 요청을 취소하며 방금 연 폼의 origin 을 지운다.
    if (!issuePrepareInFlightRef.current || issueOrigin?.type !== 'selection') return
    if (issueFormOpen || projectPickerOpen) return
    issuePrepareInFlightRef.current = false
    issueProjectRequestRef.current += 1
    setIssueBusy(false)
    setPreparedIssueDraft(null)
    setIssueOrigin(null)
  }

  async function continueWithProject() {
    if (!issueProjectId) {
      setIssueProjectError(t('min.issue.projectRequired'))
      return
    }
    const requestedProjectId = issueProjectId
    const requestId = ++issueProjectRequestRef.current
    setIssueBusy(true)
    setIssueProjectError(null)
    if (issueOrigin === null) {
      setIssueProjectError(t('min.issue.versionMissing'))
      setIssueBusy(false)
      return
    }
    const context = issueContextFor(issueOrigin)
    if (!context) {
      setIssueProjectError(t('min.issue.versionMissing'))
      setIssueBusy(false)
      return
    }
    try {
      const [membersResult, draftResult] = await Promise.allSettled([
        fetchIssueProjectMembers(requestedProjectId),
        prepareMinuteIssueDraft(requestedProjectId, context.source),
      ])
      if (issueProjectRequestRef.current !== requestId) return
      if (membersResult.status === 'rejected' || !membersResult.value.ok) {
        setIssueProjectError(
          membersResult.status === 'fulfilled'
            ? membersResult.value.error ?? t('min.issue.membersFailed')
            : t('min.issue.membersFailed'),
        )
        return
      }
      if (draftResult.status === 'fulfilled' && (!draftResult.value.ok || !draftResult.value.draft)) {
        setIssueProjectError(draftResult.value.error ?? t('min.issue.prepareFailed'))
        return
      }
      if (draftResult.status === 'rejected') {
        if (!context.fallback) {
          setIssueProjectError(
            t('min.issue.draftUnavailable'),
          )
          return
        }
        toast({ title: t('min.issue.fallbackUsed'), variant: 'info' })
      }
      const draft = draftResult.status === 'fulfilled' ? draftResult.value.draft! : context.fallback!
      setIssueProjectId(requestedProjectId)
      setIssueMemberOptions(membersResult.value.members ?? [])
      setPreparedIssueDraft(draft)
      setProjectPickerOpen(false)
      setIssueFormOpen(true)
    } catch {
      if (issueProjectRequestRef.current !== requestId) return
      setIssueProjectError(t('min.issue.membersFailed'))
    } finally {
      if (issueProjectRequestRef.current === requestId) setIssueBusy(false)
    }
  }

  function closeProjectPicker() {
    if (pickerFor === 'wbs') {
      cancelWbsPrepare()
      setWbsPickerBulkSources(null)
      setProjectPickerOpen(false)
      return
    }
    // 이슈 준비를 버린다 — 낡은 요청의 finally 는 플래그를 내리지 않으므로 취소하는 쪽이 내린다(onSelectionDismiss 와 같다)
    issueProjectRequestRef.current += 1
    issuePrepareInFlightRef.current = false
    setIssueBusy(false)
    setProjectPickerOpen(false)
    setPreparedIssueDraft(null)
    setIssueOrigin(null)
  }

  /** WBS 원문 앵커 — 이슈와 같은 앵커이되 kind 는 늘 manual('action' 은 한꺼번에 등록 몫, 'risk' 는 WBS 연결 종류가 아니다) */
  function wbsSourceFor(origin: IssueOrigin): MinuteIssueSourceInput | null {
    const source = issueSourceInputFor(origin)
    return source && { ...source, kind: 'manual' }
  }

  /** 준비 중인 WBS 요청을 버린다 — 뒤늦은 응답이 창을 열지 않게(요청 번호) 하고 문단의 작업 영역 표시도 걷는다 */
  function cancelWbsPrepare() {
    wbsRequestRef.current += 1
    wbsPrepareInFlightRef.current = false
    setWbsBusyKind(null)
    setWbsOrigin(null)
  }

  /**
   * 문단(또는 선택 발췌) 하나 → WBS 등록 창. beginIssueCreateFrom 의 뼈대 그대로 — 요청 번호로 낡은 응답을 버리고, 고정 프로젝트면
   * 준비(prepareMinuteWbsDrafts — 줄 1개) 뒤 창을, 아니면 선택 창(pickerFor='wbs')을 먼저 연다. 준비 실패는 토스트로 알리고 창을 열지
   * 않는다 — 위치 후보 없이는 창을 열 수 없어 클라이언트 폴백이 없다(계획 "설계와의 차이").
   */
  async function beginWbsCreateFrom(origin: IssueOrigin) {
    const requestId = ++wbsRequestRef.current
    // 앞 요청을 대신한다 — 그 요청의 finally 는 낡아서 플래그를 건드리지 않으므로 여기서 내린다
    wbsPrepareInFlightRef.current = false
    setWbsBusyKind(null)
    const source = wbsSourceFor(origin)
    if (!source) {
      toast({ title: t('min.wbs.prepareFailed'), variant: 'error' })
      setPopover(null)
      return
    }
    setWbsOrigin(origin)
    if (!fixedProjectId) {
      setPopover(null)
      window.getSelection()?.removeAllRanges()
      openWbsProjectPicker(null)
      return
    }
    setWbsBusyKind('single')
    wbsPrepareInFlightRef.current = true
    let drafts: MinuteWbsDrafts | null = null
    try {
      const result = await prepareMinuteWbsDrafts(fixedProjectId, [source])
      if (wbsRequestRef.current !== requestId) return
      if (result.ok) drafts = result.value
      else toast({ title: t('min.wbs.prepareFailed'), description: result.error, variant: 'error' })
    } catch (cause) {
      if (wbsRequestRef.current !== requestId) return
      console.error('[MinuteViewer] WBS 초안 준비 요청 실패:', cause)
      toast({ title: t('min.wbs.prepareFailed'), variant: 'error' })
    } finally {
      // requestId 가 낡았다면 취소 주체가 이미 정리했다 — 새 요청의 플래그를 건드리지 않는다
      if (wbsRequestRef.current === requestId) {
        wbsPrepareInFlightRef.current = false
        setWbsBusyKind(null)
      }
    }
    if (wbsRequestRef.current !== requestId) return
    setPopover(null)
    if (!drafts) {
      setWbsOrigin(null)
      return
    }
    // 선택 흐름은 창이 열리면 선택을 해제해 버블을 정리한다(블록 흐름에는 영향 없음)
    window.getSelection()?.removeAllRanges()
    setWbsModal({ mode: 'single', projectId: fixedProjectId, drafts, sources: [source] })
  }

  function beginWbsCreate() {
    if (!popover) return
    void beginWbsCreateFrom({ type: 'block', index: popover.blockIndex })
  }

  function onSelectionWbs(target: MinuteSelectionTarget) {
    if (!target.excerpt) return
    void beginWbsCreateFrom({ type: 'selection', ...target })
  }

  /**
   * 프로젝트 없는 회의록의 WBS 선택 창 — 후보는 관리자인 같은 워크스페이스 프로젝트(하나뿐이면 미리 골라 둔다 — 사람은 「계속」만 누른다).
   * bulkSources: 한꺼번에 등록이면 그 앵커들, 한 건이면 null(continueWbsWithProject 가 wbsOrigin 에서 만든다)
   */
  function openWbsProjectPicker(bulkSources: MinuteIssueSourceInput[] | null) {
    setWbsPickerBulkSources(bulkSources)
    setWbsProjectId(wbsPickerProjects.length === 1 ? wbsPickerProjects[0].id : '')
    setWbsProjectError(null)
    setPickerFor('wbs')
    setProjectPickerOpen(true)
  }

  /** 프로젝트 없는 회의록 — 선택 창에서 고른 프로젝트로 준비한다. 실패는 선택 창 안에 사유로(다른 프로젝트를 고르거나 다시 시도) */
  async function continueWbsWithProject() {
    if (!wbsProjectId) {
      setWbsProjectError(t('min.issue.projectRequired'))
      return
    }
    const requestedProjectId = wbsProjectId
    const requestId = ++wbsRequestRef.current
    setWbsProjectError(null)
    // 한꺼번에면 액션 문단의 앵커들, 한 건이면 문단(선택 발췌)의 앵커 하나
    const bulkSources = wbsPickerBulkSources
    const single = bulkSources ? null : wbsOrigin ? wbsSourceFor(wbsOrigin) : null
    const sources = bulkSources ?? (single ? [single] : [])
    if (sources.length === 0) {
      setWbsProjectError(t('min.wbs.prepareFailed'))
      return
    }
    setWbsBusyKind(bulkSources ? 'bulk' : 'single')
    try {
      const result = await prepareMinuteWbsDrafts(requestedProjectId, sources)
      if (wbsRequestRef.current !== requestId) return
      if (!result.ok) {
        setWbsProjectError(result.error || t('min.wbs.prepareFailed'))
        return
      }
      setProjectPickerOpen(false)
      setWbsPickerBulkSources(null)
      setWbsModal({ mode: bulkSources ? 'bulk' : 'single', projectId: requestedProjectId, drafts: result.value, sources })
    } catch (cause) {
      if (wbsRequestRef.current !== requestId) return
      console.error('[MinuteViewer] WBS 초안 준비 요청 실패:', cause)
      setWbsProjectError(t('min.wbs.prepareFailed'))
    } finally {
      if (wbsRequestRef.current === requestId) setWbsBusyKind(null)
    }
  }

  /**
   * AI 요약의 「액션」 문단 전부 → 한꺼번에 등록 창(설계 §3.2). beginWbsCreateFrom 의 뼈대 그대로 — 요청 번호(한 건 준비와 같이 쓴다)로 낡은
   * 응답을 버리고, 고정 프로젝트면 준비(prepareMinuteWbsDrafts — 액션 문단마다 한 줄, kind 'action') 뒤 창을, 아니면 선택 창을 먼저 연다
   * (continueWbsWithProject 가 이 앵커들로 준비한다). 준비 실패는 토스트 — 창은 열지 않는다.
   * 할 일이 없으면(이슈 초안 준비 중·버전 없음·액션 없음) 진행 중인 WBS 준비를 건드리지 않고 끝낸다.
   */
  async function beginWbsBulk() {
    // 이슈 초안을 준비하는 중에는 시작하지 않는다(이슈 폼과 등록 창이 겹쳐 열리지 않게). 카드 단추가 그동안 막혀 보이는 조건(bulkDisabled)과
    // 같은 상태로 판정한다 — 단추가 열려 보이는데 눌러도 아무 일이 없는 일이 없게
    if (issueBusy) return
    if (!currentVersion) {
      toast({ title: t('min.wbs.prepareFailed'), variant: 'error' })
      return
    }
    const sources = actionSources
    if (sources.length === 0) {
      toast({ title: t('min.wbs.noAction'), variant: 'info' })
      return
    }
    const requestId = ++wbsRequestRef.current
    wbsPrepareInFlightRef.current = false
    setWbsBusyKind(null)
    setWbsOrigin(null)
    setPopover(null)
    if (!fixedProjectId) {
      openWbsProjectPicker(sources)
      return
    }
    setWbsBusyKind('bulk')
    wbsPrepareInFlightRef.current = true
    let drafts: MinuteWbsDrafts | null = null
    try {
      const result = await prepareMinuteWbsDrafts(fixedProjectId, sources)
      if (wbsRequestRef.current !== requestId) return
      if (result.ok) drafts = result.value
      else toast({ title: t('min.wbs.prepareFailed'), description: result.error, variant: 'error' })
    } catch (cause) {
      if (wbsRequestRef.current !== requestId) return
      console.error('[MinuteViewer] WBS 한꺼번에 초안 준비 요청 실패:', cause)
      toast({ title: t('min.wbs.prepareFailed'), variant: 'error' })
    } finally {
      // requestId 가 낡았다면 취소 주체가 이미 정리했다 — 새 요청의 플래그를 건드리지 않는다
      if (wbsRequestRef.current === requestId) {
        wbsPrepareInFlightRef.current = false
        setWbsBusyKind(null)
      }
    }
    if (wbsRequestRef.current !== requestId || !drafts) return
    // 준비하는 동안 연 문단 팝오버·선택은 창 아래에 남기지 않는다
    setPopover(null)
    window.getSelection()?.removeAllRanges()
    setWbsModal({ mode: 'bulk', projectId: fixedProjectId, drafts, sources })
  }

  function closeWbsModal() {
    setWbsModal(null)
    setWbsOrigin(null)
  }

  /**
   * 등록 성공 — 「작업 계획에서 보기」(첫 작업으로 focus) 토스트, 마지막 위치 기억(parentId 는 등록 창이 준 공통 위치 값 — 맨 위면 WBS_ROOT_PARENT,
   * 줄마다 다르면 null), 창 닫기, 연결 표시를 새로 읽는다
   */
  function onWbsCreated(target: WbsModalState, items: { row: number; itemId: string; code: string }[], parentId: string | null) {
    const first = items[0]
    toast({
      title: target.mode === 'bulk' ? fill(t('min.wbs.createdN'), { n: items.length }) : t('min.wbs.created'),
      variant: 'success',
      ...(first && {
        action: { label: t('min.wbs.viewInPlan'), href: `/p/${target.projectId}/wbs?focus=${encodeURIComponent(first.itemId)}` },
      }),
    })
    setLastWbsParentId(parentId)
    closeWbsModal()
    router.refresh()
  }

  function createLinkedIssue(projectId: string, input: IssueInput) {
    if (!issueOrigin || !currentVersion) {
      return Promise.resolve({ ok: false, error: t('min.issue.versionMissing') })
    }
    const source = issueSourceInputFor(issueOrigin)
    if (!source) {
      return Promise.resolve({ ok: false, error: t('min.issue.versionMissing') })
    }
    return createIssueFromMinuteBlock(projectId, input, source)
  }

  function closeIssueForm() {
    setIssueFormOpen(false)
    setPreparedIssueDraft(null)
    setIssueOrigin(null)
  }

  function onIssueCreated(_id: string, result: IssueActionResult) {
    toast({
      title: t('min.issue.created'),
      description: result.code
        ? t('min.issue.createdCode').replace('{code}', result.code)
        : t('min.issue.createdDesc'),
      variant: 'success',
    })
  }

  // 원본 파일이 없는 회의록 — 본문 마크다운을 그대로 .md 파일로 내려받는다(클라이언트 Blob, 서버 왕복 없음)
  function downloadBodyMd() {
    // OS 파일명 금지 문자만 치환 — 한글 등 유니코드는 download 속성에서 그대로 허용
    const safeTitle = minute.title.replace(/[\\/:*?"<>|]/g, '_').trim() || t('nav.minutes')
    const blob = new Blob([minute.bodyMd], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${minute.minuteDate} ${safeTitle} ${t('min.download.bodySuffix')}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function download(fileId: string) {
    setBusy(true)
    const res = await getMinuteFileUrl(fileId)
    setBusy(false)
    if (res.ok && res.url) {
      window.open(res.url, '_blank', 'noopener,noreferrer')
      setErr(null)
    } else {
      setErr(res.error ?? t('min.err.download'))
    }
  }

  async function onReplaceBody(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr(null)
    if (!/\.(md|markdown)$/i.test(f.name)) { setErr(t('min.err.bodyExt')); return }
    if (f.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    const text = await f.text()
    if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
    // 저장 경로 scope 는 회의록 행의 워크스페이스·프로젝트(DTO) — 서버(replaceMinuteBody·RPC)가 같은 행 값으로 대조한다.
    if (!minute.workspaceId) { setErr(t('min.err.noWorkspace')); return }
    setBusy(true)
    try {
      const sb = createBrowserClient()
      const path = makeStoragePath({
        workspaceId: minute.workspaceId, projectId: minute.ownProjectId ?? null, entity: 'minutes', entityId: minute.id,
        fileName: stampedFileName(f.name, Date.now()),
      })
      const up = await sb.storage.from('minutes').upload(path, f, { upsert: false })
      if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
      const res = await replaceMinuteBody(minute.id, text, {
        fileName: f.name, filePath: path, size: f.size, mime: f.type || 'text/markdown',
      })
      if (!res.ok) { await sb.storage.from('minutes').remove([path]); setErr(res.error ?? t('min.err.upload')); return }
      // 보정 대상이었는데 건너뛰었으면(업로드는 됐다) 경고 — 원문 시각 그대로라는 사실을 알린다(A-4 리뷰 N4)
      if (res.timeFixWarning) {
        toast({
          title: t('min.timeFix.skippedTitle'),
          description: t(res.timeFixWarning === 'invalid_time' ? 'min.timeFix.skippedInvalidTime' : 'min.timeFix.skippedCalendar'),
          variant: 'info',
        })
      }
      if (res.timeFix) {
        toast({
          title: t('min.timeFix.title'),
          description: `${t('min.timeFix.desc')}: ${res.timeFix.from} → ${res.timeFix.to} (${res.timeFix.tz})`,
          variant: 'info',
        })
      }
      router.refresh()
    } catch (e) {
      // makeStoragePath 의 입력 거부·네트워크 reject 가 표시 없이 새지 않게 한다.
      console.error('[MinuteViewer] 본문 교체 실패:', e)
      setErr(`${t('min.err.upload')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setBusy(false) }
  }

  async function onDelete() {
    setBusy(true)
    const res = await deleteMinute(minute.id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    router.push(listHref)
  }

  // 같은 문장을 하이라이트한 사람 명단 — 하이라이트를 누른 시각순이 아니라 가나다순으로 보여준다.
  const popNames = popover
    ? [...new Set(others.filter(h => h.blockIndex === popover.blockIndex)
        .map(h => h.createdByName ?? t('min.hl.unnamed')))].sort(compareKoreanName)
    : []
  const popKinds = popover
    ? [...new Set(insights.filter(i => i.blockIndex === popover.blockIndex).map(i => i.kind as InsightKind))]
    : []
  const popLinkedIssues = popover
    ? activeLinkedIssues.filter(link => link.blockIndex === popover.blockIndex)
    : []
  const popLinkedWbs = popover
    ? activeLinkedWbs.filter(link => link.blockIndex === popover.blockIndex)
    : []
  // 공유 선택 창 — 이슈는 모든 프로젝트·이슈 문구, WBS 는 관리자인 같은 워크스페이스 프로젝트·WBS 제목
  const pickerWbs = pickerFor === 'wbs'
  const pickerBusy = pickerWbs ? wbsBusy : issueBusy
  const pickerError = pickerWbs ? wbsProjectError : issueProjectError

  return (
    // 폭은 레이아웃 main(헤더와 동일 px 스케일)에 맡긴다 — 자체 max-w/패딩을 두면 헤더 기준선보다 안쪽으로 좁아짐
    // xl↑는 뷰포트 높이에 고정하고 본문 카드가 자체 스크롤 — 메타 헤더·채팅 패널은 스크롤과 무관하게 상주
    <div className="flex flex-col gap-3 xl:h-full xl:min-h-0">
      {/* 메타 헤더 — 메타·액션 단일 행(접기 없음). 좁은 폭에서만 wrap */}
      <div className="card shrink-0 space-y-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={listHref} className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg">
            <ArrowLeft className="h-4 w-4" />{t('min.detail.back')}
          </Link>
          {/* 편철 위치 — 팀 배지와 경로를 테두리 있는 한 덩어리 칩으로 묶어 메타 행 맨 앞에 둔다.
              이전엔 배지·경로가 따로 놀고 경로가 잔글씨(ink-subtle)라 옆 메타에 묻혔다.
              별도 줄로 빼지 않는 이유는 90627c7 — 헤더가 두 줄로 커진다.
              표시 전용 링크 아님 — 탐색기가 아직 폴더 딥링크(?folder=)를 받지 않는다. */}
          <div className={`inline-flex min-w-0 max-w-[22rem] items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 shadow-sm ${
            pathSegments ? 'border-border-input bg-surface' : 'border-dashed border-border-input bg-surface/60'}`}>
            <TeamBar code={minute.teamCode} shape="pill" />
            <nav aria-label={t('min.detail.pathAria')} title={pathTitle}
              className="flex min-w-0 items-center gap-1 text-xs">
              <FolderOpen aria-hidden className={`h-3.5 w-3.5 shrink-0 ${pathSegments ? 'text-action' : 'text-fg-muted'}`} />
              {pathSegments ? (
                pathSegments.map((seg, i) => (
                  <span key={`${i}-${seg}`} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-fg-muted" />}
                    {/* 현재 위치(마지막 칸)는 줄이지 않고 조상부터 줄인다 — 어디에 있는지가 먼저다 */}
                    <span className={i === pathSegments.length - 1
                      ? 'max-w-[11rem] shrink-0 truncate font-semibold text-fg'
                      : 'truncate text-fg-secondary'}>
                      {seg}
                    </span>
                  </span>
                ))
              ) : (
                // folderId 가 있는데 경로가 없다 = 조회 실패이거나 끊긴 체인. '미분류'로 위장하지 않는다.
                <span className={`truncate ${minute.folderId ? 'font-medium text-danger' : 'text-fg-muted'}`}>
                  {minute.folderId ? t('min.detail.pathUnknown') : t('min.fold.unfiled')}
                </span>
              )}
            </nav>
          </div>
          <span className="text-sm tabular-nums text-fg-secondary">{minute.minuteDate}</span>
          <h1 className="min-w-0 flex-1 basis-full break-words text-title text-fg lg:basis-64">{minute.title}</h1>

          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {bodyFile ? (
              <button onClick={() => void download(bodyFile.id)} disabled={busy} className="btn h-8 px-2.5 text-xs">
                <Download className="h-3.5 w-3.5" />{t('min.detail.download')}
              </button>
            ) : (
              <button onClick={downloadBodyMd} className="btn h-8 px-2.5 text-xs">
                <Download className="h-3.5 w-3.5" />{t('min.detail.downloadBody')}
              </button>
            )}
            {minute.meetingId && minute.meetingProjectId && (
              <Link href={`/p/${minute.meetingProjectId}/meetings`}
                className="inline-flex items-center gap-1 text-xs text-action underline underline-offset-2 hover:text-action-hover">
                <ExternalLink className="h-3.5 w-3.5" />{t('min.detail.linkedMeeting')}
              </Link>
            )}
            {canManage && (
              <>
                <button onClick={() => setShareOpen(true)} className="btn h-8 px-2.5 text-xs">
                  <Share2 className="h-3.5 w-3.5" />{t('min.share.button')}
                </button>
                <button onClick={() => setMetaOpen(true)} className="btn h-8 px-2.5 text-xs">{t('min.detail.edit')}</button>
                <label className="btn h-8 cursor-pointer px-2.5 text-xs">
                  {t('min.detail.replaceBody')}
                  <input type="file" accept=".md,.markdown" className="hidden" onChange={onReplaceBody} />
                </label>
                <button onClick={() => setConfirmOpen(true)} className="btn h-8 px-2.5 text-xs text-danger">
                  {t('min.detail.delete')}
                </button>
              </>
            )}
            <span className="text-xs text-fg-muted">{minute.createdByName ?? ''}</span>
            <MinuteFontSizeControl
              size={fs.size} onDec={fs.dec} onInc={fs.inc} onReset={fs.reset}
              canDec={fs.canDec} canInc={fs.canInc}
            />
            <button onClick={() => setFocus(f => !f)}
              title={focus ? t('min.focus.off') : t('min.focus.on')}
              aria-label={focus ? t('min.focus.off') : t('min.focus.on')} aria-pressed={focus}
              className={`btn btn-ghost inline-flex items-center gap-1 text-control ${focus ? 'text-action' : 'text-fg-secondary hover:text-fg'}`}>
              {focus ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {t('min.focus.on')}
            </button>
          </div>
        </div>
        {err && <p className="text-sm text-danger">{err}</p>}
        {/* 연결된 작업을 못 읽으면 "등록됨"을 판정할 수 없어 WBS 등록을 닫는다 — 등록할 수 있었던 사람에게만 사유를 둔다(조회 전용 멤버·지난 버전·
            보관된 회의록에는 원래 등록이 없다. 문단 표시·목록은 누구에게나 빠지고, 조회 실패는 서버가 로그로 남긴다) */}
        {linkedWbsItemsError && wbsCouldRegister && <p role="alert" className="text-sm text-danger">{t('min.wbs.linksUnavailable')}</p>}
      </div>

      <div className="px-4 py-2">
        <DocumentVersionStatus currentVersionNo={currentVersion?.versionNo ?? null}
          viewingVersionNo={historicalVersion?.versionNo ?? currentVersion?.versionNo ?? null}
          publicationState="saved" latestHref={currentHref} documentType="minute" />
      </div>
      {historicalVersion && (
        <div className="card flex shrink-0 flex-wrap items-center gap-2 border-action/30 bg-action-soft/35 px-4 py-2">
          <History className="h-4 w-4 text-action" aria-hidden />
          <p className="text-sm font-medium text-fg">
            {t('min.version.viewingBanner').replace('{n}', String(historicalVersion.versionNo))}
          </p>
          <Link href={currentHref} className="ml-auto text-xs font-medium text-action hover:text-action-hover">
            {t('min.version.backCurrent')}
          </Link>
        </div>
      )}
      {minute.archivedAt && !historicalVersion && (
        <div className="card flex shrink-0 items-center gap-2 border-border-input bg-surface-subtle px-4 py-2">
          <History className="h-4 w-4 text-fg-secondary" aria-hidden />
          <p className="text-sm font-medium text-fg">{t('min.archive.banner')}</p>
        </div>
      )}

      {/* 첨부 — 현재 회의록에서만(과거 버전 화면은 첨부를 스냅샷하지 않는다, D56). 목록 실패도 여기서 알린다. */}
      {!historicalVersion && (
        <MinuteAttachmentsPanel
          minuteId={minute.id} workspaceId={minute.workspaceId ?? null} projectId={minute.ownProjectId ?? null}
          files={attachments} filesError={filesError} canManage={canManage} timeZone={timeZone}
        />
      )}

      {/* 핵심 요약 카드 — shrink-0 유지(xl 높이 체인) */}
      {!historicalVersion && (
        <MinuteInsightCard
          minuteId={minute.id} insights={annotations.insights} highlights={annotations.highlights}
          blocks={blocks} bodyHash={bodyHash} onJump={jumpTo} linkedIssues={activeLinkedIssues}
          linkedWbsItems={activeLinkedWbs} canBulkWbs={canBulkWbs} wbsBusy={wbsBusyKind === 'bulk'}
          // 다른 준비(이슈 초안·문단 한 건) 중에는 막기만 한다 — 보이는 그대로 누를 수 없다(beginWbsBulk 의 판정과 같은 상태)
          bulkDisabled={issueBusy || wbsBusyKind === 'single'}
          onBulkWbs={wbsEnabled ? () => { void beginWbsBulk() } : undefined}
          details={
            <>
              <MinuteVersionPanel
                versions={versions}
                currentVersionNo={versions[0]?.versionNo ?? null}
                embedded
                onDownload={versionId => getMinuteVersionFileUrl(minute.id, versionId)}
                loadError={versionsError ? t('min.version.loadFailed') : null}
                timeZone={timeZone}
              />
              {wikiImpact && <MinuteWikiImpactCard {...wikiImpact} embedded timeZone={timeZone} />}
            </>
          }
        />
      )}

      {/* 과거 버전에서는 핵심 요약을 숨기므로 버전 이동 패널만 기존 위치에 유지한다. */}
      {historicalVersion && (
        <MinuteVersionPanel
          versions={versions}
          currentVersionNo={versions[0]?.versionNo ?? null}
          selectedVersionNo={historicalVersion?.versionNo ?? null}
          onDownload={versionId => getMinuteVersionFileUrl(minute.id, versionId)}
          loadError={versionsError ? t('min.version.loadFailed') : null}
          timeZone={timeZone}
        />
      )}

      {/* xl 미만 목차 아코디언은 MinuteToc 내부에서 분기 렌더 */}
      {/* 목차 + 본문 + (Task 17: 우측 채팅 패널) */}
      <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1 xl:flex-row">
        {/* 집중 모드 — 목차·채팅을 숨겨 본문이 전체 폭 사용 */}
        {!focus && (
          <MinuteToc
            blocks={blocks} insights={insights} highlights={annotations.highlights}
            linkedIssues={activeLinkedIssues} onJump={jumpTo} activeIndex={activeToc}
          />
        )}
        {/* 글자크기는 CSS 변수로만 내려보낸다 — MarkdownView props 가 그대로여야 재파싱이 없다(스펙 §3) */}
        <div ref={bodyRef} onClick={historicalVersion || minute.archivedAt ? undefined : onBodyClick} className="card min-w-0 flex-1 p-4 xl:overflow-y-auto"
          style={{ '--minutes-fs': `${fs.size}px` } as React.CSSProperties}>
          <MarkdownView content={minute.bodyMd} marks={marks} demoteHeadings />
        </div>
        {!focus && !historicalVersion && !minute.archivedAt && (
          <MinuteChatPanel minuteId={minute.id} projects={projects} workspaceId={minute.workspaceId ?? undefined} />
        )}
      </div>

      {popover && (
        <MinuteBlockPopover
          state={popover} mine={myIndexes.has(popover.blockIndex)}
          names={popNames} insKinds={popKinds} busy={hlBusy || issueBusy || wbsBusy}
          linkedIssues={popLinkedIssues} issueBusy={issueBusy}
          // 한꺼번에 준비 중에는 문단의 두 등록을 막기만 한다 — 「작업 초안 준비 중…」은 그 흐름의 단추(요약 카드)에만
          canCreateIssue={!blocks[popover.blockIndex]?.headingDepth && wbsBusyKind !== 'bulk'}
          linkedWbsItems={popLinkedWbs} wbsBusy={wbsBusyKind === 'single'}
          canCreateWbs={!blocks[popover.blockIndex]?.headingDepth && wbsBusyKind !== 'bulk'}
          onCreateWbs={wbsEnabled ? beginWbsCreate : undefined}
          onToggle={() => void onToggleHighlight()}
          onCreateIssue={() => void beginIssueCreate()}
          onClose={() => {
            if (issueBusy) {
              // 이슈 준비를 버린다 — 낡은 요청의 finally 는 플래그를 내리지 않으므로 여기서 내린다
              issueProjectRequestRef.current += 1
              issuePrepareInFlightRef.current = false
              setIssueBusy(false)
              setPreparedIssueDraft(null)
              setIssueOrigin(null)
            }
            // 이 문단에서 시작한 준비 중에 닫으면 요청을 버린다 — 뒤늦은 응답이 창을 돌발로 열지 않게(이슈와 같은 원칙, 판정은 동기 ref).
            // 요약 카드에서 시작한 한꺼번에 준비(wbsOrigin 없음)는 팝오버와 무관하다 — 준비 중에 문단을 눌렀다 닫아도 이어 간다
            if (wbsPrepareInFlightRef.current && wbsOrigin?.type === 'block') cancelWbsPrepare()
            setPopover(null)
          }}
        />
      )}

      {!historicalVersion && !minute.archivedAt && (
        <MinuteSelectionBubble
          bodyRef={bodyRef}
          blocks={blocks}
          disabled={issueFormOpen || projectPickerOpen || wbsModal !== null}
          busy={issueBusy}
          wbsBusy={wbsBusyKind === 'single'}
          // 한꺼번에 준비 중에는 두 단추를 막기만 한다(준비 중 문구는 요약 카드 단추에만)
          canCreateIssue={wbsBusyKind !== 'bulk'}
          canCreateWbs={wbsBusyKind !== 'bulk'}
          onCreateIssue={onSelectionIssue}
          onCreateWbs={wbsEnabled ? onSelectionWbs : undefined}
          onTargetChange={target => setSelectionPreview(
            target ? { startIndex: target.startIndex, endIndex: target.endIndex } : null,
          )}
          onDismiss={onSelectionDismiss}
        />
      )}

      <Modal
        open={projectPickerOpen}
        onClose={closeProjectPicker}
        title={pickerWbs ? t('min.wbs.projectTitle') : t('min.issue.projectTitle')}
        size="sm"
        footer={
          <div className="flex w-full justify-end gap-2">
            <button
              onClick={closeProjectPicker}
              className="btn btn-ghost text-xs"
            >
              {t('common.cancel')}
            </button>
            <button onClick={() => void (pickerWbs ? continueWbsWithProject() : continueWithProject())} disabled={pickerBusy}
              className="btn btn-primary text-xs">
              {pickerBusy
                ? (pickerWbs ? t('min.wbs.preparing') : t('min.issue.summarizing'))
                : t('min.issue.continue')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {/* 설명 문구는 이슈 것뿐이다 — WBS 는 제목(min.wbs.projectTitle)이 말한다. 후보가 없으면(그새 권한이 바뀜) 그 사유 */}
          {!pickerWbs && <p className="text-sm leading-6 text-fg-secondary">{t('min.issue.projectDesc')}</p>}
          {pickerWbs && wbsPickerProjects.length === 0 && (
            <p className="text-sm leading-6 text-fg-secondary">{t('min.wbs.noAdminProject')}</p>
          )}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('min.form.project')}</span>
            <select
              className="app-input"
              value={pickerWbs ? wbsProjectId : issueProjectId}
              disabled={pickerBusy}
              onChange={e => {
                if (pickerWbs) {
                  wbsRequestRef.current += 1
                  setWbsProjectId(e.target.value)
                  setWbsProjectError(null)
                  return
                }
                issueProjectRequestRef.current += 1
                setIssueProjectId(e.target.value)
                setIssueProjectError(null)
              }}
            >
              <option value="">{t('min.form.projectNone')}</option>
              {(pickerWbs ? wbsPickerProjects : projects).map(project => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {pickerError && <p role="alert" className="text-sm text-danger">{pickerError}</p>}
        </div>
      </Modal>

      {/* 열 때마다 새로 마운트한다(wbsModal null → 값) — 줄 상태는 마운트 때 초안에서 채운다 */}
      {wbsModal && (
        <MinuteWbsRegisterModal
          open
          mode={wbsModal.mode}
          projectId={wbsModal.projectId}
          drafts={wbsModal.drafts}
          sources={wbsModal.sources}
          lastParentId={lastWbsParentId}
          onClose={closeWbsModal}
          onSubmit={rows => createWbsItemsFromMinute(wbsModal.projectId, rows)}
          onCreated={(items, parentId) => onWbsCreated(wbsModal, items, parentId)}
        />
      )}

      {issueBlock && (
        <IssueFormModal
          open={issueFormOpen}
          onClose={closeIssueForm}
          projectId={issueProjectId}
          workspaceId={projectWorkspaces[issueProjectId] ?? null}
          initial={null}
          members={issueMemberOptions}
          draft={issueDraft}
          sourcePreview={{
            // 링크에 저장될 불변 버전 메타를 그대로 미리 보여 줘, 메타데이터만
            // 수정된 회의록에서도 확인 카드와 생성 후 상세의 출처명이 어긋나지 않는다.
            title: currentVersion?.title ?? minute.title,
            date: currentVersion?.minuteDate ?? minute.minuteDate,
            excerpt: issueSourceText,
            label: `${issueOrigin?.type === 'selection'
              ? t('min.sel.sourceLabel')
              : t('min.issue.sourceLabel')} · v${currentVersion?.versionNo ?? 1}`,
            organizedDraft: true,
            classificationRecommended: preparedIssueDraft?.mode === 'ai'
              && Boolean(preparedIssueDraft.areaId && preparedIssueDraft.analysis?.subProcess),
          }}
          supportsCustomFields
          onCreate={createLinkedIssue}
          onCreated={onIssueCreated}
        />
      )}

      {/* 열 때마다 리마운트 — 이전 입력·회의 선택이 잔존하지 않게 현재 회의록 값으로 초기화 */}
      {metaOpen && (
        <MinuteMetaModal open onClose={() => setMetaOpen(false)} onSaved={() => { setMetaOpen(false); router.refresh() }}
          minute={minute} projects={projects} myProjectIds={myProjectIds} />
      )}

      <MinuteShareModal open={shareOpen} onClose={() => setShareOpen(false)} minuteId={minute.id} />

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('min.detail.delete')} size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmOpen(false)} className="btn">{t('common.cancel')}</button>
            <button onClick={() => { setConfirmOpen(false); void onDelete() }} disabled={busy} className="btn text-danger">
              {t('min.detail.delete')}
            </button>
          </div>
        }>
        <p className="text-sm text-fg">{t('min.detail.deleteConfirm')}</p>
      </Modal>
    </div>
  )
}
