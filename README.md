# pgee

[![Current Version](https://img.shields.io/npm/v/pgee.svg)](https://www.npmjs.org/package/pgee)
[![Build Status via Travis CI](https://travis-ci.org/continuationlabs/pgee.svg?branch=master)](https://travis-ci.org/continuationlabs/pgee)
![Dependencies](http://img.shields.io/david/continuationlabs/pgee.svg)

[![belly-button-style](https://cdn.rawgit.com/continuationlabs/belly-button/master/badge.svg)](https://github.com/continuationlabs/belly-button)

PostgreSQL asynchronous notification event emitter. `pgee` allows PostgreSQL's `LISTEN` and `NOTIFY` features to be used as a Node.js `EventEmitter`.

An example use of `pgee` is shown below. `pgee` exports a single constructor that extends `EventEmitter`. The constructor accepts anything that can be passed to [`pg.connect()`](https://www.npmjs.com/package/pg), or an already connected `pg.Client` instance. The `pgee.prototype.listen()` and `pgee.prototype.unlisten()` methods are used to `LISTEN` and `UNLISTEN` channels in the database. Notifications received from the database are emitted as events. Similarly, the `pgee.prototype.emit()` method triggers a `NOTIFY` on the database channel.

```javascript
const CONNECT_STRING = `postgres://${process.env.USER}@localhost/postgres`;
const PgEe = require('pgee');

// The constructor accepts a pg.Client, connection string, or any valid
// pg connection configuration.
const pgee = new PgEe(CONNECT_STRING);

pgee.connect((err) => {
  if (err) {
    return console.error(err);
  }

  // Listen on "foo" channel. When a notification is received, emit a "foo"
  // event, triggering the listener function.
  pgee.listen({
    channel: 'foo',
    listener: (data) => {
      console.log(`Received 'foo' event: ${JSON.stringify(data)}`);
    }
  }, (err, channel) => {
    if (err) {
      return console.error(err);
    }

    pgee.emit('foo', {bar: 'baz'});
  });
});
```

## API

### `pgee(options)` Constructor

  - Arguments
    - `options` (varies) - Options to pass to `pg.connect()` or a connected instance of `pg.Client` (see the [`pg` module](https://www.npmjs.com/package/pg) for details).
  - Returns
    - object - A newly constructed `pgee` instance.

Constructs a new `pgee` instance, which extends `EventEmitter`. The constructor does not attempt to connect to a database.

### `pgee.prototype.connect([callback])`

  - Arguments
    - `callback` (function) - An optional callback function that is invoked after connecting to the database. The callback only receives a possible error argument.
  - Returns
    - Nothing

Connects to a PostgreSQL database using the credentials provided to the constructor. The connection is taken from the `pg` module's connection pool. If an instance of `pg.Client` was passed to the constructor, it is assumed to already be connected, so no further action is taken. If `callback` is a function, it is called upon completion. If a function was not provided, a `'connect'` event is emitted.

### `pgee.prototype.close()`

  - Arguments
    - None
  - Returns
    - Nothing

Closes the `pgee` instance. If the connection was taken from the `pg` connection pool during `connect()`, it will be returned to the pool. If an external `pg.Client` was provided to the constructor, no action will be taken on the client. All attached event listeners are removed from the instance.

### `pgee.prototype.listen(channel [, callback])`

  - Arguments
    - `channel` (string or object) - If this is a string, it represents the name of the channel to subscribe to. If is is an option, it supports the following properties.
      - `channel` (string) - The channel name to subscribe to.
      - `listener` (function) - An optional event listener that triggers on `channel` events. The data associated with the database notification is passed as the only argument.
    - `callback` (function) - An optional callback function. If an error occurs, it is passed as the first argument of the callback. On success, the second argument of the callback is the channel name as a string.
  - Returns
    - Nothing

Issues a `LISTEN "channel"` to the database. If a `listener` is provided, it is attached using the `on()` method. Additional listeners can be attached later using `on()`, `addListener()`, `once()`, or `listen()`. After the `LISTEN` command is issued, the callback function is invoked (if one is present). If no callback was provided, a `'listen'` event is emitted, containing the name of the channel that was added.

### `pgee.prototype.unlisten(channel [, callback])`

  - Arguments
    - `channel` (string or object) - If this is a string, it represents the name of the channel to unsubscribe from. If is is an option, it supports the following properties.
      - `channel` (string) - The channel name to subscribe to.
      - `removeListeners` (boolean) - An optional value that, if `true`, removes all `channel` listeners. Defaults to `false`.
    - `callback` (function) - An optional callback function. If an error occurs, it is passed as the first argument of the callback. On success, the second argument of the callback is the channel name as a string.
  - Returns
    - Nothing

Issues an `UNLISTEN "channel"` to the database. If `removeListeners` is true, any existing `channel` listeners are removed using `removeAllListeners(channel)`. Listeners can also be removed later using `removeAllListeners()`, `unlisten()`, etc. After the `UNLISTEN` command is issued, the callback function is invoked (if one is present). If no callback was provided, an `'unlisten'` event is emitted, containing the name of the channel that was removed.

### `pgee.prototype.emit(event, message)`

  - Arguments
    - `event` (string) - Name of the event to emit. If the event name is `'error'`, an error is emitted immediately. Any other value triggers a database notification, where the channel name is equal to `event`.
    - `message` (varies) - Data attached to the emitted event.
  - Returns
    - Nothing

Issues a `pg_notify()` to the database, where the channel name is `event`, and `message` represents the notification payload. If `event` is `'error'`, then no request is made to the database, and an error is immediately emitted. Note that the names `'connect'`, `'listen'`, and `'unlisten'` have the potential to conflict with other events used in `pgee`.
