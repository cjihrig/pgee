'use strict';
const Code = require('code');
const Lab = require('lab');
const Postgresql = require('pg');
const PgEe = require('../lib');
const CONNECT_STRING = process.env.POSTGRESQL_CONNECTION ||
                       `postgres://${process.env.USER}@localhost/postgres`;

const lab = exports.lab = Lab.script();
const expect = Code.expect;
const describe = lab.describe;
const it = lab.it;

describe('pgee', () => {
  lab.after((done) => {
    Postgresql.end();
    done();
  });

  describe('PgEe()', () => {
    it('accepts a Postgresql client as input', (done) => {
      const client = new Postgresql.Client(CONNECT_STRING);
      const pgee = new PgEe(client);

      expect(pgee._connection).to.shallow.equal(client);
      expect(pgee._options).to.equal(null);
      expect(pgee._done).to.equal(null);
      expect(pgee._channels).to.equal([]);
      expect(pgee.getMaxListeners()).to.equal(Infinity);
      done();
    });

    it('accepts Postgresql connection information as input', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      expect(pgee._connection).to.equal(null);
      expect(pgee._options).to.equal(CONNECT_STRING);
      expect(pgee._done).to.equal(null);
      expect(pgee._channels).to.equal([]);
      expect(pgee.getMaxListeners()).to.equal(Infinity);
      done();
    });
  });

  describe('PgEe.prototype.connect()', (done) => {
    it('returns early if connection already exists', (done) => {
      const client = new Postgresql.Client(CONNECT_STRING);
      const pgee = new PgEe(client);
      const originalConnect = Postgresql.connect;

      Postgresql.connect = (options, callback) => {
        Postgresql.connect = originalConnect;
        callback(new Error('foo'));
      };

      pgee.on('error', (err) => {
        Code.fail(err);
      });

      pgee.on('connect', () => {
        Postgresql.connect = originalConnect;
        done();
      });

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.connect();
      });
    });

    it('uses Postgresql thread pool if no connection is provided', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      expect(pgee._connection).to.not.exist();
      pgee.connect((err) => {
        expect(err).to.not.exist();
        expect(pgee._connection instanceof Postgresql.Client).to.equal(true);
        pgee.close();
        done();
      });
    });

    it('handles errors from Postgresql.connect()', (done) => {
      const pgee = new PgEe(CONNECT_STRING);
      const originalConnect = Postgresql.connect;

      Postgresql.connect = (options, callback) => {
        Postgresql.connect = originalConnect;
        callback(new Error('foo'));
      };

      expect(pgee._connection).to.not.exist();
      pgee.connect((err) => {
        expect(err.message).to.equal('foo');
        expect(pgee._connection).to.not.exist();
        done();
      });
    });

    it('handles errors from the connection', (done) => {
      const client = new Postgresql.Client(CONNECT_STRING);
      const pgee = new PgEe(client);

      pgee.on('error', (err) => {
        expect(err.message).to.equal('foo');
        pgee.close();
        done();
      });

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee._connection.emit('error', new Error('foo'));
      });
    });
  });

  describe('PgEe.prototype.listen()', (done) => {
    it('listens to channels in database', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();
        expect(pgee._channels).to.equal([]);

        // Handle a string
        pgee.listen('foo', (err, channel) => {
          expect(err).to.not.exist();
          expect(channel).to.equal('foo');
          expect(pgee._channels).to.equal(['foo']);
          expect(pgee.listenerCount('foo')).to.equal(0);

          // Handle an object
          pgee.listen({
            channel: 'bar',
            listener: (data) => {}
          }, (err, channel) => {
            expect(err).to.not.exist();
            expect(channel).to.equal('bar');
            expect(pgee._channels).to.only.include(['foo', 'bar']);
            expect(pgee.listenerCount('foo')).to.equal(0);
            expect(pgee.listenerCount('bar')).to.equal(1);

            // Handle a duplicate with a listener
            pgee.listen({
              channel: 'foo',
              listener: (data) => {}
            }, (err, channel) => {
              expect(err).to.not.exist();
              expect(channel).to.equal('foo');
              expect(pgee._channels).to.only.include(['foo', 'bar']);
              expect(pgee.listenerCount('foo')).to.equal(1);
              expect(pgee.listenerCount('bar')).to.equal(1);

              // Handle a duplicate without a listener
              pgee.listen('bar', (err, channel) => {
                expect(err).to.not.exist();
                expect(channel).to.equal('bar');
                expect(pgee._channels).to.only.include(['foo', 'bar']);
                expect(pgee._channels.length).to.equal(2);
                expect(pgee.listenerCount('foo')).to.equal(1);
                expect(pgee.listenerCount('bar')).to.equal(1);
                pgee.close();
                done();
              });
            });
          });
        });
      });
    });

    it('treats primitive channel names as strings', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.listen(null, (err, channel) => {
          expect(err).to.not.exist();
          expect(channel).to.equal('null');
          expect(pgee._channels).to.equal(['null']);
          expect(pgee.listenerCount('null')).to.equal(0);
          pgee.close();
          done();
        });
      });
    });

    it('handles database errors', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();
        expect(pgee._channels).to.equal([]);

        const originalQuery = pgee._connection.query;

        pgee._connection.query = (sql, callback) => {
          pgee._connection.query = originalQuery;
          return callback(new Error('bar'));
        };

        pgee.listen('foo', (err, channels) => {
          expect(err.message).to.equal('bar');
          expect(channels).to.not.exist();
          expect(pgee._channels).to.equal([]);
          pgee.close();
          done();
        });
      });
    });

    it('guards against async race condition', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();
        expect(pgee._channels).to.equal([]);

        const originalQuery = pgee._connection.query;
        let count = 0;
        const listenCb = (err, channel) => {
          count++;
          expect(err).to.not.exist();
          expect(channel).to.equal('foo');
          expect(pgee._channels).to.equal(['foo']);

          if (count > 1) {
            pgee._connection.query = originalQuery;
            expect(count).to.equal(2);
            done();
          }
        };

        pgee._connection.query = (sql, callback) => {
          setTimeout(callback, 1000);
        };

        pgee.listen('foo', listenCb);
        pgee.listen('foo', listenCb);
      });
    });

    it('errors if not connected', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.listen('foo', (err, channels) => {
        expect(err instanceof Error).to.equal(true);
        expect(channels).to.not.exist();
        done();
      });
    });
  });

  describe('PgEe.prototype.unlisten()', (done) => {
    it('unlistens to channels in database', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.listen('foo', (err, channel) => {
          expect(err).to.not.exist();
          pgee.listen({
            channel: 'bar',
            listener: () => {}
          }, (err, channel) => {
            expect(err).to.not.exist();
            expect(pgee._channels.length).to.equal(2);
            expect(pgee.listenerCount('foo')).to.equal(0);
            expect(pgee.listenerCount('bar')).to.equal(1);

            // Handle a string
            pgee.unlisten('foo', (err, channel) => {
              expect(err).to.not.exist();
              expect(channel).to.equal('foo');
              expect(pgee._channels).to.only.include('bar');
              expect(pgee.listenerCount('bar')).to.equal(1);

              // Handle an object that removes listeners
              pgee.unlisten({
                channel: 'bar',
                removeListeners: true
              }, (err, channel) => {
                expect(err).to.not.exist();
                expect(channel).to.equal('bar');
                expect(pgee._channels).to.equal([]);
                expect(pgee.listenerCount('bar')).to.equal(0);
                pgee.close();
                done();
              });
            });
          });
        });
      });
    });

    it('unlistens channels that aren\'t being listened to', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.on('foo', () => {});
      pgee.on('bar', () => {});

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.unlisten('foo', (err, channel) => {
          expect(err).to.not.exist();
          expect(channel).to.equal('foo');
          expect(pgee._channels).to.equal([]);
          expect(pgee.listenerCount('foo')).to.equal(1);
          expect(pgee.listenerCount('bar')).to.equal(1);

          pgee.unlisten({
            channel: 'bar',
            removeListeners: true
          }, (err, channel) => {
            expect(err).to.not.exist();
            expect(channel).to.equal('bar');
            expect(pgee._channels).to.equal([]);
            expect(pgee.listenerCount('foo')).to.equal(1);
            expect(pgee.listenerCount('bar')).to.equal(0);
            pgee.close();
            done();
          });
        });
      });
    });

    it('treats primitive channel names as strings', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.unlisten(null, (err, channel) => {
          expect(err).to.not.exist();
          expect(channel).to.equal('null');
          expect(pgee._channels).to.equal([]);
          expect(pgee.listenerCount('null')).to.equal(0);
          pgee.close();
          done();
        });
      });
    });

    it('handles database errors', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.listen('foo', (err, channels) => {
          expect(err).to.not.exist();
          expect(pgee._channels).to.only.include('foo');

          const originalQuery = pgee._connection.query;

          pgee._connection.query = (sql, callback) => {
            pgee._connection.query = originalQuery;
            return callback(new Error('bar'));
          };

          pgee.unlisten('foo', (err, channels) => {
            expect(err.message).to.equal('bar');
            expect(channels).to.not.exist();
            expect(pgee._channels).to.equal(['foo']);
            pgee.close();
            done();
          });
        });
      });
    });

    it('guards against async race condition', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.connect((err) => {
        expect(err).to.not.exist();

        pgee.listen('foo', (err, channel) => {
          expect(err).to.not.exist();
          expect(pgee._channels).to.equal(['foo']);

          const originalQuery = pgee._connection.query;
          let count = 0;
          const unlistenCb = (err, channel) => {
            count++;
            expect(err).to.not.exist();
            expect(channel).to.equal('foo');
            expect(pgee._channels).to.equal([]);

            if (count > 1) {
              pgee._connection.query = originalQuery;
              expect(count).to.equal(2);
              done();
            }
          };

          pgee._connection.query = (sql, callback) => {
            setTimeout(callback, 1000);
          };

          pgee.unlisten('foo', unlistenCb);
          pgee.unlisten('foo', unlistenCb);
        });
      });
    });

    it('errors if not connected', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.unlisten('foo', (err, channels) => {
        expect(err instanceof Error).to.equal(true);
        expect(channels).to.not.exist();
        done();
      });
    });
  });

  describe('PgEe.prototype.emit()', (done) => {
    it('emits channel messages as events', (done) => {
      const pgee = new PgEe(CONNECT_STRING);
      const message = {bar: 'baz'};

      pgee.on('foo', (data) => {
        expect(data).to.equal(message);
        pgee.close();
        done();
      });

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.listen('foo', (err, channels) => {
          expect(err).to.not.exist();
          pgee.emit('foo', message);
        });
      });
    });

    it('can emit error events without being connected', (done) => {
      const pgee = new PgEe(CONNECT_STRING);
      const error = new Error('foo');

      pgee.on('error', (err) => {
        expect(err).to.equal(error);
        done();
      });

      pgee.emit('error', error);
    });

    it('errors if not connected', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.on('error', (err) => {
        expect(err instanceof Error).to.equal(true);
        done();
      });

      pgee.emit('foo', 'bar');
    });

    it('handles database errors', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.on('error', (err) => {
        expect(err.message).to.equal('bar');
        pgee.close();
        done();
      });

      pgee.on('foo', () => {
        Code.fail('unexpected foo event');
      });

      pgee.connect((err) => {
        expect(err).to.not.exist();
        pgee.listen('foo', (err, channels) => {
          expect(err).to.not.exist();

          const originalQuery = pgee._connection.query;

          pgee._connection.query = (sql, params, callback) => {
            pgee._connection.query = originalQuery;
            return callback(new Error('bar'));
          };

          pgee.emit('foo', {baz: '123'});
        });
      });
    });
  });

  describe('PgEe.prototype.close()', (done) => {
    it('closes the database connection', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee.on('error', (err) => {
        Code.fail(err);
      });

      pgee.connect((err) => {
        expect(err).to.not.exist();
        expect(pgee.listenerCount('error')).to.equal(1);
        pgee.close();
        expect(pgee._connection).to.equal(null);
        expect(pgee._done).to.equal(null);
        expect(pgee.listenerCount('error')).to.equal(0);
        done();
      });
    });

    it('does not modify an external database connection', (done) => {
      const client = new Postgresql.Client(CONNECT_STRING);
      const pgee = new PgEe(client);

      expect(pgee._connection instanceof Postgresql.Client).to.equal(true);
      expect(pgee._done).to.equal(null);
      pgee.close();
      expect(client instanceof Postgresql.Client).to.equal(true);
      expect(pgee._connection).to.equal(null);
      expect(pgee._done).to.equal(null);
      done();
    });

    it('returns early if not connected', (done) => {
      const pgee = new PgEe(CONNECT_STRING);

      pgee._done = () => {
        Code.fail('should not be called');
      };

      pgee.close();
      done();
    });
  });
});
