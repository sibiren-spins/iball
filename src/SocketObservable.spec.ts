import express from "express";
import expressWs from "express-ws";
import { Server } from "http";
import assert from "node:assert";
import { nextTick } from "node:process";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { reduce } from "rxjs";
import WebSocket from "ws";
import { SocketObservable } from "./SocketObservable";



describe('SocketObservable', () => {
  let socket: WebSocket;
  let send: typeof WebSocket.prototype.send;
  let app: Express.Application & expressWs.Application;
  let server: Server;
  beforeEach(async () => {
    // socket = {
    //   _onMessage: [] as ((msg: RawData, isBinary: boolean) => void)[],
    //   pending: [] as [RawData, boolean][],
    //   async on(event: 'message', cb: (msg: RawData, isBinary: boolean) => void) {
    //     (socket as any)._onMessage.push(cb);
    //     if ((socket as any).pending.length) {
    //       let pendingMessage: [RawData, boolean];
    //       while ((socket as any)._onMessage.length && (pendingMessage = (socket as any).pending.shift())) {
    //         for (const messageHandler of (socket as any)._onMessage) {
    //           await new Promise<void>(res => nextTick(() => {
    //             messageHandler(...pendingMessage);
    //             res();
    //           }));
    //         }
    //       }
    //     }
    //     return this;
    //   },
    //   off(event: 'message', cb: (msg: RawData, isBinary: boolean) => void) {
    //     (socket as any)._onMessage = (socket as any)._onMessage.filter((m: any) => m !== cb);
    //   },
    //   onmessage: (msg: RawData, isBinary: boolean) => {
    //     if ((socket as any)._onMessage.length !== 0) {
    //       (socket as any)._onMessage.forEach((func: any) => func(msg, isBinary));
    //     } else {
    //       (socket as any).pending.push([msg, isBinary])
    //     }
    //   }
    // }
    try {
    app = express() as any;
    expressWs(app);
    app.ws('/', (socket: WebSocket, req, next) => {
      send = socket.send.bind(socket);
    });
    server = app.listen(62335);
    socket = new WebSocket('ws://localhost:62335/');
    await new Promise<void>(res => {socket.once("open", () => res())})
  } catch (err) {
    console.error(err);
  }
  })


  it('should emit a stream of messages', async () => {
    const messages = ['Hell', 'o', 'Wor', 'ld'];
    const receivedMessages: string[] = [];
    new SocketObservable(socket)
      .receive((message: string) => message, 4)
      .subscribe(message => {
        receivedMessages.push(message);
      })
    for (const sendMessage of messages) {
      send(sendMessage);
    }
    await new Promise(res => setTimeout(res, 10000));
    assert.deepStrictEqual(messages, receivedMessages);
  })

  it('should transform a stream of messages', async () => {
    const messages = [1, 2, 3, 4];
    const innerMessages = [5, 6];
    const outputMessages = ['156', '256', '356', '456']
    const receivedMessages: string[] = [];
    new SocketObservable(socket)
      .receive((message: number) => message, 4)
      .receive((message: number, state) => {
        return state.toString() + message.toString()
      }, 2)
      .subscribe(val => {
        receivedMessages.push(val);
      });
    for (const msg of messages) {
      send(msg);
      for (const innerMsg of innerMessages) {
        send(innerMsg);
      }
    }
    await new Promise(res => setTimeout(res, 10000));
    assert.deepStrictEqual(receivedMessages, outputMessages);
  })

  afterEach(() => {
    socket.close();
    ~socket;
    server.close()
    server.closeAllConnections();
    server.unref();
  })
})