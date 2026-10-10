// (src/lib/mail/meetingInvite.ts 와 같은 구성: 순수 렌더 함수, 발송은 호출자가 한다.)

import { stampIn } from '@/lib/domain/calendar'
import { esc } from './esc'
import { BRAND } from '@/lib/branding'

/**
 * 만료 일시는 프로젝트 시간대로 찍고 IANA 이름을 꼬리에 붙인다(스펙 SP5 §4.3 메일 시각). Date 를 로컬 게터로 읽으면
 * 서버 tz 에 따라 시각이 달라진다 — 수신자가 보는 시각은 서버 타임존과 무관해야 한다.
 */
function zonedStamp(iso: string, timeZone: string): string | null {
  const at = new Date(iso)
  // stampIn 은 유효한 입력을 전제한다 — invalid → null 계약은 이 래퍼가 지킨다.
  if (Number.isNaN(at.getTime())) return null
  return `${stampIn(timeZone, at)} (${timeZone})`
}

/**
 * 파싱 실패를 그럴듯한 날짜로 위장하지 않는다 — 'Invalid Date' 나 임의의 폴백 시각을 찍느니
 * 확인 불가라고 적는다. 발송 자체는 계속한다: 링크가 도달해야 초대가 쓸모 있고,
 * 만료 판정은 어차피 DB 가 한다(consume_project_invite).
 */
function expiresLabel(iso: string, timeZone: string): string {
  return zonedStamp(iso, timeZone) ?? '확인할 수 없음'
}

/** 메일 헤더는 한 줄이다 — 제목의 CR/LF 는 헤더 주입 표면이므로 여기서 잘라낸다. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ')
}

/** meetingInvite.ts 와 같은 이유 — Word 엔진이 아는 이름을 스택 선두에 둔다. */
const FONT_STACK = "'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif"

/** Outlook(Word 엔진)은 표 셀로 폰트를 상속시키지 않는다. 셀마다 되풀이한다. */
const BODY_FONT = `font-family:${FONT_STACK};font-size:14px;line-height:1.6`
const INK = '#1f2328'
const INK_MUTED = '#6b7280'
const LINK = '#2563eb'

// 링크는 1회용·수신자 한정이라는 사실을 수신자가 알아야 한다 — 전달받은 사람이 눌러도
// 열리지 않는 이유가 되고, 유출을 알아채는 단서가 된다.
const NOTE_ONETIME = '이 링크는 1회용이며 이 메일 주소로만 사용할 수 있습니다.'
const NOTE_IGNORE = '본인이 요청하지 않은 메일이면 무시하세요.'

export interface InviteMailInput {
  productName?: string
  projectName: string
  /** 알 수 없으면 null — 줄 자체를 만들지 않는다(빈 항목을 나열하지 않는다). */
  inviterName: string | null
  url: string
  /** ISO 8601. 표기는 timeZone 으로 찍는다. */
  expiresAt: string
  /** 만료 시각을 찍을 시간대(프로젝트 calendar.timezone). 꼬리에 그대로 적는다 */
  timeZone: string
  /** 합류하면 오를 팀 이름들. 없거나 비면 줄 자체를 만들지 않는다(빈 항목을 나열하지 않는다). */
  teamNames?: readonly string[]
}

type Row = { label: string; value: string }

export function renderInviteMail(i: InviteMailInput): { subject: string; html: string; text: string } {
  const projectName = i.projectName.trim()
  const inviter = i.inviterName?.trim() || null
  const expires = expiresLabel(i.expiresAt, i.timeZone)

  const subject = oneLine(`[${i.productName ?? BRAND.productName}] ${projectName} 프로젝트 초대`)

  const teams = (i.teamNames ?? []).map(n => n.trim()).filter(Boolean)

  const rows: Row[] = [{ label: '프로젝트', value: projectName }]
  if (inviter) rows.push({ label: '초대한 사람', value: inviter })
  if (teams.length > 0) rows.push({ label: '팀', value: teams.join(', ') })
  rows.push({ label: '만료', value: expires })

  const text = [
    `${projectName} 프로젝트 초대`,
    '',
    ...rows.map(r => `${r.label}: ${r.value}`),
    '',
    '아래 링크에서 합류할 수 있습니다.',
    i.url,
    '',
    NOTE_ONETIME,
    NOTE_IGNORE,
  ].join('\n')

  // 버튼 링크와 주소 전문을 둘 다 싣는다 — 버튼을 죽이거나 스타일을 지우는 클라이언트에서도
  // 수신자가 주소를 직접 복사할 수 있어야 한다.
  const html = [
    `<div style="${BODY_FONT};color:${INK};max-width:560px">`,
    `<h2 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:18px">${esc(projectName)} 프로젝트 초대</h2>`,
    // role="presentation" — 라벨/값 2단 레이아웃이지 데이터 표가 아니다.
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">',
    ...rows.map(r =>
      `<tr><td style="${BODY_FONT};color:${INK_MUTED};padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top">${esc(r.label)}</td>` +
      `<td style="${BODY_FONT};color:${INK};padding:6px 0">${esc(r.value)}</td></tr>`),
    '</table>',
    `<p style="margin:20px 0 8px"><a href="${esc(i.url)}" style="color:${LINK}">초대 수락하고 합류하기</a></p>`,
    `<p style="${BODY_FONT};margin:0 0 20px;color:${INK_MUTED};word-break:break-all">${esc(i.url)}</p>`,
    `<p style="${BODY_FONT};margin:0;color:${INK_MUTED}">${esc(NOTE_ONETIME)}</p>`,
    `<p style="${BODY_FONT};margin:4px 0 0;color:${INK_MUTED}">${esc(NOTE_IGNORE)}</p>`,
    '</div>',
  ].join('')

  return { subject, html, text }
}
