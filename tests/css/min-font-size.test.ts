// 글자 크기 하한 12px 과 대문자·넓은 자간 라벨 0건(개정 §5.5.6 "금지" 행 · §5.5.7). type-scale.test.ts 가 공용 클래스 넷·공용 컴포넌트 다섯만
// 지키던 것을 src 전체로 넓힌다. 12px 미만은 아래 ALLOW(파일·표기·건수·용도·사유)에 적힌 자리뿐이다 — 목록은 닫혀 있고, 실제 건수와
// 정확히 같아야 한다(더 생겨도, 예외가 사라졌는데 줄이 남아도 실패한다).
// 잡는 모양: `text-[Npx|rem]` 유틸, 인라인·SVG 의 `fontSize`(숫자·문자열·`var(--x, Npx)` 폴백·같은 파일의 상수), CSS 의 `font-size`.
// 못 잡는 모양: 실행 중에 계산하는 크기(`BrandMark` 의 `size * 0.46` — 지금 쓰는 28·40px 에서는 12px 이상이다), em 단위(부모 기준이라 px 를 알 수 없다 — 지금 src 에 `text-[…em]` 은 없다).
import { describe, expect, it } from 'vitest'
import { wbsFontScaleVariables } from '@/lib/wbsFontScale'
import { srcFiles } from './lib/cssTokens'

const MIN_PX = 12
const toPx = (n: string, unit: string): number => Number(n) * (unit === 'px' ? 1 : 16)
const fmt = (px: number): string => `${Number(px.toFixed(2))}px`

/** 12px 미만 글자 선언을 `표기` 목록으로 — text-[10px] · fontSize 9px · font-size 10px */
export function smallFontHits(file: string, text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)) {
    if (toPx(m[1], m[2]) < MIN_PX) out.push(m[0])
  }
  if (/\.css$/.test(file)) {
    for (const m of text.matchAll(/font-size\s*:\s*(\d*\.?\d+)(px|rem)\b/g)) {
      if (toPx(m[1], m[2]) < MIN_PX) out.push(`font-size ${fmt(toPx(m[1], m[2]))}`)
    }
    return out
  }
  // fontSize={9} · fontSize: 9
  for (const m of text.matchAll(/fontSize\s*(?:=\s*\{|:)\s*(\d+(?:\.\d+)?)\b(?!\s*[*/])/g)) {
    if (Number(m[1]) < MIN_PX) out.push(`fontSize ${fmt(Number(m[1]))}`)
  }
  // fontSize={FS_SUB} · fontSize: FS_SUB — 같은 파일의 숫자 상수
  for (const m of text.matchAll(/fontSize\s*(?:=\s*\{|:)\s*([A-Z][A-Z0-9_]*)\b/g)) {
    const def = text.match(new RegExp(`\\b${m[1]}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\b`))
    if (def && Number(def[1]) < MIN_PX) out.push(`fontSize ${fmt(Number(def[1]))}`)
  }
  // fontSize: 'var(--wbs-day-font, 9px)' · fontSize="10px" — 문자열 안의 px. max(12px, …) 로 하한을 건 것은 통과
  for (const m of text.matchAll(/fontSize\s*(?:=|:)\s*\{?\s*(['"`])([^'"`]*)\1/g)) {
    if (/^max\(\s*1[2-9]px\s*,/.test(m[2])) continue
    for (const p of m[2].matchAll(/(\d*\.?\d+)px/g)) if (Number(p[1]) < MIN_PX) out.push(`fontSize ${fmt(Number(p[1]))}`)
  }
  return out
}

type Allowed = { file: string; hit: string; n: number; use: string; why: string }
/** 12px 미만 허용 목록 — 데이터 시각화의 눈금·도형 안 글자와 키 표시뿐이다(읽고 조작하는 글자는 없다) */
export const ALLOW: Allowed[] = [
  { file: 'src/components/app/GlobalBar.tsx', hit: 'text-[10px]', n: 1, use: '찾기 버튼의 ⌘K 키 표시(<kbd>)', why: '키 표시는 버튼 라벨 옆의 보조 기호다 — 12px 이면 좁은 전역 바에서 라벨을 민다' },
  { file: 'src/components/app/PresenceStrip.tsx', hit: 'text-[10px]', n: 2, use: '접속자 아바타 원(28px) 안 이니셜·+N', why: '고정 크기 원 안 두 글자 — 12px 굵은 한글 두 자는 원을 채워 잘린다' },
  { file: 'src/components/dashboard/ProgressGauge.tsx', hit: 'text-[10px]', n: 1, use: '진척 링 게이지 안의 계획 대비 보조 줄(계획 n% · ±n%p)', why: '고정 크기 링 안쪽에 들어가는 한 줄이다 — 12px 이면 링 밖으로 삐져나온다(2026-10-09 화면 확인). 같은 값이 옆 KPI 와 aria-label 에 있다' },
  { file: 'src/components/dashboard/IssueStatusCard.tsx', hit: 'text-[9px]', n: 1, use: '영역별 해결률 링 게이지(34px) 안 퍼센트', why: '링 안쪽 지름 24px 에 "100%" 가 들어가야 한다. 같은 값이 옆 글과 aria-label 에도 있다' },
  { file: 'src/components/wbs/WbsGanttSheet.tsx', hit: 'text-[9px]', n: 1, use: '범례의 팀 색 점(●)', why: '글자가 아니라 색 표지 도형이다 — 표의 담당 표지와 같은 크기' },
  { file: 'src/components/wbs/WbsGanttSheet.tsx', hit: 'fontSize 9.5px', n: 1, use: '간트 머리의 주차 눈금(--wbs-timeline-font 폴백)', why: '주 칸 폭이 날짜 축척에 묶여 있다 — 키우면 주차·기간이 잘린다. 글자 배율 115·130% 로 키울 수 있다' },
  { file: 'src/components/wbs/WbsGanttSheet.tsx', hit: 'fontSize 9px', n: 4, use: '간트 일자 눈금 1 · 막대 안팎 퍼센트 3(--wbs-day-font·--wbs-bar-font 폴백)', why: '일 칸(24px~)·막대(높이 14px) 안에 들어가는 숫자다. 같은 퍼센트가 실적 열에 12px 로 있다' },
  { file: 'src/components/wbs/OwnerBadges.tsx', hit: 'fontSize 9px', n: 1, use: '담당 표지 도형(●주관·△지원 — --wbs-owner-mark-font 폴백)', why: '글자가 아니라 표지 도형이다. 팀 이름은 12px 이고 주관·지원은 title 로도 읽힌다' },
  { file: 'src/components/dashboard/TrendChart.tsx', hit: 'fontSize 9px', n: 3, use: 'S-커브 차트의 축 눈금·양 끝 날짜(SVG)', why: 'viewBox 단위라 화면 폭에 따라 커진다. 축 여백(PL)이 이 크기에 맞춰져 있다' },
  { file: 'src/components/usage/UsageTrendChart.tsx', hit: 'fontSize 9px', n: 3, use: '일별 사용자 차트의 축 눈금·양 끝 날짜(SVG)', why: 'viewBox 단위 축 라벨 — 위와 같다' },
  { file: 'src/components/dashboard/IssueTrendCard.tsx', hit: 'fontSize 10px', n: 2, use: '이슈 추이 차트의 축 눈금·주 라벨(SVG)', why: 'viewBox 단위 축 라벨 — 주 라벨은 칸 간격에 묶여 겹친다' },
  { file: 'src/components/dashboard/IssueTrendCard.tsx', hit: 'fontSize 11px', n: 1, use: '이슈 추이 선 끝의 현재 잔량 숫자(SVG)', why: 'viewBox 단위 — 오른쪽 여백(PR)에 들어가는 값이고 같은 수가 카드 요약에 있다' },
  { file: 'src/components/dashboard/SpiPanel.tsx', hit: 'fontSize 10px', n: 3, use: 'SPI 반원 게이지의 눈금 0.5·1.0·1.5(SVG)', why: 'viewBox 단위 눈금 — 게이지 바깥 좁은 여백에 놓인다' },
  { file: 'src/components/dashboard/MilestoneTimeline.tsx', hit: 'fontSize 10px', n: 1, use: '마일스톤 타임라인의 이름 라벨(SVG, FS_NAME)', why: 'viewBox 단위 — 줄바꿈·겹침 회피 계산(textWidth·MAX_LINE_W)이 이 크기에 묶여 있다' },
  { file: 'src/components/dashboard/MilestoneTimeline.tsx', hit: 'fontSize 9px', n: 2, use: '마일스톤 타임라인의 날짜·오늘 라벨(SVG, FS_SUB)', why: '위와 같은 배치 계산에 묶인 보조 라벨' },
  { file: 'src/components/portfolio/PortfolioMilestoneBoard.tsx', hit: 'fontSize 9px', n: 2, use: '포트폴리오 마일스톤 보드의 월 눈금·오늘(SVG)', why: 'viewBox 단위 축 눈금 — 머리 높이 18 에 맞춰져 있다' },
]

/** WBS 글자 배율 변수 가운데 100% 에서 12px 미만인 것 — 간트 눈금·막대·표지 도형(위 목록의 폴백과 같은 자리) */
const WBS_SMALL_VARS = ['--wbs-bar-font', '--wbs-day-font', '--wbs-owner-mark-font', '--wbs-timeline-font']

const expand = (rows: { file: string; hit: string; n: number }[]): string[] => rows.flatMap((r) => Array.from({ length: r.n }, () => `${r.file} ${r.hit}`)).sort()

describe('글자 크기 하한 12px', () => {
  it('src 의 12px 미만 글자는 허용 목록과 건수까지 같다(밖에 0건, 죽은 예외 0건)', () => {
    const found = srcFiles().flatMap(([f, t]) => smallFontHits(f, t).map((h) => `${f} ${h}`)).sort()
    expect(found).toEqual(expand(ALLOW))
  })
  it('허용 목록의 줄마다 용도와 사유가 있고 같은 (파일·표기) 가 두 번 나오지 않는다', () => {
    for (const a of ALLOW) {
      expect(a.use.length, `${a.file} ${a.hit}`).toBeGreaterThan(4)
      expect(a.why.length, `${a.file} ${a.hit}`).toBeGreaterThan(9)
      expect(a.n).toBeGreaterThan(0)
    }
    const keys = ALLOW.map((a) => `${a.file} ${a.hit}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('WBS 글자 배율 변수 — 100% 에서 12px 미만은 간트 눈금·막대·표지 도형 넷뿐이다', () => {
    const small = Object.entries(wbsFontScaleVariables(100)).filter(([, v]) => parseFloat(v) < MIN_PX).map(([k]) => k).sort()
    expect(small).toEqual(WBS_SMALL_VARS)
  })
})

/** 대문자 변환·넓은 자간 — 클래스·CSS 선언 */
export function capsHits(file: string, text: string): string[] {
  const out: string[] = []
  if (/\.css$/.test(file)) {
    for (const m of text.matchAll(/text-transform\s*:\s*uppercase|letter-spacing\s*:\s*\d*\.?\d*[1-9]\d*(?:em|px|rem)/g)) out.push(m[0])
    for (const m of text.matchAll(/@apply[^;]*/g)) out.push(...capsClassHits(m[0]))
    return out
  }
  return /\.tsx$/.test(file) ? capsClassHits(text) : out
}
const capsClassHits = (text: string): string[] =>
  [...text.matchAll(/(?<![\w-])(?:uppercase|tracking-wide(?:r|st)?|tracking-\[\d*\.?\d+(?:em|px|rem)\])(?![\w-])/g)].map((m) => m[0])

/** 영문 대문자 머리글 문구 — eyebrow·KPI 라벨 prop 과 사전 값 */
const CAPS_WORDS = /^[A-Z][A-Z0-9 &·/-]{3,}$/
export function capsCopyHits(file: string, text: string): string[] {
  const out: string[] = []
  if (/\.tsx$/.test(file)) {
    for (const m of text.matchAll(/\b(?:eyebrow|label)=(?:"([^"]*)"|\{'([^']*)'\}|\{`([^`]*)`\})/g)) {
      const v = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '').trim()
      if (CAPS_WORDS.test(v)) out.push(m[0])
    }
  }
  if (/^src\/lib\/i18n\/dict\//.test(file)) {
    for (const m of text.matchAll(/^\s*'([\w.-]+)':\s*'([^']*)'/gm)) if (CAPS_WORDS.test(m[2])) out.push(`${m[1]}=${m[2]}`)
  }
  return out
}
/** 대문자 그대로 두는 사전 값 — 스타일이 아니라 표기 자체가 그 낱말인 것 */
export const CAPS_COPY_ALLOW: { file: string; hit: string; why: string }[] = [
  { file: 'src/lib/i18n/dict/kanban.ts', hit: 'kanban.ddayToday=D-DAY', why: '마감 당일 표기 — D-3·D+2 와 같은 줄의 코드 표기다' },
  { file: 'src/lib/i18n/dict/kanban.en.ts', hit: 'kanban.ddayToday=D-DAY', why: '위와 같다' },
]

describe('대문자·넓은 자간 라벨 0건', () => {
  it('src 에 uppercase·tracking-wide 계열·양수 임의 자간 유틸, text-transform: uppercase, 양수 letter-spacing 이 없다', () => {
    expect(srcFiles().flatMap(([f, t]) => capsHits(f, t).map((h) => `${f} ${h}`))).toEqual([])
  })
  it('영문 대문자 머리글 문구는 허용 목록(코드 표기)뿐이다', () => {
    const found = srcFiles().flatMap(([f, t]) => capsCopyHits(f, t).map((h) => `${f} ${h}`)).sort()
    expect(found).toEqual(CAPS_COPY_ALLOW.map((a) => `${a.file} ${a.hit}`).sort())
    for (const a of CAPS_COPY_ALLOW) expect(a.why.length, a.hit).toBeGreaterThan(4)
  })
})

describe('판정기가 살아 있다 — 모양별 표본', () => {
  it('12px 미만을 모양마다 잡는다', () => {
    expect(smallFontHits('a.tsx', 'text-[10px] text-[10.5px] text-[0.7rem] text-[12px] text-[13px] text-[0.75rem] text-meta')).toEqual(['text-[10px]', 'text-[10.5px]', 'text-[0.7rem]'])
    expect(smallFontHits('a.tsx', '<text fontSize={9} /> style={{ fontSize: 11 }} fontSize={12} fontSize: 14')).toEqual(['fontSize 9px', 'fontSize 11px'])
    expect(smallFontHits('a.tsx', "const FS_SUB = 9, FS_OK = 12\n<text fontSize={FS_SUB} /><text fontSize={FS_OK} />")).toEqual(['fontSize 9px'])
    expect(smallFontHits('a.tsx', "fontSize: 'var(--wbs-day-font, 9px)' fontSize: 'max(12px, var(--wbs-day-font, 9px))' fontSize: 'var(--wbs-cell-font, 12px)' fontSize=\"10px\"")).toEqual(['fontSize 9px', 'fontSize 10px'])
    expect(smallFontHits('a.module.css', '.a { font-size: 10.5px } .b { font-size: .7rem } .c { font-size: 12px } .d { font-size: 0.93em }')).toEqual(['font-size 10.5px', 'font-size 11.2px'])
  })
  it('계산식·무관한 낱말은 잡지 않는다', () => {
    expect(smallFontHits('a.tsx', "style={{ fontSize: Math.round(size * 0.46) }} wbsFontScale 'wbs.fontSize': 'WBS 글자 크기' text-[var(--x)]")).toEqual([])
  })
  it('대문자·자간 유틸과 CSS 선언을 잡고, 좁은 자간·toUpperCase() 는 지나친다', () => {
    expect(capsHits('a.tsx', 'uppercase tracking-wide tracking-wider tracking-widest tracking-[0.14em] tracking-[.08em]')).toEqual(['uppercase', 'tracking-wide', 'tracking-wider', 'tracking-widest', 'tracking-[0.14em]', 'tracking-[.08em]'])
    expect(capsHits('a.tsx', 'tracking-tight tracking-tighter tracking-[-0.02em] key.toUpperCase() normal-case')).toEqual([])
    expect(capsHits('a.css', '.a { text-transform: uppercase; letter-spacing: .14em } .b { letter-spacing: -.01em } .c { letter-spacing: 0 } .d { @apply uppercase tracking-tight; }')).toEqual(['text-transform: uppercase', 'letter-spacing: .14em', 'uppercase'])
  })
  it('영문 대문자 머리글 문구를 잡고, 약어 한 낱말·한글·섞인 표기는 지나친다', () => {
    expect(capsCopyHits('a.tsx', '<SectionCard eyebrow="EXECUTIVE SUMMARY" /><KpiCard label="TODAY" /><KpiCard label={`ACTIVE ${days}D`} /><Modal eyebrow={\'ACCESS LOG\'} />')).toHaveLength(4)
    expect(capsCopyHits('a.tsx', '<SectionCard eyebrow="일반" /><KpiCard label="WBS" /><KpiCard label="PPT" /><Modal eyebrow="New account" /><KpiCard label="전체 실적" />')).toEqual([])
    expect(capsCopyHits('src/lib/i18n/dict/x.ts', "  'a.b': 'KNOWLEDGE MAP',\n  'a.c': 'Knowledge Map',\n  'a.d': 'WBS',\n")).toEqual(['a.b=KNOWLEDGE MAP'])
  })
})
