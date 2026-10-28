export function page<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}
