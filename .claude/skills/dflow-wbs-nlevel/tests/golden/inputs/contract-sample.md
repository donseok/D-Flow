---
project: MES
module: mes-op
start_date: 2026-09-01

# 단계 정의 — 이름·접두어·진도 역할. 이 배열이 프로젝트 설정(level_labels)의 정본.
levels:
  - { name: Phase,     prefix: PH,  progress: rollup }
  - { name: System,    prefix: SYS, progress: rollup }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true,
      upload: fold }   # 노드로 안 올리고 부모 Task 의 acceptance 로 접어 올림

# input 층의 stage → 진도 크레딧 (category 별)
credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }   # I/F 는 연동돼야 절반 이상
  doc:     { 미착수: 0, 작성중: 30, 제출: 50, 검수완료: 100 }      # 선행 산출물용
---

# WBS — MES

## PH-01: 분석

### SYS-OP: 조업

#### WP-AN-OP: 조업 요건정의
- [ ] TSK-AN-001: 조업 AS-IS 분석서            @박PL  w:5  ~2026-09-19  credit:doc
- [ ] TSK-AN-002: 입측/출측 요건정의서          @박PL  w:5  ~2026-09-26  credit:doc
- [ ] TSK-AN-003: L2 I/F 요건 목록             @이OO  w:3  ~2026-09-26  credit:doc
- [M] 분석 완료 보고회                          ~2026-09-30              # progress:none — 마일스톤

## PH-03: 구축

### SYS-OP: 조업

#### SUB-IN: 입측

##### WP-IN-PR: 프로세스

###### ACT-IN-PR-1: 실적 관리                                # Activity — 그룹핑 전용, 입력 금지
- [ ] TSK-IN-001: 입측 실적 수집 프로세스       @홍길동 w:5  ~2026-10-17
  - [ ] STK-IN-001-1: 크레인 계량 연계 확인                   # checklist — 집계 불개입
  - [ ] STK-IN-001-2: 중복 수신 방어 로직
  - [x] STK-IN-001-3: 실적 테이블 설계 리뷰
- [ ] TSK-IN-002: 입측 실적 정정               @홍길동 w:3  ~2026-10-24
- [ ] TSK-IN-003: 실적 마감 배치               @김대리 w:2  ~2026-10-24

###### ACT-IN-PR-2: 판정
- [ ] TSK-IN-011: 입측 판정 프로세스            @홍길동 w:5  ~2026-10-31
- [ ] TSK-IN-012: 판정 예외 처리               @홍길동 w:2  ~2026-10-31

##### WP-IN-UI: 화면                                          # Activity 생략 — Task 직결 (혼재 OK)
- [ ] TSK-IN-101: 입측 작업 현황 화면           @김철수 w:3  ~2026-10-17
- [ ] TSK-IN-102: 입측 실적 조회 화면           @김철수 w:2  ~2026-10-24
- [ ] TSK-IN-103: 입측 수동 보정 화면           @김철수 w:3  ~2026-10-31

#### SUB-OUT: 출측

##### WP-OUT-PR: 프로세스
- [ ] TSK-OUT-001: 출측 실적 수집 프로세스      @최OO  w:5  ~2026-11-07
##### WP-OUT-UI: 화면
- [ ] TSK-OUT-101: 출측 작업 현황 화면          @김철수 w:3  ~2026-11-07

#### SUB-L2IF: L2 I/F

##### WP-L2-2CGL: 2CGL

###### ACT-2CGL-RX: 수신
- [ ] TSK-L2-221: 트래킹 수신 I/F              @이OO  w:5  ~2026-11-14  credit:if
  - [ ] STK-L2-221-1: 전문 파싱 모듈
  - [ ] STK-L2-221-2: 재전송 처리
- [ ] TSK-L2-223: 품질실적 수신 I/F            @이OO  w:3  ~2026-11-21  credit:if

###### ACT-2CGL-TX: 송신
- [ ] TSK-L2-222: 코일 정보 송신 I/F           @이OO  w:3  ~2026-11-21  credit:if

##### WP-L2-ACCL: ACCL
- [ ] TSK-L2-291: 실적 수신 I/F                @이OO  w:3  ~2026-11-28  credit:if

#### SUB-ERPIF: ERP I/F

##### WP-ERP-PR: 생산실적
- [ ] TSK-ERP-301: 조업 실적 ERP 송신 I/F      @박OO  w:5  ~2026-11-28  credit:if  if-id:IF-0031
- [ ] TSK-ERP-302: 실적 정정 송신 I/F          @박OO  w:2  ~2026-12-05  credit:if  if-id:IF-0033
##### WP-ERP-WO: 작업지시
- [ ] TSK-ERP-311: 생산오더 수신 I/F           @박OO  w:3  ~2026-12-05  credit:if  if-id:IF-0032
