export class Mutex {
  private current = Promise.resolve();
  private resolveCurrent?: () => void;
  
  lock() {
      let _resolve: () => void;
      const p = new Promise<void>(resolve => {
          _resolve = () => resolve();
      });
      // Caller gets a promise that resolves when the current outstanding
      // lock resolves
      const rv = this.current.then(() => _resolve);
      const prevCurrent = this.resolveCurrent!;
      this.resolveCurrent = () => {
        prevCurrent?.();
        this.resolveCurrent = () => {
          _resolve();
          this.resolveCurrent = undefined;
        }
      }
      // Don't allow the next request until the new promise is done
      this.current = p;
      // Return the new promise
      return rv;
  };

  release() {
    if (this.resolveCurrent === undefined) return false;
    this.resolveCurrent();
    return true;
  }

  flush() {
    let result: boolean;
    while ((result = this.release())) {}
  }
}

export class SemaphoreBasic {
  messagePair: [wait: Promise<void> | null, signal: Promise<void> | null] = [null, null];
  resolvePair: [wait: (() => void) | null, signal: (() => void) | null] = [null, null];
  
  async signal() {
    if (this.messagePair[1] !== null) throw new Error('Signaled while already signaled.');
    if (!this.messagePair[0]) {
      this.messagePair[1] = new Promise<void>(res => { this.resolvePair[1] = res }).then(() => { 
        this.messagePair[1] = null;
        this.resolvePair[1] = null;
      });
      return await this.messagePair[1];
    }

    const resume = this.messagePair[0].then();
    this.resolvePair[0]?.();
    return await resume;
  }

  async wait() {
    if (this.messagePair[0] !== null) throw new Error('Waited while semaphore was already waiting.');
    if (!this.messagePair[1]) {
      this.messagePair[0] = new Promise<void>(res => { this.resolvePair[0] = res }).then(() => { 
        this.messagePair[0] = null;
        this.resolvePair[0] = null;
      });
      return await this.messagePair[0];
    }

    const resume = this.messagePair[1].then();
    this.resolvePair[1]?.();
    return await resume;
  }
}

/*
 *
 * A semaphore design, with an array of tuples of wait and signal
 * on a wait received with no signal, that side will wait for a signal
 * if another wait is received, it will be added to the end of the array
 * on a signal received, it will be added to the beginning of the array
 * and the wait will be resolved if it exists
 * if the wait is added later, it will resolve immediately
 * that way, await can be used on the wait side and the promise will simply
 * resolve when signalled
 * 
 */