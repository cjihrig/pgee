'use strict';
const EventEmitter = require('events');
const Util = require('util');
const Postgresql = require('pg');

// Private method symbols
const _setupConnection = Symbol();
const _tearDownConnection = Symbol();


function PgEe (options) {
  this._channels = [];
  this._done = null;
  this.setMaxListeners(Infinity);

  if (options instanceof Postgresql.Client) {
    this._options = null;
    this._connection = options;
    this[_setupConnection]();
  } else {
    this._options = options;
    this._connection = null;
  }
}

Util.inherits(PgEe, EventEmitter);
module.exports = PgEe;


PgEe.prototype.connect = function connect (callback) {
  if (this._connection !== null) {
    return _callbackOrEmit(this, callback, 'connect');
  }

  Postgresql.connect(this._options, (err, connection, done) => {
    if (err) {
      return _callbackOrEmit(this, callback, 'error', err);
    }

    this._done = done;
    this._connection = connection;
    this[_setupConnection]();
    _callbackOrEmit(this, callback, 'connect');
  });
};


PgEe.prototype.listen = function listen (channel, callback) {
  if (this._connection === null) {
    const err = new Error('not connected to database');
    return _callbackOrEmit(this, callback, 'error', err);
  }

  let listener = null;

  if (channel !== null && typeof channel === 'object') {
    listener = channel.listener;
    channel = channel.channel;
  }

  channel = channel + '';

  // Don't add duplicates
  if (this._channels.indexOf(channel) !== -1) {
    if (typeof listener === 'function') {
      this.on(channel, listener);
    }

    return _callbackOrEmit(this, callback, 'listen', null, channel);
  }

  this._connection.query(`LISTEN "${channel}"`, (err) => {
    if (err) {
      return _callbackOrEmit(this, callback, 'error', err);
    }

    // Check for duplicates that could have been added during query() time
    if (this._channels.indexOf(channel) === -1) {
      this._channels.push(channel);
    }

    if (typeof listener === 'function') {
      this.on(channel, listener);
    }

    _callbackOrEmit(this, callback, 'listen', null, channel);
  });
};


PgEe.prototype.unlisten = function unlisten (channel, callback) {
  if (this._connection === null) {
    const err = new Error('not connected to database');
    return _callbackOrEmit(this, callback, 'error', err);
  }

  let removeListeners = false;

  if (channel !== null && typeof channel === 'object') {
    removeListeners = !!channel.removeListeners;
    channel = channel.channel;
  }

  channel = channel + '';

  // Don't try to unlisten on channels that aren't being tracked
  if (this._channels.indexOf(channel) === -1) {
    if (removeListeners) {
      this.removeAllListeners(channel);
    }

    return _callbackOrEmit(this, callback, 'unlisten', null, channel);
  }

  this._connection.query(`UNLISTEN "${channel}"`, (err) => {
    if (err) {
      return _callbackOrEmit(this, callback, 'error', err);
    }

    // Ensure that channel is still in list
    const index = this._channels.indexOf(channel);

    if (index !== -1) {
      this._channels.splice(index, 1);
    }

    if (removeListeners) {
      this.removeAllListeners(channel);
    }

    _callbackOrEmit(this, callback, 'unlisten', null, channel);
  });
};


PgEe.prototype.emit = function emit (event, message) {
  if (event === 'error') {
    return _emit(this, event, message);
  }

  if (this._connection === null) {
    return _emit(this, 'error', new Error('not connected to database'));
  }

  const sql = 'SELECT pg_notify($1, $2)';
  const params = [event, JSON.stringify(message)];

  this._connection.query(sql, params, (err) => {
    if (err) {
      _emit(this, 'error', err);
    }
  });
};


PgEe.prototype.close = function close () {
  if (this._connection === null) {
    return;
  }

  if (typeof this._done === 'function') {
    this._done();
  }

  this.removeAllListeners();
  this[_tearDownConnection]();
  this._channels = [];
  this._connection = null;
  this._done = null;
};


PgEe.prototype[_setupConnection] = function _setupConnection () {
  const connection = this._connection;

  const connectionOnError = (err) => {
    _emit(this, 'error', err);
  };

  const connectionOnNotification = (notification) => {
    const channel = notification.channel;
    let payload = notification.payload;

    try {
      payload = JSON.parse(payload);
    } finally {
      _emit(this, channel, payload);
    }
  };

  connection.on('error', connectionOnError);
  connection.on('notification', connectionOnNotification);
  this[_tearDownConnection] = () => {
    connection.removeListener('error', connectionOnError);
    connection.removeListener('notification', connectionOnNotification);
  };
};


function _emit (context, event, message) {
  return EventEmitter.prototype.emit.call(context, event, message);
}


function _callbackOrEmit (context, callback, event /*, ...args */) {
  let fn;
  let offset;

  if (typeof callback === 'function') {
    fn = callback;
    offset = 3;
  } else {
    fn = EventEmitter.prototype.emit;
    offset = 2;
  }

  const args = new Array(arguments.length - offset);

  for (let i = offset; i < arguments.length; ++i) {
    args[i - offset] = arguments[i];
  }

  return fn.apply(context, args);
}
