# iball
is a library that provides an RXJS-compatible observable API for dealing with WebSockets. You can build a stream of message handlers that eventually result in a desired final output shape, and new sequences of messages will continue to flow through the stream until the socket is closed.

## Examples

```typescript
  import { SocketObservable } from 'iball';

  const socket = new WebSocket('ws://example.org');
  new SocketObservable(socket)
    .receive((message: {data: string, messageLength: number}) => message) // the output of each message handler is given as state to the next
    .receive(
      (message: string, state): [typeof state, string] => {
        if (!Array.isArray(state)) return [state, message];
        return [state[0], `${state[1]} ${message}`];
      },
      state => // a dynamic expect() receives the initial state, as well as the output of the message handler after each iteration
        result => 
          !!result && result[1].split(' ').length === state.messageLength) // we expect to receive the number of messages specified by our metadata
    .receive(
      (message: string, state): typeof state => {
        return [state[0], `${state[1]}-${message}`]; // we'll join these differently
      }, 
      3) // this time we expect to receive three messages of the same type
    .send(state => state[1].split('-').length) // we can send messages mid-stream as well
    .receive((message: string) => {
      return `${state[0].data} ${state[1]}` + message;
    })
    .pipe( // we can use rxjs' operators on our stream as well
      reduce((acc, val) => { // so we'll wait for our peer to send all of its messages and close the socket
        acc.push(val);
        return acc;
      }, [] as string[]
    )
    .subscribe(val => {
      console.log(val);
    });
```
which for this code on the server:
```typescript
  import { SocketObservable } from 'iball';
  import socket from './socket-source';
  
  const $socketObservable = new SocketObservable(socket)
    .send(JSON.stringify({ data: 'hi!', messageLength: 2}));
    "how are you doing today".split(' ').forEach(val => $socketObservable.send(val));
    $socketObservable
      .receive((message: string) => {
        if (message === 4) return '?';
        return null;
      })
      .send((state, skip) => state ?? skip())
      .subscribe(state => {
        if (state) socket.close();
      });
  
```
will output:
```
hi! how are-you-doing-today?
```