'use client'
// 에이전트 스튜디오의 세 번째 보기 '에이전트' — 작업 PC 한 줄에 자리(팀장·팀원 N)를 책상으로 늘어놓고,
// 고른 자리의 프로필을 오른쪽에 보인다(2026-09-18 시안 v2, 사용자 결정으로 스튜디오 탭 안의 보기가 됐다).
// 데이터는 스튜디오가 30초마다 읽는 좌석표 그대로를 agentRoster 로 다시 묶는다 — 폴링·범위(내 작업/전체)는 스튜디오 몫.
// 좌석 단위 보고 이력·처리량·토큰 연결은 아직 데이터가 없어 그리지 않는다(시안 notes 의 NEW 항목).
import { useMemo, useState, type ReactNode } from 'react'
import type React from 'react'
import type { Seatmap } from '@/lib/domain/seatmap'
import { ageLabel } from '@/lib/domain/seatmap'
import { pickCharacter, STALE_MS, OFFLINE_MS, type AnimName, type CharacterName } from '@/lib/domain/seatState'
import { assembleRoster, modelBadge, TIER_NAME, type ModelTier, type Roster, type RosterDesk, type RosterHost } from '@/lib/domain/agentRoster'
import type { HeroTile } from '@/components/agent-hub/AgentFrame'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Sprite } from './Sprite'
import { PhaseBadge } from './PhaseBadge'
import { awayBubble, awayReason, leadChatter } from '@/lib/domain/officeChatter'
import { ChatBubble, seatSpeech, useOfficeChatter } from './SeatSpeech'
import { OwnerTag, ownerLabel, teamOwnerLabel, watcherOwnerLabel, type OwnerLabel } from './OwnerTag'
import { fill, type Translate } from './labelKeys'

type Tone = { label: DictKey; color: string }
const TONE: Record<string, Tone> = {
  ACTIVE: { label: 'agents.state.active', color: '#5DB1E5' },
  REJECTED: { label: 'agents.step.rejected', color: '#D8563E' },
  BLOCKED: { label: 'agents.state.blocked', color: '#F0B068' },
  STALE: { label: 'agents.state.stale', color: '#D8563E' },
  OFFLINE: { label: 'agents.state.offline', color: '#6b7580' },
  LEAD: { label: 'agents.tile.standby', color: '#3F8F58' },
  EMPTY: { label: 'agents.state.ready', color: '#b7bfba' },
}

function deskTone(d: RosterDesk): Tone {
  if (d.kind === 'lead') return TONE.LEAD
  if (d.kind === 'empty' || !d.seat) return TONE.EMPTY
  return TONE[d.seat.state] ?? TONE.EMPTY
}
function deskLook(d: RosterDesk): { character: CharacterName; anim: AnimName } {
  if (d.kind === 'lead') return { character: pickCharacter(d.raw ?? d.key), anim: 'idle_look' }
  if (d.seat) return { character: d.seat.character, anim: d.seat.anim }
  return { character: 'cat', anim: 'empty' }
}
/** 책상 한 줄 설명 — 무엇을 하고 있는지. */
function deskLine(d: RosterDesk, host: RosterHost, nowMs: number, chatter: boolean, timeZone: string, t: Translate): string {
  if (d.kind === 'lead') {
    const w = d.watcher
    const seats = w?.slots != null ? fill(t('agents.roster.leadSlots'), { n: w.slots }) : t('agents.roster.watch')
    return w?.untilLabel ? fill(t('agents.roster.until'), { what: seats, until: w.untilLabel }) : seats
  }
  // 잡담이 켜져 있으면 부재 사유(농담)를 붙인다 — 끄면 사실만 남는다.
  if (d.kind === 'empty') return chatter ? fill(t('agents.roster.away'), { reason: awayReason(d.key, nowMs, timeZone) }) : host.watcher ? t('agents.roster.emptyWaiting') : t('agents.state.ready')
  return d.seat ? `${d.seat.code} ${d.seat.name}` : ''
}
/** 책상의 계정 명찰 — 팀장은 감시자 계정, 팀원은 주문을 잡은 계정. 빈자리는 null. */
function deskOwner(d: RosterDesk, t: Translate): OwnerLabel | null {
  if (d.kind === 'lead') return d.watcher ? watcherOwnerLabel(d.watcher, t) : null
  return d.seat ? ownerLabel(d.seat, t) : null
}
function signalAt(d: RosterDesk): string | null {
  return d.kind === 'lead' ? d.watcher?.lastSeenAt ?? null : d.seat?.lastSignalAt ?? null
}

/** 에이전트 보기일 때 공통 헤더에 얹는 타일·요약. */
export function rosterHero(roster: Roster, t: Translate): { tiles: HeroTile[]; lede: ReactNode } {
  const c = roster.tiles
  const tiles: HeroTile[] = [
    { key: 'working', label: t('agents.state.active'), value: c.working, color: 'var(--color-progress)' },
    { key: 'blocked', label: t('agents.state.blocked'), value: c.blocked, color: 'var(--color-warning)' },
    { key: 'stale', label: t('agents.state.stale'), value: c.stale, color: 'var(--color-danger)' },
    { key: 'offline', label: t('agents.state.offline'), value: c.offline, color: 'var(--color-fg-muted)' },
    { key: 'empty', label: t('agents.state.ready'), value: c.empty, color: 'var(--color-border-input)', valueColor: 'var(--color-fg)' },
  ]
  const pcs = roster.hosts.filter(h => h.conforming).length
  const lede = roster.hosts.length === 0
    ? <>{t('agents.roster.ledeNone')}</>
    : (
      <>
        {pcs > 0 ? <>{t('agents.roster.ledePcBefore')}<b>{fill(t('agents.roster.ledePcCount'), { n: pcs })}</b>{t('agents.roster.ledePcAfter')}</> : null}<b>{fill(t('agents.lede.count'), { n: roster.agentCount })}</b>{t('agents.roster.ledeAfter')}
        {c.blocked > 0 && <> <em>{fill(t('agents.roster.ledeBlocked'), { n: c.blocked })}</em></>}
      </>
    )
  return { tiles, lede }
}

export function useRoster(map: Pick<Seatmap, 'floors'>): Roster {
  return useMemo(() => assembleRoster(map), [map])
}

export function RosterBoard({ roster, nowMs, timeZone }: {
  roster: Roster; nowMs: number
  /** 사무실 대사(계절·점심·퇴근 뒤)의 시간대 — 그 스튜디오 화면의 tz */
  timeZone: string
}) {
  const { t } = useLocale()
  const [selected, setSelected] = useState<string | null>(null)
  const allDesks = roster.hosts.flatMap(h => h.desks.map(d => ({ d, h })))
  // 고른 자리가 폴링으로 사라지면 결정 대기 → 첫 에이전트 순으로 다시 고른다.
  const current = allDesks.find(x => x.d.key === selected)
    ?? allDesks.find(x => x.d.seat?.state === 'BLOCKED')
    ?? allDesks.find(x => x.d.kind === 'member' || x.d.kind === 'external')
    ?? allDesks[0] ?? null
  return (
    <div data-roster-board className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-4">
        {roster.hosts.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border bg-surface px-5 py-8 text-center text-sm text-fg-secondary">
            {t('agents.roster.empty')}
          </p>
        )}
        {roster.hosts.map(h => (
          <HostCard key={h.key} host={h} nowMs={nowMs} timeZone={timeZone} selectedKey={current?.d.key ?? null} onSelect={setSelected} />
        ))}
      </div>
      {current && <Profile desk={current.d} host={current.h} nowMs={nowMs} timeZone={timeZone} />}
    </div>
  )
}

function HostCard({ host, nowMs, timeZone, selectedKey, onSelect }: {
  host: RosterHost; nowMs: number; timeZone: string; selectedKey: string | null; onSelect: (k: string) => void
}) {
  const { t } = useLocale()
  const busy = host.desks.filter(d => d.kind === 'member').length
  const w = host.watcher
  const sub = !host.conforming
    ? t('agents.roster.hostUnknown')
    : w
      ? (w.untilLabel
        ? fill(t('agents.roster.hostWatchingUntil'), { age: ageLabel(w.lastSeenAt, nowMs), until: w.untilLabel })
        : fill(t('agents.roster.hostWatching'), { age: ageLabel(w.lastSeenAt, nowMs) }))
      : t('agents.roster.hostNoWatcher')
  // 팀(작업 PC 행) 명찰 — 팀장 계정이 먼저고, 팀장이 없는 행은 앉아 있는 에이전트의 계정을 쓴다.
  const teamOwner = teamOwnerLabel(host.mine, w?.ownerName ?? host.desks.find(d => d.seat?.agentOwnerName)?.seat?.agentOwnerName ?? null, t)
  // 내 팀은 행 전체를 브랜드 바탕과 링으로 들어 올린다(2026-09-20 사용자 요청: 책상만이 아니라 팀에도 표시).
  // 남의 팀은 종전 표면색 그대로다 — 흐리게 하지 않는다.
  const skin = host.mine
    ? 'border-action bg-action-soft shadow-[0_0_0_2px_var(--color-action)]'
    : 'border-border bg-surface shadow-sm'
  return (
    <section data-roster-host={host.key} data-owner={teamOwner.kind} className={`rounded-3xl border p-4 ${skin}`}>
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={`font-mono text-base font-bold ${host.mine ? 'text-action' : 'text-fg'}`}>{host.label}</h2>
        <OwnerTag owner={teamOwner} />
        <span className="text-xs text-fg-muted">{sub}</span>
        {host.slots !== null && <span className="ml-auto text-xs font-semibold tabular-nums text-fg-secondary">{fill(t('agents.roster.seats'), { busy, slots: host.slots })}</span>}
      </header>
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(172px,1fr))]">
        {host.desks.map(d => <Desk key={d.key} desk={d} host={host} nowMs={nowMs} timeZone={timeZone} selected={d.key === selectedKey} onSelect={onSelect} />)}
      </ul>
    </section>
  )
}

function Desk({ desk, host, nowMs, timeZone, selected, onSelect }: {
  desk: RosterDesk; host: RosterHost; nowMs: number; timeZone: string; selected: boolean; onSelect: (k: string) => void
}) {
  const tone = deskTone(desk)
  const look = deskLook(desk)
  const sig = signalAt(desk)
  const chatter = useOfficeChatter()
  const { t } = useLocale()
  const owner = deskOwner(desk, t)
  // 테두리 색은 선택이 쓰고(평면도·레인과 같은 분담), 내 책상은 바깥 2px 브랜드 링으로 그린다 — 테두리 폭을 바꾸면
  // 책상 줄이 어긋난다. 내 책상을 고르면 선택 링을 브랜드 링 바깥(ring-offset)에 둔다. 남의 것은 흐리게 하지 않는다.
  const mine = owner?.kind === 'mine'
  const edge = `${selected ? 'border-action ring-2 ring-border-focus' : 'border-border hover:border-border-input'} ${mine ? (selected ? 'ring-offset-2 ring-offset-action' : 'shadow-[0_0_0_2px_var(--color-action)]') : ''}`
  return (
    <li>
      <button type="button" data-roster-desk={desk.slot} data-owner={owner?.kind} aria-pressed={selected} onClick={() => onSelect(desk.key)}
        className={`flex w-full flex-col overflow-hidden rounded-2xl border text-left transition ${edge} ${desk.kind === 'empty' ? 'border-dashed' : ''}`}>
        {/* 위에서부터 단계 말풍선 · 캐릭터 · 모델 명찰(2026-09-18 사용자 선택) — 말풍선 자리는 비어도 높이를 지켜 책상 줄이 맞는다. */}
        <span className="relative flex flex-col items-center pb-2.5 pt-2"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${tone.color} 16%, var(--color-surface)), var(--color-surface))`, '--sm-cell-w': '102px', '--sm-cell-h': '93px' } as React.CSSProperties}>
          <span className="flex h-[58px] w-full items-end justify-center px-2">{topBubble(desk, host, nowMs, chatter, timeZone)}</span>
          <span className={desk.kind === 'empty' ? 'opacity-60' : ''}><Sprite character={look.character} anim={look.anim} /></span>
          <span className="flex h-[26px] items-end justify-center"><Nameplate desk={desk} /></span>
        </span>
        <span className={`flex flex-col gap-1 px-3 pb-3 pt-2 ${mine ? 'bg-action-soft' : ''}`}>
          <span className="flex items-center gap-2">
            <b className="text-sm text-fg">{desk.kind === 'lead' ? (desk.slot === 'poll' ? t('agents.roster.solo') : t('agents.roster.lead')) : desk.label}</b>
            <span className="ml-auto inline-flex items-center gap-1 text-meta font-semibold" style={{ color: tone.color === '#b7bfba' ? 'var(--color-fg-muted)' : tone.color }}>
              <i className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: tone.color }} />{t(tone.label)}
            </span>
          </span>
          {/* 계정 명찰 줄 — 빈자리도 높이를 지켜 책상 줄이 맞는다. 모델 명찰(캐릭터 발밑)과는 다른 칸이다. */}
          <span className="flex h-4 min-w-0 items-center">{owner && <OwnerTag owner={owner} />}</span>
          <span className="line-clamp-2 min-h-[2.5em] text-xs text-fg-secondary">{deskLine(desk, host, nowMs, chatter, timeZone, t)}</span>
          {desk.seat && <Progress pct={desk.seat.progress} color={tone.color} />}
          <span className="text-meta tabular-nums text-fg-muted">{sig ? fill(t('agents.roster.signal'), { age: ageLabel(sig, nowMs) }) : ' '}</span>
        </span>
      </button>
    </li>
  )
}

/**
 * 캐릭터 머리 위 — 팀장은 잔소리·칭찬 말풍선, 팀원은 막 올린 보고 말풍선, 그 밖엔 단계 말풍선(2026-09-18).
 * 작업 중인 팀원은 단계 말풍선 사이사이 한마디씩 한다(세 칸에 한 칸).
 * 대사 고르기는 officeChatter(순수)가 한다. 보고가 식으면(10분) 단계 말풍선으로 돌아간다.
 */
function topBubble(desk: RosterDesk, host: RosterHost, nowMs: number, chatter: boolean, timeZone: string): React.ReactNode {
  if (desk.kind === 'lead') {
    // 팀장 대사(잔소리·칭찬·한탄·혼잣말)는 전부 잡담이다 — 끄면 팀장 머리 위는 비운다.
    if (!chatter) return null
    const c = leadChatter(host, nowMs, timeZone, desk)
    return c && <ChatBubble key={c.text} kind={c.tone} text={c.text} className="max-w-full" />
  }
  if (desk.kind === 'empty') {
    // 빈자리 부재 사유 — 세 칸에 한 칸만 띄운다. 잡담이라 끄면 비운다.
    const away = chatter ? awayBubble(desk.key, nowMs, timeZone) : null
    return away && <ChatBubble key={away} kind="empty" text={away} className="max-w-full" />
  }
  if (!desk.seat) return null
  const say = seatSpeech(desk.seat, nowMs, chatter)
  if (say) return <ChatBubble key={say.text} {...say} className="max-w-full" />
  return <span className="self-center"><PhaseBadge seat={desk.seat} /></span>
}

/**
 * 캐릭터 발밑 명찰(위는 단계 말풍선 자리) — 어떤 모델이 앉아 있는지 한눈에. 제조사 표식(색 + 기호)과 짧은 모델 이름.
 * 팀장·단독 감시는 같은 자리에 ★ 명찰을 단다. 모델은 heartbeat 의 실행 모델(0100, Phase 서브에이전트)이 우선이고,
 * 아직 보고가 없으면 WBS 항목 지정 모델을 점선 명찰로 보인다. 같은 팀원도 Phase 마다 등급이 바뀐다.
 */
function Nameplate({ desk, size = 'sm' }: { desk: RosterDesk; size?: 'sm' | 'lg' }) {
  const { t } = useLocale()
  const pos = size === 'sm' ? 'relative' : ''
  const text = size === 'sm' ? 'text-meta' : 'text-xs'
  if (desk.kind === 'lead') {
    return (
      <span data-nameplate="lead" className={`${pos} z-[1] inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#2f6e44] px-2.5 py-1 font-bold text-white shadow-[0_6px_14px_-8px_#1b3a26] ${text}`}>
        <span aria-hidden className="text-[#ffd76a]">★</span>{desk.slot === 'poll' ? t('agents.roster.solo') : t('agents.roster.lead')}
      </span>
    )
  }
  if (desk.kind === 'empty') return null
  const b = modelBadge(desk.seat?.model)
  if (!b) {
    return (
      <span data-nameplate="unknown" title={t('agents.model.unknownTitle')}
        className={`${pos} z-[1] inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border-input bg-surface/80 px-2.5 py-1 font-semibold text-fg-muted ${text}`}>
        {t('agents.model.unknown')}
      </span>
    )
  }
  const ring = b.tier ? TIER_RING[b.tier] : null
  // 실행 모델(heartbeat)은 꽉 찬 명찰, 지정 모델(WBS)은 점선 테두리의 흐린 명찰 — 지금 도는 모델인지 계획인지 한눈에.
  const plan = desk.seat?.modelSource !== 'run'
  const edge = plan ? '#8A8F99' : ring?.edge
  const shadow = plan
    ? '0 8px 16px -10px #0d1014'
    : `${edge ? `0 0 0 1.5px ${edge}, ` : ''}${ring?.glow ? `0 0 ${ring.glow}px ${ring.edge}66, ` : ''}0 8px 16px -10px #0d1014`
  const stepKey = desk.seat?.heartbeatPhase ? STEP_KEY[desk.seat.heartbeatPhase] : undefined
  const head = plan ? t('agents.model.planBeforeRun') : stepKey ? fill(t('agents.model.runStep'), { step: t(stepKey) }) : t('agents.model.run')
  return (
    <span data-nameplate={b.vendor} data-tier={b.tier ?? undefined} data-model-source={plan ? 'plan' : 'run'}
      title={`${head} · ${desk.seat?.model ?? ''}${b.tier ? ` · ${fill(t('agents.model.tier'), { tier: b.tier, name: TIER_NAME[b.tier] })}` : ''}`}
      className={`${pos} z-[1] inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-1 pr-2 font-bold ${text} ${plan ? 'border border-dashed border-[#8A8F99] bg-[#15191fb3] text-[#d9d3cb]' : 'bg-[#15191f] text-[#f4efe7]'}`}
      style={{ boxShadow: shadow }}>
      <span aria-hidden className={`grid h-[18px] w-[18px] place-items-center rounded-full text-meta leading-none text-white ${plan ? 'opacity-70' : ''}`} style={{ background: b.color }}>{b.mark}</span>
      <span className="font-mono tracking-tight">{b.label}</span>
      {b.tier && <TierPips tier={b.tier} color={plan ? '#b7bfba' : ring!.edge} />}
      {plan && <span className="rounded-full bg-white/10 px-1.5 py-px text-meta font-semibold text-[#b7bfba]">{t('agents.model.planChip')}</span>}
      {size === 'sm' && <i aria-hidden className={`absolute -top-[5px] left-1/2 -z-[1] h-2.5 w-2.5 -translate-x-1/2 rotate-45 ${plan ? 'bg-[#15191fb3]' : 'bg-[#15191f]'}`} />}
    </span>
  )
}

const STEP_KEY: Record<string, DictKey> = {
  design: 'agents.step.design', build: 'agents.step.build', verify: 'agents.step.verify', refactor: 'agents.step.refactor',
  blocked: 'agents.state.blocked', rejected: 'agents.step.rejected', reported: 'agents.step.reported',
}

/** 등급 테두리 — 1 금 · 2 은 · 3 동 · 4 무광. 1등급만 은은하게 빛난다. */
const TIER_RING: Record<ModelTier, { edge: string; glow: number }> = {
  1: { edge: '#F5C451', glow: 12 },
  2: { edge: '#C9D3DD', glow: 0 },
  3: { edge: '#C98A55', glow: 0 },
  4: { edge: '#5B636E', glow: 0 },
}

/** 4칸 등급 막대 — 채운 칸 수 = 5 − 등급(1등급이면 네 칸). 칸 높이가 계단처럼 올라간다. */
function TierPips({ tier, color }: { tier: ModelTier; color: string }) {
  const { t } = useLocale()
  const filled = 5 - tier
  return (
    <span aria-label={fill(t('agents.model.tier'), { tier, name: TIER_NAME[tier] })} className="ml-0.5 inline-flex items-end gap-[2px]">
      {[0, 1, 2, 3].map(i => (
        <i key={i} className="block w-[3px] rounded-[1px]" style={{ height: 5 + i * 2, background: i < filled ? color : '#ffffff26' }} />
      ))}
    </span>
  )
}

function Progress({ pct, color }: { pct: number; color: string }) {
  const { t } = useLocale()
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-label={fill(t('agents.roster.progress'), { pct })}>
      <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  )
}

/** 신호 계기 — 0 · 5분(무응답) · 30분(끊김) 눈금 위에 마지막 신호 경과를 찍는다. 감시자는 70분 기준이라 따로 적는다. */
function SignalGauge({ at, nowMs, lead }: { at: string | null; nowMs: number; lead: boolean }) {
  const { t } = useLocale()
  if (!at) return <p className="text-xs text-fg-muted">{t('agents.roster.signalNone')}</p>
  const min = Math.max(0, (nowMs - Date.parse(at)) / 60_000)
  const max = lead ? 70 : OFFLINE_MS / 60_000
  const pos = Math.min(100, (min / max) * 100)
  const staleAt = (STALE_MS / 60_000 / max) * 100
  return (
    <div>
      <div className="relative h-2 rounded-full" style={{ background: lead
        ? 'linear-gradient(90deg,#3F8F58,#3F8F58 85%,#6b7580)'
        : `linear-gradient(90deg,#5DB1E5 0 ${staleAt}%,#F0B068 ${staleAt}% 100%)` }}>
        <i className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-fg" style={{ left: `calc(${pos}% - 2px)` }} />
      </div>
      <div className="mt-1 flex justify-between text-meta tabular-nums text-fg-muted">
        <span>0</span>{!lead && <span>{t('agents.roster.gaugeStale')}</span>}<span>{lead ? t('agents.roster.gaugeLeadOff') : t('agents.roster.gaugeOff')}</span>
      </div>
    </div>
  )
}

function Profile({ desk, host, nowMs, timeZone }: { desk: RosterDesk; host: RosterHost; nowMs: number; timeZone: string }) {
  const chatter = useOfficeChatter()
  const { t } = useLocale()
  const tone = deskTone(desk)
  const look = deskLook(desk)
  const title = desk.kind === 'lead' ? (desk.slot === 'poll' ? t('agents.roster.solo') : t('agents.roster.lead')) : desk.label
  const seat = desk.seat
  const owner = deskOwner(desk, t)
  return (
    <aside data-roster-profile className="sticky top-(--frame-sticky-top) flex min-w-0 flex-[0_1_340px] flex-col gap-4 rounded-3xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <span className="grid shrink-0 place-items-center rounded-2xl"
          style={{ background: `color-mix(in srgb, ${tone.color} 16%, var(--color-surface))`, '--sm-cell-w': '102px', '--sm-cell-h': '93px' } as React.CSSProperties}>
          <Sprite character={look.character} anim={look.anim} />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-meta text-fg-muted">{host.label}</p>
          <h2 className="text-xl font-extrabold text-fg">{title}</h2>
          {desk.raw && <p className="truncate font-mono text-xs text-fg-muted" title={desk.raw}>{desk.raw}</p>}
          {owner && <span className="mt-1 flex min-w-0"><OwnerTag owner={owner} /></span>}
          {desk.kind !== 'lead' && desk.kind !== 'empty' && (
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <Nameplate desk={desk} size="lg" />
              {(() => {
                const tier = modelBadge(desk.seat?.model)?.tier
                const src = desk.seat?.modelSource === 'run' ? t('agents.model.run') : desk.seat?.modelSource === 'plan' ? t('agents.model.plan') : null
                return src ? <span className="text-meta font-semibold text-fg-secondary">{src}{tier ? ` · ${fill(t('agents.model.tier'), { tier, name: TIER_NAME[tier] })}` : ''}</span> : null
              })()}
            </span>
          )}
          <span className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold"
            style={{ background: `color-mix(in srgb, ${tone.color} 18%, transparent)`, color: 'var(--color-fg)' }}>
            <i className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: tone.color }} />{t(tone.label)}
          </span>
        </div>
      </div>

      {seat && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-meta font-bold text-fg-muted">{t('agents.roster.nowDoing')}</h3>
          <p className="text-sm font-semibold text-fg"><span className="font-mono text-fg-secondary">{seat.code}</span> {seat.name}</p>
          <Progress pct={seat.progress} color={tone.color} />
          <p className="text-meta text-fg-muted">{seat.heartbeatPhase
            ? fill(t('agents.roster.progressStep'), { pct: seat.progress, step: seat.heartbeatPhase })
            : fill(t('agents.roster.progress'), { pct: seat.progress })}</p>
        </section>
      )}
      {seat?.state === 'BLOCKED' && (
        <section className="rounded-2xl border border-[#F0B068] bg-[color-mix(in_srgb,#F0B068_12%,var(--color-surface))] p-3">
          <h3 className="text-xs font-bold text-fg">{t('agents.roster.needDecision')}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">{seat.note ?? t('agents.roster.noBlockNote')}</p>
          <p className="mt-2 text-meta text-fg-muted">{t('agents.roster.answerWhere')}</p>
        </section>
      )}
      {desk.kind === 'lead' && desk.watcher && (
        <section className="flex flex-col gap-1 text-sm text-fg-secondary">
          <h3 className="text-meta font-bold text-fg-muted">{t('agents.roster.watch')}</h3>
          <p>{(() => {
            const seats = fill(t('agents.roster.seats'), { busy: desk.watcher.busy ?? 0, slots: desk.watcher.slots ?? '—' })
            return desk.watcher.untilLabel ? fill(t('agents.roster.until'), { what: seats, until: desk.watcher.untilLabel }) : seats
          })()}</p>
        </section>
      )}
      {desk.kind === 'empty' && (
        <p className="text-sm text-fg-secondary">
          {chatter && <b data-away className="mb-1 block text-fg">{fill(t('agents.roster.awayNow'), { reason: awayReason(desk.key, nowMs, timeZone) })}</b>}
          {t('agents.roster.emptySeat')}
        </p>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-meta font-bold text-fg-muted">{fill(t('agents.roster.lastSignal'), { age: signalAt(desk) ? ageLabel(signalAt(desk), nowMs) : '—' })}</h3>
        <SignalGauge at={signalAt(desk)} nowMs={nowMs} lead={desk.kind === 'lead'} />
      </section>

      <p className="border-t border-border pt-3 text-meta leading-relaxed text-fg-muted">
        {t('agents.roster.historyNote')}
      </p>
    </aside>
  )
}
