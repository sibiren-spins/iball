/* SPDX-License-Identifier: MIT */
/* Copyright © 2023 Cecilia Brewer <cecilia@rainbowhousegroup.org> */

import { RawData, WebSocket } from 'ws';
import { ReplaySubject } from 'rxjs';
import { SocketMessageDispatcher } from './SocketMessageDispatcher';
import { Semaphore } from './Semaphore';

type MessageType = string | number | Uint8Array | object;

type Extract<TInput> = TInput extends SocketObservable<infer R> ? Extract<R> : TInput;

type BufferLike =
    | string
    | Buffer
    | DataView
    | number
    | ArrayBufferView
    | Uint8Array
    | ArrayBuffer
    | SharedArrayBuffer
    | ReadonlyArray<any>
    | ReadonlyArray<number>
    | { valueOf(): ArrayBuffer }
    | { valueOf(): SharedArrayBuffer }
    | { valueOf(): Uint8Array }
    | { valueOf(): ReadonlyArray<number> }
    | { valueOf(): string }
    | { [Symbol.toPrimitive](hint: string): string }

const skipSendSymbol = Symbol('skipSend');
type SkipSendSymbol = typeof skipSendSymbol;


export class SocketObservable<T> extends ReplaySubject<Extract<T>> {
  private dispatcher: SocketMessageDispatcher;

  constructor(socket: WebSocket);
  /**
   * 
   * @param socket 
   * @param dispatcher 
   * @param handlerSemaphore 
   * @internal do not use.
   */
  constructor(socket: WebSocket, dispatcher: SocketMessageDispatcher, handlerSemaphore: Semaphore);
  constructor(private socket: WebSocket, dispatcher: SocketMessageDispatcher | null = null, private handlerSemaphore: Semaphore = new Semaphore()) {
    super();
    if (dispatcher === null) {
      this.dispatcher = new SocketMessageDispatcher(this.socket);
      this.beginEmitLoop();
    } else {
      this.dispatcher = dispatcher;
    }
  }

  async beginEmitLoop() {
    if (!this.dispatcher) throw new Error('Dispatcher vanished.')
    if (!this.dispatcher.available) await this.dispatcher.waitForSocketOpen();
    while (this.dispatcher.available) {
      this.next(undefined as any);
      let interval: NodeJS.Timer;
      await Promise.race([this.handlerSemaphore.waitAll(), new Promise<void>(res => {
        interval = setInterval(() => {if (!this.dispatcher?.available) res()}, 1000)
      })]);
      clearInterval(interval!);
    }
    this.complete();
  }

  parseMessage<TMessage>(message: RawData, isBinary: boolean, outputFormat: 'json' | 'buffer' = 'json'): TMessage {
    if (outputFormat === 'buffer') {
      if (isBinary) {
        return message as TMessage;
      }
      return Buffer.from(message as unknown as string, 'utf8') as TMessage
    }
    
    
    if (isBinary) {
      const messageString = message.toString('utf-8');
      return JSON.parse(messageString);
    }
    try {
      return JSON.parse(message as unknown as string);
    } catch (err) {
      return message as unknown as TMessage;
    }
  }

  receive<TMessage extends MessageType, TReturn, TExpect extends number | ((state: Extract<T>) => number) | ((state: Extract<T>) => ((intermediate: Extract<TReturn>) => boolean))>(
    handler: (message: TMessage, state: Extract<T>) => TReturn | Promise<TReturn>,
    expect?: TExpect
  ): SocketObservable<TReturn> {
    const innerObservable: SocketObservable<TReturn> = new SocketObservable(this.socket, this.dispatcher, this.handlerSemaphore);
    this.subscribe({
      next: (state: Extract<T>) => {
        let loopState: Extract<TReturn>;
        this.handlerSemaphore.wait();
        let iterationDeterminator: undefined | number | ((intermediate: Extract<TReturn>) => boolean) = undefined;
        let loop: (func: () => Promise<void>) => Promise<void>;
        if (typeof expect === 'number') {
          iterationDeterminator = expect;
        } else if (expect !== undefined) {
          iterationDeterminator = expect(state);
        }

        if (iterationDeterminator === undefined) {
          loop = async func => await func();
        } else if (typeof iterationDeterminator === 'number') {
          const iterationCount = iterationDeterminator;
          loop = async func => {
            for (let i = 0; i < iterationCount; i++) {
              await func();
            }
          }
        } else {
          const iterationCondition = iterationDeterminator;
          loop = async func => {
            while (!iterationCondition(loopState)) {
              await func();
            }
          }
        }

        loop(async () => {
          if (!this.dispatcher) throw new Error('Dispatcher vanished.');

          const result = await this.dispatcher.next();
          if (!result.value) throw new Error('No value was returned and one was expected.');
          const message = result.value;
          const parsedMessage = this.parseMessage<TMessage>(...message);
          loopState = (await handler(parsedMessage, loopState as any ?? state)) as Extract<TReturn>;
        }).catch(err => this.error?.(err)).then(() => {
          innerObservable.next?.(loopState);
          this.handlerSemaphore.signal();
        })
      }, complete: () => {
        innerObservable.complete();
      }
    });
    return innerObservable;
  }

  send(message: BufferLike, options?: { mask?: boolean | undefined; binary?: boolean | undefined; compress?: boolean | undefined; fin?: boolean | undefined }): SocketObservable<T>;
  send(messageTransform: (state: Extract<T>, skip: () => SkipSendSymbol) => BufferLike | SkipSendSymbol, options?: { mask?: boolean | undefined; binary?: boolean | undefined; compress?: boolean | undefined; fin?: boolean | undefined }): SocketObservable<T>;
  send(messageOrMessageTransform: BufferLike | ((state: Extract<T>, skip: () => SkipSendSymbol) => BufferLike | SkipSendSymbol), options?: { mask?: boolean | undefined; binary?: boolean | undefined; compress?: boolean | undefined; fin?: boolean | undefined }) {
    this.subscribe(state => {
      const skip = (): SkipSendSymbol => skipSendSymbol;
      let message: BufferLike | SkipSendSymbol;
      if (typeof messageOrMessageTransform === 'function') {
        message = messageOrMessageTransform(state, skip);
      } else {
        message = messageOrMessageTransform;
      }
      if (((skipOrMessage: BufferLike | SkipSendSymbol): skipOrMessage is BufferLike => skipOrMessage!== skipSendSymbol)(message))
        this.socket.send(message, options ?? {}, undefined);
    })
    return this;
  }
}

export function getObservable(socket: WebSocket): SocketObservable<never> {
  return new SocketObservable(socket);
}