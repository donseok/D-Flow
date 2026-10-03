// 옛 기본값 센티널(스펙 D8·E5·§4.8, 계획 P6·P13) — 원본 고객 기본값(주간 11구분명·5팀 코드·이슈 8영역·이슈 ID 접두·시간대)
// 목록의 유일한 평문 사본이다. 런타임 코드(src)는 이 값을 갖지 않는다. 부정 테스트·S10·E2E 가 출력에서 이 값이 0건인지 본다.
// .mjs 러너는 scripts/lib/sentinels.mjs 의 base64 사본(SP4 부분 집합)을 쓰고 tests/negative/sentinels.test.ts 가 같은지 대조한다.
// 일치 규칙(대소문자·영문 코드 경계·마스크·zip 텍스트 파트)은 scripts/lib/sentinels.mjs 하나에 있다 — 여기서 재수출한다.
import { excludeRegistered } from '../../scripts/lib/sentinels.mjs'

export { SENTINEL_MASKS, findSentinels, isZipTextPart, zipTextParts } from '../../scripts/lib/sentinels.mjs'

export const LEGACY_SENTINELS = {
  weeklySections: ['PMO', '영업', '구매', '관리회계', '품질', '생산계획', '조업', '표준화', '물류', '설비및L2', '가공'],
  teamCodes: ['PMO', 'ERP', 'MES', '가공', 'MDM'],
  issueAreas: ['기준관리', '손익관리', '영업', '품질·설계', '생산계획', '조업', '출하', '원가'],
  issueIdPrefix: 'PI-I-',
  timezone: ['Asia/Seoul', '+09:00'],
} as const

/** SP 별 부분 집합 — 그 SP 가 걷어 낸 기본값만. 뒤 SP 가 자기 줄을 더한다(SP5: 이슈 영역·ID 접두·시간대) */
export const SENTINELS_BY_SP = {
  SP4: [...new Set<string>([...LEGACY_SENTINELS.weeklySections, ...LEGACY_SENTINELS.teamCodes])],
  // SP5 A — 시간대(스펙 D43·§6.4 S10 A 몫). .mjs 사본은 scripts/lib/sentinels.mjs 의 SP5A_SENTINELS(평문 — 고객 문자열이 아니다)
  SP5A: Object.freeze([...LEGACY_SENTINELS.timezone]),
  // SP5 B1 — 프로젝트 이슈 영역·옛 PI 코드 접두(스펙 D8·§6.4 S10)
  SP5B1: Object.freeze([...LEGACY_SENTINELS.issueAreas, LEGACY_SENTINELS.issueIdPrefix]),
} as const satisfies Record<string, readonly string[]>

/** 그 프로젝트가 스스로 등록한 영역·팀의 code·name 과 **같은** 센티널만 뺀다(포함 관계로는 빼지 않는다 — 스펙 D8) */
export function sentinelsFor(sp: keyof typeof SENTINELS_BY_SP, registeredNames: readonly string[]): string[] {
  return excludeRegistered(SENTINELS_BY_SP[sp], registeredNames)
}
