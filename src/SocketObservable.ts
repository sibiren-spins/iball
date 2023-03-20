import { RawData, WebSocket } from 'ws';
import { Observable, Observer, ReplaySubject, Subject, Subscription } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { Mutex, SemaphoreBasic, SemaphoreQueue } from './Mutex';
import { nextTick } from 'node:process';

type MessageType = string | number | Uint8Array | object;

type Flatten<TInput> = TInput extends SocketObservable<infer R> ? Flatten<R>[] : TInput;

type Extract<TInput> = TInput extends SocketObservable<infer R> ? Extract<R> : TInput;

type SocketObservableType<T> = SocketObservable<T> | SocketObservable<T>

/*
 *
 *
 * Make same observable reusable for a new sequence of messages- treat values as items in a collection like usual
 * 
 */


// const socketObs = getObservable();

// socketObs
//   .receive((fileCount: number) => fileCount)
//   .receive(async (fileMetadata: File, fileCount: number) => {
//     const fileData = Buffer.alloc();
//     let receivedBytes = 0;
//     return [fileMetadata, fileData, receivedBytes] as [File, Buffer, number];
//   }, fileCount => fileCount)
//   .receive((fileChunk: Uint8Array, [fileMeta, fileData, receivedBytes]) => {
//     fileData.set(fileChunk, receivedBytes);
//     receivedBytes += fileChunk.byteLength;
//     return [fileMeta, fileData, receivedBytes] as [File, Buffer, number]; // some way to fix these to tuple type?
//   }, ([fileMeta, fileData, receivedBytes]) => () => fileMeta.size === receivedBytes)
//   .reduce((_, [fileMeta, fileData, receivedBytes]) => {
//     (fileMeta as any).buffer = fileData;
//     return fileMeta;
//   })
//   .subscribe(async file => {
    
//   })

// export class SocketObservable<T> {
//   // /**
//   //  * 
//   //  * @param messageCount 
//   //  */
//   // expect(messageCount: number): Expected<SocketObservable<T>> {

//   // }

//   /**
//    * Emits a value for every message received
//    */
//   receive<TMessage extends MessageType, TReturn, TExpect extends number | ((state: T) => number) | ((state: T) => (() => boolean))>(
//     handler: (this: SocketObservable<never>, message: TMessage, state: T) => TReturn | Promise<TReturn>,
//     expect?: TExpect
//     ): [TExpect] extends [number | ((state: T) => number)] ? AggregateSocketObservable<TReturn> : SocketObservable<TReturn> {
    
//   }
  
//   // for<TOutput>(iterationDeterminator: number | ((state: T) => number), handler: (this: SocketObservable<never>, state: T) => SocketObservable<TOutput>) {

//   // }
// //handler: (this: SocketObservable<never>, state: T) => TOutput | SocketObservable<TOutput>
//   // until(stopCondition: (state: T) => boolean): Expected<SocketObservable<T>> {

//   // }

//   subscribe(handler: (emittedValue: T) => void) {

//   }

//   reduce<TMessage extends MessageType, TOutput>(handler: (messages: TMessage[], state: T) => TOutput): TOutput { // reduce

//   }
// }

class SocketMessageDispatcher implements AsyncGenerator<[RawData, boolean]> {
  /**
   *
   */
  constructor(private socket: WebSocket) {
    this.messageMutex.lock();
    this.messageGenerator = this.getMessage();
    const messageHandler = async (message: RawData, isBinary: boolean) => {
      this.messageQueue.push([message, isBinary ?? false]);
      await this.messageSemaphore.signal();
    };
    this.socket.on('message', messageHandler);
  }

  messageMutex = new Mutex();
  messageSemaphore = new SemaphoreQueue();
  messageQueue: any[] = [];

  handlerSemaphore = new SemaphoreQueue();

  messageGenerator: AsyncGenerator<[RawData, boolean], void>

  get available() {
    return this.socket.readyState === this.socket.OPEN || this.messageQueue.length > 0;
  }

  async *getMessage(): AsyncGenerator<[RawData, boolean], void, [RawData, boolean]> {
    if (this.socket.readyState !== this.socket.OPEN) await this.waitForSocketOpen();
    while (this.available) {
      await this.messageSemaphore.wait();
      const message = this.messageQueue.shift();
      yield message;
    }
    console.log('socket closed.');
  }

  waitForSocketOpen() {
    return new Promise<void>((res, rej) => {
      const resolver = () => {
        this.socket.off('open', resolver);
        res();
      };
      this.socket.on('open', resolver);
      setTimeout(rej, 10000);
    });
  }

  async next(...args: [] | [unknown]): Promise<IteratorResult<[RawData, boolean], void>> {
    return await this.messageGenerator.next(...args);
  }

  async return(value: any): Promise<IteratorResult<[RawData, boolean], void>> {
    return await this.messageGenerator.return(value);
  }
  async throw(e: any): Promise<IteratorResult<[RawData, boolean], void>> {
    return await this.messageGenerator.throw(e);
  }
  [Symbol.asyncIterator](): AsyncGenerator<[RawData, boolean], any, unknown> {
    return this.messageGenerator;
  }


}


export class SocketObservable<T> extends ReplaySubject<Extract<T>> {
  id: string = randomUUID();

  /**
   *
   */
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