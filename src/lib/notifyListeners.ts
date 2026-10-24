/** Keep one faulty subscriber from hiding updates from the remaining subscribers. */
export function notifyListeners<Args extends unknown[]>(
  listeners: Iterable<(...args: Args) => void>,
  scope: string,
  ...args: Args
): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error) {
      console.error(`[${scope}] subscriber failed`, error);
    }
  }
}
