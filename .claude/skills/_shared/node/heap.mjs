// 이진 최소 힙. python `heapq` 의 알고리즘(_siftdown/_siftup)을 그대로 옮겨,
// 비교 함수가 동률을 만드는 경우에도 pop 순서가 python 과 같다.

/**
 * python 튜플 비교 순서. 요소를 앞에서부터 비교하고 같으면 다음 요소, 모두 같으면 짧은 쪽이 작다.
 * 숫자·불리언·bigint 는 수 비교, 문자열은 코드포인트 순(compareCodePoint), 배열은 재귀.
 * 서로 다른 형식은 python 처럼 TypeError.
 */
import { compareCodePoint } from './pytext.mjs';

function cmpScalar(a, b) {
  const ta = typeof a === 'boolean' ? 'number' : typeof a === 'bigint' ? 'number' : typeof a;
  const tb = typeof b === 'boolean' ? 'number' : typeof b === 'bigint' ? 'number' : typeof b;
  if (Array.isArray(a) && Array.isArray(b)) return compareTuples(a, b);
  if (ta !== tb) throw new TypeError(`compareTuples: 비교할 수 없는 형식 (${ta} vs ${tb})`);
  if (ta === 'string') return compareCodePoint(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareTuples(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return cmpScalar(a, b);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = cmpScalar(a[i], b[i]);
    if (c !== 0) return c;
  }
  return a.length - b.length < 0 ? -1 : a.length > b.length ? 1 : 0;
}

export class MinHeap {
  /** @param {(a:any,b:any)=>number} [compare] 음수면 a 가 먼저. 기본 compareTuples. */
  constructor(compare = compareTuples, items = []) {
    this.compare = compare;
    this.items = [];
    for (const x of items) this.items.push(x);
    for (let i = (this.items.length >> 1) - 1; i >= 0; i--) this.#siftUp(i); // heapify
  }

  /** 길이. 프로퍼티(getter)이며 메서드가 아니다: `heap.size > 0` */
  get size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this.#siftDown(0, this.items.length - 1);
  }

  /** 가장 작은 원소를 꺼낸다. 비어 있으면 undefined(python 은 IndexError). */
  pop() {
    const h = this.items;
    const last = h.pop();
    if (h.length === 0) return last;
    const ret = h[0];
    h[0] = last;
    this.#siftUp(0);
    return ret;
  }

  peek() {
    return this.items[0];
  }

  #lt(a, b) {
    return this.compare(a, b) < 0;
  }

  #siftDown(start, pos) {
    const h = this.items;
    const item = h[pos];
    while (pos > start) {
      const parentPos = (pos - 1) >> 1;
      const parent = h[parentPos];
      if (this.#lt(item, parent)) {
        h[pos] = parent;
        pos = parentPos;
        continue;
      }
      break;
    }
    h[pos] = item;
  }

  #siftUp(pos) {
    const h = this.items;
    const end = h.length;
    const start = pos;
    const item = h[pos];
    let child = 2 * pos + 1;
    while (child < end) {
      const right = child + 1;
      if (right < end && !this.#lt(h[child], h[right])) child = right;
      h[pos] = h[child];
      pos = child;
      child = 2 * pos + 1;
    }
    h[pos] = item;
    this.#siftDown(start, pos);
  }
}
