/* globals describe, it, beforeEach, before */
var assert = require('assert');
var debug = require('debug')('logdna:test:lib:file-utilities');
var fs = require('fs');
var path = require('path');
var rimraf = require('rimraf');
var tempDir = '.temp';
describe('lib:file-utilities', function () {

    before (function () {
        /* jshint ignore:start */
        Promise = require('bluebird');
        /* jshint ignore:end */
    });
    beforeEach(function () {

        if (fs.existsSync(tempDir)) {
            debug('cleaning up test folder...' + tempDir);
            rimraf.sync(tempDir);
        }

        fs.mkdirSync(tempDir);
    });

    describe('#getFiles()', function () {
        it('retrieves all *log files', function () {
            var fileUtilities = require('../../lib/file-utilities');
            var testFiles = [
                path.join(tempDir, 'somelog1.log'),
                path.join(tempDir, 'somelog2.log'),
                path.join(tempDir, 'somelog3.log')
            ];

            fs.writeFileSync(testFiles[0], 'arbitraryData1');
            fs.writeFileSync(testFiles[1], 'arbitraryData2');
            fs.writeFileSync(testFiles[2], 'arbitraryData3');

            var array = [];
            fileUtilities.getFiles(tempDir, array);

            debug(array);
            assert.equal(array.length, testFiles.length);

            array.forEach(path => {
                var index = testFiles.indexOf(path);

                if (index > -1) {
                    testFiles.splice(index, 1);
                }
            });

            debug(testFiles);
            assert.equal(testFiles.length, 0, 'Expected to find all log test log files');
        });

        it('retrieves no *log files', function () {
            var fileUtilities = require('../../lib/file-utilities');

            var array = [];
            fileUtilities.getFiles(tempDir, array);

            debug(array);
            assert.equal(array.length, 0, 'Expected to find no log files');
        });
    });

    describe('#appender()', function () {
        it('provides an appender that appends to end of array', function () {
            var fileUtilities = require('../../lib/file-utilities');

            var func = fileUtilities.appender();

            func('x');
            func('y');
            var xs = func('z');

            debug(xs);
            assert(xs[0], 'x');
            assert(xs[1], 'y');
            assert(xs[2], 'z');
        });
    });

    describe('#saveConfig()', function () {
        it('saves a configuration to a file', function () {
            var fileUtilities = require('../../lib/file-utilities');

            var properties = Promise.promisifyAll(require('properties'));
            var configPath = './test/assets/testconfig.config';
            return properties.parseAsync(configPath, {path: true})
            .then(config => {
                debug('saving configuration:');
                debug(config);
                return fileUtilities.saveConfig(config, path.join(tempDir, 'test.config'));
            })
            .then(() => {
                return properties.parseAsync(configPath, {path: true});
            })
            .then(config => {
                debug('retrieved saved configuration:');
                debug(config);
                assert.ok(config.logdir);
                assert.ok(config.key);
                assert.equal(config.autoupdate, 0);
            });
        });
    });

    describe('#()', function () {
        it('streams file changes to a socket', function () {
            const MockWebSocket = require('mock-socket').WebSocket;
            const MockServer = require('mock-socket').Server;
            var server = new MockServer('ws://localhost:3000');
            var socket = new MockWebSocket('ws://localhost:3000');
            socket.connected = true;
            var fileUtilities = require('../../lib/file-utilities');

            return new Promise((resolve) => {
                var expectedCount = 2;
                var count = 0;
                server.on('message', data => {
                    debug('recieved message!');
                    debug(data);
                    count += 1;
                    var message = JSON.parse(data);
                    // TODO: Are we supposed to not get the last line?
                    if (count === 1) {
                        assert.equal(message.l, '');
                    } else if (count === 2) {
                        assert(message.l, 'arbitraryData2');
                    }
                    if (count >= expectedCount) {
                        resolve(true);
                    }
                });

                fs.writeFileSync(path.join(tempDir, 'streamtest1.log'), 'arbitraryData1');
                fileUtilities.streamDir(tempDir, socket);

                fs.appendFileSync(path.join(tempDir, 'streamtest1.log'), '\narbitraryData2');
                fs.appendFileSync(path.join(tempDir, 'streamtest1.log'), '\narbitraryData3');
                debug(socket);
            });
        });
    });
});
