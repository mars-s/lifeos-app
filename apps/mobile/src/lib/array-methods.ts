type Holds = (value: unknown, index: number, list: readonly unknown[]) => unknown;

const METHODS = {
  toSorted(this: readonly unknown[], compare?: (a: unknown, b: unknown) => number) {
    return Array.prototype.sort.call([...this], compare);
  },
  toReversed(this: readonly unknown[]) {
    return Array.prototype.reverse.call([...this]);
  },
  findLastIndex(this: readonly unknown[], holds: Holds) {
    for (let index = this.length - 1; index >= 0; index -= 1) if (holds(this[index], index, this)) return index;
    return -1;
  },
  findLast(this: readonly unknown[], holds: Holds) {
    for (let index = this.length - 1; index >= 0; index -= 1) if (holds(this[index], index, this)) return this[index];
    return undefined;
  },
};

export const addMissingArrayMethods = () => {
  const arrays: object = Array.prototype;
  for (const [name, value] of Object.entries(METHODS)) {
    if (!(name in arrays)) Object.defineProperty(arrays, name, { value, writable: true, configurable: true });
  }
};
