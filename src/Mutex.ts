import EventEmitter from "node:events";

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

type MessagePair = [wait: Promise<void> | null, signal: Promise<void> | null];
type ResolvePair = [wait: (() => void) | null, signal: (() => void) | null];

export class SemaphoreQueue {
  messagePairs: MessagePair[] = [];
  resolvePairs: ResolvePair[] = [];

  get firstMessagePair() {
    return this.messagePairs.at(0);
  }

  get firstResolvePair() {
    return this.resolvePairs.at(0);
  }

  get lastMessagePair() {
    return this.messagePairs.at(-1);
  }

  get lastResolvePair() {
    return this.resolvePairs.at(-1);
  }

  eventEmitter: EventEmitter = new EventEmitter();
  
  async signal() {
    if (this.firstMessagePair?.[0] != null) { // there is a wait already
      const resume = this.firstMessagePair[0].then(() => {
        if (this.messagePairs.length === 0) {
          this.eventEmitter.emit("clear");
        }
      });
      this.messagePairs.shift();
      const signalPair = this.resolvePairs.shift();
      signalPair![0]!();
      return await resume;
    }

    //if (this.lastMessagePair == null || this.lastMessagePair?.[1] != null) { // already a signal with no wait, or nothing there
      const newMessagePair: MessagePair = [null, null];
      const newResolvePair: ResolvePair = [null, null];
      const signalMessage = new Promise<void>(res => { newResolvePair[1] = res });
      newMessagePair[1] = signalMessage;
      this.messagePairs.push(newMessagePair);
      this.resolvePairs.push(newResolvePair);
      return await newMessagePair[1];
    //}
  }

  async wait() {
    if (this.firstMessagePair?.[1] != null) {
      const resume = this.firstMessagePair[1].then(() => {
        if (this.messagePairs.length === 0) {
          this.eventEmitter.emit("clear");
        }
      });
      this.messagePairs.shift();
      const signalPair = this.resolvePairs.shift();
      signalPair![1]!();
      return await resume;
    }

    //if (this.lastMessagePair == null || this.lastMessagePair?.[0] != null) { // already a wait with no signal, or nothing there
      const newMessagePair: MessagePair = [null, null];
      const newResolvePair: ResolvePair = [null, null];
      const signalMessage = new Promise<void>(res => { newResolvePair[0] = res });
      newMessagePair[0] = signalMessage;
      this.messagePairs.push(newMessagePair);
      this.resolvePairs.push(newResolvePair);
      return await newMessagePair[0];
    //}
  }

  waitAll() {
    return new Promise(res => {
      this.eventEmitter.once('clear', res);
    })
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