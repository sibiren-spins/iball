import express from "express";
import expressWs from "express-ws";
import { Server } from "http";
import assert from "node:assert";
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
    try {
    app = express() as any;
    expressWs(app);
    app.ws('/', (socket: WebSocket, req, next) => {
      send = socket.send.bind(socket);
      socket.on('message', (message, isBinary) => {
        if ((message as any as string) === 'is it over?') {
          socket.send('?');
        }
      })
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
      .receive((message: string) => message)
      .subscribe(message => {
        receivedMessages.push(message);
      })
    for (const sendMessage of messages) {
      send(sendMessage);
    }
    await new Promise(res => setTimeout(res, 10000));
    assert.deepStrictEqual(receivedMessages, messages);
  })

  it('should transform a stream of messages', async () => {
    const messages = [1, 2, 3, 4];
    const innerMessages = [5, 6];
    const outputMessages = ['156', '256', '356', '456']
    const receivedMessages: string[] = [];
    new SocketObservable(socket)
      .receive((message: number) => message)
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

  it('should transform an indeterminate stream of messages', async () => {
    const messages = [1, 2, 3, 4];
    const innerMessages = [['a'], ['a','a'], ['a','a','a'], ['a','a','a','a']];
    const outputMessages = ['a', 'aa', 'aaa', 'aaaa'];
    const receivedMessages: string[] = [];
    new SocketObservable(socket)
      .receive((message: number) => message)
      .receive((message: string, state) => {
        if (typeof state === 'number') return message;
        return (state as string) + message;
      }, state => result => !!result && result.length === state)
      .subscribe(val => {
        receivedMessages.push(val);
      })
      for (const msgIndex in messages) {
        send(messages[msgIndex]);
        for (const innerMessage of innerMessages[msgIndex]) {
          send(innerMessage);
        }
      }
      await new Promise(res => setTimeout(res, 10000));
      assert.deepStrictEqual(receivedMessages, outputMessages);
  })

  it('should handle a complex stream of messages', async () => {
    const messages = [{data: 'hi!', messageLength: 3}];
    const innerMessages = [['how', 'are', 'you']];
    const innerInnerMessages = [['today', 'and', 'forever']];
    const outputMessages = ['hi! how are you today and forever?'];
    let receivedMessages: string[] = [];
    new SocketObservable(socket)
      .receive((message: {data: string, messageLength: number}) => message)
      .receive((message: string, state): [typeof state, string] => {
        if (((arg: any): arg is { data: string, messageLength: number} => arg[0] === undefined)(state)) return [state, message];
        return [state[0], `${state[1]} ${message}`];
      }, state => result => !!result && result[1].split(' ').length === state.messageLength)
      .receive((message: string, state): typeof state => {
        return [state[0], `${state[1]} ${message}`];
      }, 3)
      .send('is it over?')
      .receive((message: string, state) => {
        return `${state[0].data} ${state[1]}` + message;
      })
      .pipe(
        reduce((acc, val) => {
          acc.push(val);
          return acc;
        }, [] as string[])
      )
      .subscribe(val => {
        receivedMessages = val;
      })
    
    for (const msgIndex in messages) {
      send(JSON.stringify(messages[msgIndex]));
      for (const innerMsg of innerMessages[msgIndex]) {
        send(innerMsg);
      }
      for (const innerInnerMsg of innerInnerMessages[msgIndex]) {
        send(innerInnerMsg);
      }
    }
    await new Promise(res => setTimeout(res, 5000));
    socket.close();
    await new Promise(res => setTimeout(res, 5000));
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