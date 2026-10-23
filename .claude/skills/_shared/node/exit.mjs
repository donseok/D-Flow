// 종료 코드 규약과 종료 헬퍼 (python argparse 규약과 동일).
// 사용 오류 = 2, 검사 위반(실패) = 1, 정상 = 0.

export const OK = 0;
export const VIOLATION = 1;
export const USAGE = 2;

/**
 * process.exit() 를 직접 부르지 않고 종료 코드만 지정한다.
 * 큰 stdout 을 파이프로 쓰는 중에 process.exit() 를 호출하면 일부가 잘리므로,
 * 코드를 지정한 뒤 main 에서 return 하여 이벤트 루프가 자연스럽게 비워지게 한다.
 *   예) `return finish(VIOLATION);`
 */
export function finish(code = OK) {
  process.exitCode = code;
  return code;
}
