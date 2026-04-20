let counter = 0;

export function nextId(prefix = 'c'): string {
  counter = (counter + 1) & 0xffffff;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
