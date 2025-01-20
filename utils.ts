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
