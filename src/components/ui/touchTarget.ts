/**
 * 터치 타깃(개정 §5.10.2 — 터치 상호작용 영역 44px 이상). 보이는 크기는 그대로 두고 누를 수 있는 영역만 가운데 44px 로 넓힌다(투명 ::before — 가운데 맞춤은 음수 여백 22px, transform 을 쓰지 않는다).
 * 넓힌 영역은 조상의 overflow 에 잘리고 이웃의 영역과 겹치면 안 된다 — 둘레 여백이 (44 − 보이는 크기)/2 이상인 자리에만 쓴다.
 */
export const TOUCH_TARGET =
  "relative before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-ml-5.5 before:-mt-5.5 before:content-['']"
