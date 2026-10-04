# SP5c 검증 기록

현재 범위: F(순수 필드 계약)·D(DB 계약)·S 관리자 설정/레지스트리·V 값 저장 기반/WBS 상세 입력. 나머지 값 입력/목록/Excel/AI/합성은 남았으며 SP5c 전체 완료가 아니다. 기준 `8238de9f`, 개발 브랜치 `sp5c/custom-fields`.

| 검증 | 결과 | 시점(KST) |
|---|---|---|
| F 새 단위 테스트 | 127/127, 공통 값 골든 97건 | 10-04 20:34·20:40 |
| 전체 단위 | 12,176 통과 + 기존 firmlink 검사 1 실패 → 검증 디렉터리 준비 후 해당 33/33 및 F·migration 규약 165/165 통과 | 10-04 20:34–20:40 |
| 타입·lint | 오류 0, 기존 경고 4 | 10-04 20:51 |
| 프로덕션 build | 통과(실행 화면 검증 전) | 10-04 20:38 |
| 전용 DB reset | 0000–0027 재생, pre/postcheck 포함 | 10-04 20:48 |
| 전체 RLS | 44파일 856/856, skip 0 | 10-04 20:49 |
| 사용자 필드 DB | 117/117: 패리티·JWT·원자성·멱등·경합·롤백 재적용 | 전체 RLS 포함 |

사용 DB: API 54521/DB 54522, `d-flow-sp4`. 사용자 DB 54321/54322 및 원본/원격 DB 접속·적용 없음. 실제 사용자 DB 적용/메인 통합/성능 수용 미결 사항은 계획의 최신 확인 절을 따른다.

S 관리자 액션 커밋 `6ec37531`의 GitHub CI 성공. 설정 키 3개와 관리 화면 연결 후 전체 단위 12,219건 통과, 키 등록에 따른 기존 계약 검사 2건 보완 후 관련 79건/접근성 보완 UI 21건 통과. 최종 프로덕션 build 통과(타입·lint 오류 0, 기존 경고 4). settings:verify 문제 0.

로컬 실제 브라우저(Playwright 1.58.2, 앱 3101/API 54521)에서 필드 저장·새 조회·숫자 0·백필/필수·3탭·정확한 건수 삭제 확인. 1440px/390px 눈확인, 가로 넘침과 pageerror 없음. 임시 프로젝트와 계정 정리. 로컬 증거 `.superpowers/sp5c/field-browser-result.json` 및 desktop/mobile-top/mobile-bottom PNG. 카탈로그는 값 소비처·검색 배선 전이므로 stored를 유지한다.

## V WBS 상세 입력 연결 검증 (2026-10-04)

공통 값 입력기를 WBS 상세에 연결하고 로더→계산 트리→상세까지 타입 값을 전달했다. 기존 행 편집 권한을 좁혀 사용하며 관리자 전용·비활성 값은 읽기 전용이다. 새 서버 값이 도착해도 작성 중인 내용을 유지하고, 취소 시 최신 조회 값으로 바꾼다. 저장 성공 뒤 이전 props로 되돌아가지 않으며 저장 중 이중 제출을 막는다.

전체 단위 921파일 12,277건 모두 통과. 프로덕션 build·타입·lint 검사 통과. 실제 빌드 앱/전용 DB에서 WBS 값 0 조회→JWT 저장 2→다른 경로의 값 4 갱신→오래된 폼의 저장 3 충돌 차단→초안 3 유지→취소 후 최신 4 채택을 확인했다. 데스크톱 1440px/모바일 390px 눈확인, 가로 넘침/pageerror 없음. 임시 계정·프로젝트 정리. 로컬 증거 `.superpowers/sp5c/wbs-field-browser-result.json`, `wbs-fields-desktop.png`, `wbs-fields-mobile.png`.

WBS 시트 추가 열·키보드 이동, 이슈/주간 입력·목록과 필터, custom 실시간 페이로드 연결 등 V 후속 작업은 남았다. X/I/Z 및 최종 성능 검증도 남았으므로 SP5c 완료로 표시하지 않는다.

## V 이슈 상세 입력·직접 링크 검증 (2026-10-04)

이슈 로더/도메인/상세에 공통 입력기를 연결했다. false·0·선택 목록을 보존하고 손상 값은 편집 가능한 빈 객체로 바꾸지 않는다. 멤버의 추가 정보 편집은 기존 이슈 행 RLS로 검사하며 관리자 필드는 별도로 제한한다. 이슈 값 저장에는 updated_at을 함께 갱신해 색인 신선도 판정에서 변경을 놓치지 않게 했다(주간은 제한된 열 권한을 유지하고 기존 DB touch 트리거를 사용). 입력값을 원래 값으로 되돌렸을 때 다른 키 순서를 바꿔 불필요한 저장을 켜던 문제도 보완했다.

실제 브라우저에서 ?focus 직접 링크로 모달을 처음 열 때 React hydration 오류를 발견했다. 공통 Modal의 서버/첫 hydration은 포털을 생략하고 브라우저 마운트 뒤 포털과 포커스 처리를 함께 시작하도록 수정했다. 초기 열린 모달 SSR→hydration, 포커스·Escape·복원과 기존 모달 40건 통과. 전체 단위 921파일 12,279건 통과. 이후 수정 시각 보완의 액션/주간 열 검사 2파일 24건 통과, 최종 프로덕션 build·타입·lint 통과.

최종 빌드의 실제 브라우저/전용 DB에서 이슈의 required false 기본값→true JWT 저장→수정 시각 증가→직접 링크 새 조회를 확인했다. 1440px/390px 눈확인, pageerror/hydration 오류·가로 넘침 0. 같은 실행에서 WBS CAS·관리 화면 백필/purge 회귀도 통과. 임시 계정·프로젝트 및 앱 3101 정리. 로컬 증거 `.superpowers/sp5c/issue-field-browser-result.json`, `issue-fields-desktop.png`, `issue-fields-mobile.png`. 등록/수정 폼·목록/필터·주간·실시간 등 V 후속 및 X/I/Z는 남았다.

## V 실시간 사용자 필드 전달 검증 (2026-10-05)

0028은 WBS 변경 방송에 custom 전체 스냅샷을 포함하고 이슈 custom 변경 시각을 DB에서 갱신한다. WBS에는 일반 수정 시각 트리거가 없어 custom-only 방송의 시각이 그대로였으며, 실제 채널 가입 후에도 UI가 변경을 버리는 문제를 재현했다. 0029로 WBS custom 변경 시각도 단조 증가하게 보완했다. 같은 값 쓰기는 시각/방송을 바꾸지 않고 백필·purge도 동일 경로로 전달된다. 롤백은 0029→0028→0027 순서이며 기존 값/시각/감사 기록을 보존한다.

클라이언트는 custom 전체 스냅샷을 읽어 빈 객체 purge까지 반영한다. 구형 방송의 custom 생략은 기존 값을 유지하며, 손상 custom 방송은 거부한다. 시각 비교는 PostgreSQL 마이크로초를 보존해 같은 밀리초 내 변경을 놓치지 않는다.

전용 A DB 0000–0029 재생 성공(10-05 03:48 KST), 전체 RLS 45파일 864/864·skip0(실시간 신규 8건), 전체 타입 검사와 실시간/마이그레이션/actor 검사 40건 통과. 앱 변경의 직전 전체 단위 921파일 12,288건 및 lint/build 통과. CI에서 발견한 UI 옵션 픽스처 타입은 44561f6e에서 수정했으며, 이후 실패한 역사적 롤백 검사는 후속 마이그레이션부터 되돌리도록 보완했다. 새 커밋 CI 결과는 별도 확인한다.

실제 빌드 앱에서 private websocket 가입→작성 중 6에 서버 7 도착→초안 6 유지/저장 차단→취소 후 7→새로고침 없이 서버 9 반영을 확인했다. 실시간을 끈 별도 세션의 CAS, 이슈 false 기본값→true JWT 저장/수정 시각/직접 링크 조회, 설정 백필·필수·정확한 건수 purge도 통과. 1440/390 화면 눈확인, pageerror/가로 넘침 0. 임시 계정/프로젝트 정리. 증거 `.superpowers/sp5c/realtime-field-browser-result.json`, `wbs-fields-realtime-desktop.png`, `issue-fields-mobile.png`.

등록/수정 폼·목록/필터·WBS 시트 열/키보드·주간 값 입력, X/I/Z는 남았으며 SP5c와 카탈로그 fields의 상태는 완료/verified로 바꾸지 않는다.

## V 이슈 목록 사용자 필드 열·필터 (2026-10-05)

활성 show_in_list 필드를 순서대로 이슈 표에 추가했다. 기본 열의 비율을 유지하며 추가 열마다 160px을 배정하고 기존 표 내부 가로 스크롤을 사용한다. 공통 서식으로 숫자·단위·날짜·참/거짓·선택 라벨을 표시하고 손상 값/설정은 빈 데이터로 위장하지 않는다. 관리자 필드도 목록에서는 기존 행 읽기 권한으로 표시한다.

활성 필드 하나를 선택해 필터한다. 텍스트는 대소문자 구분 없는 포함, 숫자/날짜/참·거짓/단일 선택은 타입을 유지한 동일 값, 다중 선택은 선택한 모든 코드 포함이다. 필터의 빈 선택은 전체이며 입력의 미설정과 구분한다. false/0은 빈 조건이 아니다. 비활성 옵션도 역사적 라벨/코드로 찾을 수 있으며, 제거·비활성 필드는 숨은 필터로 남지 않는다. 필터 변경 시 첫 페이지로 이동한다. AI searchable 플래그는 목록 필터와 별개다.

목록/순수 필터 10건, 설정/상세 포함 회귀 4파일 44건 통과. 전체 타입 검사·lint(오류0, 기존 경고4)·최종 프로덕션 build 통과. 실제 브라우저에서 열/예 표시→false 조건 미일치→true 조건 일치→전체 해제, 1440/390 및 모바일 표 내부 추가 열 접근을 확인했다. WBS 실제 websocket·CAS, 이슈 JWT 저장/직접 링크, 설정 백필/purge 회귀도 함께 통과. pageerror·문서 가로 넘침0, 임시 데이터 정리. 증거 `.superpowers/sp5c/issue-list-browser-result.json`, `issue-list-desktop.png`, `issue-list-mobile.png`. 등록/수정 폼·WBS 시트·주간 및 X/I/Z는 후속으로 남는다.

## V 일반 이슈 등록·수정 폼 (2026-10-05)

등록 문맥에 fields.issue를 포함하고 손상 정의는 폼 제공을 차단한다. 일반 등록/수정 모달에 공통 7타입 입력을 연결했다. 관리자 전용·비활성 값은 읽기 전용이며, 권한이 좁아져도 미저장 값을 저장된 값처럼 표시하지 않는다. INSERT 검증은 필수 기본값을 고려하되 공급한 키만 반환해 DB의 기본값 생성 경로를 유지한다. 관리자/비활성 필수 기본값을 멤버가 명시적으로 공급하는 행위는 허용하지 않으며, optional 기본값은 자동 입력하지 않는다. UPDATE에는 기본값을 다시 넣지 않는다.

기본 정보와 custom은 기존 세션 JWT의 같은 INSERT/UPDATE에 담는다. custom을 포함한 수정은 id·project_id·기존 전체 JSONB CAS로 비교하며 0행이면 담당자 변경 전에 중단한다. 기존 작성자/관리자 전체 편집 관문과 DB의 필드 권한 재검사를 유지한다. 첨부 부분 실패 후에는 생성된 이슈를 다시 만들거나 필드 변경을 검증하지 않고 기존 첨부 재시도를 이어간다.

폼은 새 custom 값이 도착해도 초안을 유지한다. 실제 브라우저에서 제목만 편집한 경우 충돌 잠금이 자동 해제되는 문제를 찾아 명시적 채택 전까지 잠금을 유지하도록 보완했다. 충돌 조회에서 서버 제목도 바뀌면 기본 정보 초안도 보존한다. 추가 정보 초안 취소는 최신 custom만 채택한다. 편집 대상을 id로 다시 조회하되 대상이 사라지면 신규 등록 폼으로 전환하지 않는다.

전체 단위 924파일 12,308/12,308 통과. 새 액션/기본값/문맥/폼을 포함한 관련 검사 132건과 후속 보호 검사 25건·20건 통과. 전체 타입·최종 build 통과, lint 오류0/기존 경고4. 직전 8e4448ef GitHub CI의 test/db 모두 성공. 새 커밋 CI는 별도 확인한다.

최종 빌드 앱/전용 A DB에서 일반 폼의 required false 등록→기본 정보/custom 동시 수정→서버가 제목/custom을 동시에 갱신→오래된 폼의 양쪽 변경 차단→사용자 제목/추가 정보 초안 유지→명시적 최신 custom 채택→재저장을 확인했다. 1440/390 화면 눈확인, pageerror/문서 가로 넘침0. 기존 WBS 실제 websocket/CAS·이슈 상세/목록·설정 백필/purge도 함께 통과. 임시 프로젝트/계정과 앱 3101 정리. 증거 `.superpowers/sp5c/issue-form-browser-result.json`, `issue-form-desktop.png`, `issue-form-mobile.png`.

회의록 원문 연결 신규 등록은 별도 RPC가 custom 입력을 받지 않아 아직 추가 정보 입력을 노출하지 않는다. 해당 액션은 custom 공급을 명시적으로 거부해 값을 조용히 버리지 않으며 기존 DB 필수 기본값은 유지한다. 이 RPC 확장, WBS 시트 열/키보드·주간 입력, X/I/Z는 후속이다. SP5c 전체 미완료, fields 카탈로그 stored 유지. 사용자 DB/main에는 적용·통합하지 않았다.


2026-10-05: Linked-minute issue custom fields

The service-only create_issue_from_minute_block overload adds a required p_custom jsonb argument without changing the legacy 24-argument API. The action keeps source verification; under the existing settings FOR SHARE lock, SQL rechecks the actual actor and supplied admin/inactive keys. Required omitted defaults remain generated by the INSERT trigger. Core/custom, assignees and source links commit together. Rollback removes only the overload and preserves stored values, links and the legacy API. Older schema rehearsals roll back minute custom, WBS clock, custom realtime, then custom fields.

The linked-minute form explicitly opts in to custom inputs and receives the selected project permission from the guarded context action. Existing attachment retry continues to reuse the already-created issue id. Service privileges never substitute for the actor permission.

Dedicated d-flow-sp4 (54521/54522), CLI 2.75.0: clean reset and bootstrap passed. Full DB suite: 46 files, 869/869. Full unit suite: 924 files, 12,311/12,311. Five new DB cases cover zero/false and protected generated defaults; supplied admin values; inactive/unknown/null/type/unaffiliated actor rejection; bad-source/assignee atomicity; service-only ACL and rollback preservation.

2026-10-05 browser: dedicated d-flow-sp4 + built app 3101, real minute block -> 'create issue' with required zero default and admin-only boolean; server-derived admin permission, core/custom/source links saved atomically, 1440/390 no overflow or pageerror. Final DB reset 05:04 KST, full DB suite 46 files 869/869, lint 0 errors (4 existing warnings), build passed. Local evidence .superpowers/sp5c/minute-custom-browser-result.json.
