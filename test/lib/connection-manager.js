// var MockServer = require('mock-socket').Server;
// var mockery = require('mockery');
// var rimraf = require('rimraf');
// var tempDir = '.temp';
// describe('lib:connection-manager', function() {

// 	before (function () {
// 		/* jshint ignore:start */
// 		Promise = require('bluebird');
// 		/* jshint ignore:end */
// 	});
// 	beforeEach(function () {

// 		if (fs.existsSync(tempDir)) {
// 			debug('cleaning up test folder...' + tempDir);
// 			rimraf.sync(tempDir);
// 		}

// 		fs.mkdirSync(tempDir);
// 	});

// 	before(function () {
// 		mockery.enable({
// 			warnOnUnregistered: false
// 		});
// 		mockery.registerSubstitute('ws', require('mock-socket').WebSocket);
// 	});

// 	it('begins streaming file changes when connection opens', done => {
// 		const mockServer = new Server('ws://localhost:8080');
// 		mockServer.on('connection', server => {
// 			mockServer.send('open');
// 		});

// 		var connectionManager = require('../../lib/connection-manager');

// 		connectionManager.connectLogServer({
// 			autoupdate: 0,
// 			key: 'SOME_FAKE_KEY',
// 			logdir: tempDir
// 		});

// 		mockServer.on
// 	});
// });
