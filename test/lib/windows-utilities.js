/* globals describe, it, before */
var assert = require('assert');
var debug = require('debug')('logdna:test:lib:file-utilities');
var provider = 'testapp';
var os = require('os');

describe('lib:windows-utilities', function () {
    if (os.platform() !== 'win32') {
        return;
    }

    var EventLogger = require('node-windows').EventLogger;
    var log = new EventLogger(provider);

    before (function () {
        /* jshint ignore:start */
        Promise = require('bluebird');
        /* jshint ignore:end */
    });

    describe('#streamEventLog()', function () {
        it('streams event logs to a socket', function () {
            this.timeout(100000);
            const MockWebSocket = require('mock-socket').WebSocket;
            const MockServer = require('mock-socket').Server;
            var server = new MockServer('ws://localhost:40002');
            var socket = new MockWebSocket('ws://localhost:40002');
            socket.connected = true;
            var windowsUtilities = require('../../lib/windows-utilities');

            return new Promise((resolve) => {
                server.on('message', data => {
                    debug('received message!');
                    debug(data);
                    var message = JSON.parse(data);
                    assert.equal(message.l, 'arbitraryData');
                    resolve(true);
                });

                setInterval(() => {
                    log.info('arbitraryData');
                }, 1000);

                windowsUtilities.streamEventLog(provider, socket);
                debug(socket);
            });
        });
    });
});

