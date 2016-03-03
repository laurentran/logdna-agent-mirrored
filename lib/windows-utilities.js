var WinEventReader = require('windows-event-reader');
var debug = require('debug')('logdna:lib:file-utilities');
var _ = require('lodash');

var buf = [];
var buftimeout;

module.exports.streamEventLog = function (provider, socket) {
    var winEvent = new WinEventReader({
        providers: [provider],
        startTime: new Date(Date.now()),
        endTime: new Date(Date.now()),
        frequency: 2000
    });

    winEvent.on('data', logObjects => {
        // logObjects is an Array
        debug('Number of log objects found: ' + logObjects.length);
        logObjects.forEach(logObject => {
            var meta = JSON.stringify({e: 'l', t: Date.now(), l: logObject.message, f: logObject.providerName});
            if (socket.connected) {
                // send any buffered data
                if (buf.length) {
                    _.each(buf, function (data) {
                        socket.send(data);
                    });

                    debug('Sent ' + buf.length + ' lines queued from earlier disconnection');
                    buf = [];
                }

                socket.send(meta);
                debug('Sent ' + meta);

            } else if (buftimeout) {
                buf.push(meta);
            }
        });
    });

    winEvent.on('error', err => {
        debug('Event log error: ' + err);
    });

    winEvent.start();

};
