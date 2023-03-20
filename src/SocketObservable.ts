import { RawData, WebSocket } from 'ws';
import { ReplaySubject } from 'rxjs';
import { SocketMessageDispatcher } from './SocketMessageDispatcher';

type MessageType = string | number | Uint8Array | object;

type Flatten<TInput> = TInput extends SocketObservable<infer R> ? Flatten<R>[] : TInput;

type Extract<TInput> = TInput extends SocketObservable<infer R> ? Extract<R> : TInput;


export class SocketObservable<T> extends ReplaySubject<Extract<T>> {
  constructor(private socket: WebSocket, private dispatcher: SocketMessageDispatcher | null = null) {
    super();
    if (this.dispatcher === null) {
      this.dispatcher = new SocketMessageDispatcher(this.socket);
      this.beginEmitLoop();
    }
  }

  async beginEmitLoop() {
    if (!this.dispatcher) throw new Error('Dispatcher vanished.')
    if (!this.dispatcher.available) await this.dispatcher.waitForSocketOpen();
    while (this.dispatcher.available) {
      this.next(undefined as any);
      await this.dispatcher.handlerSemaphore.waitAll();
    }
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
//    ): [TExpect] extends [number | ((state: Extract<T>) => number) | ((state: Extract<T>) => (() => boolean))] ? SocketObservable<SocketObservable<TReturn>> : SocketObservable<TReturn> {
  ): SocketObservable<TReturn> {
    const innerObservable: SocketObservable<TReturn> = new SocketObservable(this.socket, this.dispatcher);
    this.subscribe((state: Extract<T>) => {
      let loopState: Extract<TReturn>;
      this.dispatcher?.handlerSemaphore.wait();
      // receive message
      // create next observable listening to next on this one
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
        //const message = await this.getSocketMessage<TMessage>();
        if (!this.dispatcher) throw new Error('Dispatcher vanished.');
        
        const result = await this.dispatcher.next();
        if (!result.value) throw new Error('No value was returned and one was expected.');
        const message = result.value;
        const parsedMessage = this.parseMessage<TMessage>(...message);
        loopState = (await handler(parsedMessage, loopState as any ?? state)) as Extract<TReturn>;
      }).catch(err => this.error?.(err)).then(() => {
        innerObservable.next?.(loopState);
        this.dispatcher?.handlerSemaphore.signal();
      })
    });
    return innerObservable;
  }

  getSocketMessage<TMessage>() {
    return new Promise<TMessage>(res => {
      const messageHandler = async (msg: RawData, isBinary: boolean) => {
        this.socket.off('message', messageHandler);
        const parsedMessage = this.parseMessage<TMessage>(msg, isBinary);
        res(parsedMessage);
      }
      this.socket.on('message', messageHandler)
    });
  }
}

export function getObservable(socket: WebSocket): SocketObservable<never> {
  return new SocketObservable(socket);
}