/* SPDX-License-Identifier: MIT */
/* Copyright © 2023 Cecilia Brewer <cecilia@rainbowhouse.org> */

import { RawData, WebSocket } from "ws";
import { Semaphore } from "./Semaphore";


export class SocketMessageDispatcher implements AsyncGenerator<[RawData, boolean]> {
  constructor(private socket: WebSocket) {
    this.messageGenerator = this.getMessage();
    const messageHandler = async (message: RawData, isBinary: boolean) => {
      this.messageQueue.push([message, isBinary ?? false]);
      await this.messageSemaphore.signal();
    };
    this.socket.on('message', messageHandler);
  }

  messageSemaphore = new Semaphore();
  messageQueue: any[] = [];

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