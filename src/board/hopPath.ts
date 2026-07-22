/** Ordered tile indices a token visits moving from `from` to `to`, i.e. from+1 … to,
 *  wrapping past 39 → 0. Matches the server's spacesToAnimate count. */
export function hopPath(from: number, to: number): number[] {
  const path: number[] = [];
  let i = from;
  do {
    i = (i + 1) % 40;
    path.push(i);
  } while (i !== to);
  return path;
}

/** Planar (x,z) offsets so up to 4 tokens sharing a tile don't overlap. World units. */
export const STACK = 0.28;
export const STACK_OFFSETS: [number, number][] = [
  [-STACK, -STACK], [STACK, -STACK], [-STACK, STACK], [STACK, STACK],
];
export function stackOffset(indexInTile: number): [number, number] {
  return STACK_OFFSETS[indexInTile % 4];
}
