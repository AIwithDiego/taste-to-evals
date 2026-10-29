// Events arrive (live from the engine, or all at once from a saved run); the story takes them one at a time.
export class Stream<E> {
  private items: E[] = [];
  private waiting: ((e: E) => void)[] = [];

  push(e: E): void {
    const resolve = this.waiting.shift();
    if (resolve) resolve(e);
    else this.items.push(e);
  }

  next(): Promise<E> {
    const e = this.items.shift();
    if (e !== undefined) return Promise.resolve(e);
    return new Promise((resolve) => this.waiting.push(resolve));
  }
}
