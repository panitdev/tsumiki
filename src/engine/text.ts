export function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) {
      next[j + 1] = Math.min(previous[j + 1] + 1, next[j] + 1,
        previous[j] + Number(left[i] !== right[j]));
    }
    previous = next;
  }
  return previous[right.length];
}
