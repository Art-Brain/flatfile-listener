type MapValuesCallback<T, U> = (
  value: T,
  key: string,
  object: Record<string, T>
) => U;

export function mapValues<T, U>(
  obj: Record<string, T>,
  callback: MapValuesCallback<T, U>
): Record<string, U> {
  return Object.keys(obj).reduce((result, key) => {
    result[key] = callback(obj[key], key, obj);
    return result;
  }, {} as Record<string, U>);
}

export function groupBy<T>(
  array: T[],
  iteratee: (item: T) => string | number
): Record<string, T[]> {
  return array.reduce((acc, item) => {
    const key = iteratee(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
