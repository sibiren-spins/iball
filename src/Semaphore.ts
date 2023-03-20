import EventEmitter from "node:events";

type MessagePair = [wait: Promise<void> | null, signal: Promise<void> | null];
type ResolvePair = [wait: (() => void) | null, signal: (() => void) | null];

/*
 *
 * A semaphore with a queue of tuples of wait and signal.
 * On a wait received with no signal, that side will wait for a signal.
 * If another wait is received, it will be added to the end of the queue.
 * On a signal received, it will resolve a wait at the beginning of the queue,
 * or it will be added to the end if another signal is pending.
 * If the wait is added later, it will resolve immediately.
 * That way, await can be used on the wait side and the promise will simply
 * resolve when signalled. Additionally, signal can be awaited to be sure something
 * picked it up. In this way, wait and signal are really only conceptual and signify
 * a consistent two sides of an interdependent process, and as such the effect of
 * all of this is bidirectional signalling.
 * 
 */
export class Semaphore {
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

      const newMessagePair: MessagePair = [null, null];
      const newResolvePair: ResolvePair = [null, null];
      const signalMessage = new Promise<void>(res => { newResolvePair[1] = res });
      newMessagePair[1] = signalMessage;
      this.messagePairs.push(newMessagePair);
      this.resolvePairs.push(newResolvePair);
      return await newMessagePair[1];
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

      const newMessagePair: MessagePair = [null, null];
      const newResolvePair: ResolvePair = [null, null];
      const signalMessage = new Promise<void>(res => { newResolvePair[0] = res });
      newMessagePair[0] = signalMessage;
      this.messagePairs.push(newMessagePair);
      this.resolvePairs.push(newResolvePair);
      return await newMessagePair[0];
  }

  waitAll() {
    return new Promise(res => {
      this.eventEmitter.once('clear', res);
    })
  }
}
