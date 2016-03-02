var fs = require('fs');
var path = require('path');
var properties = require('properties');
var debug = require('debug')('logdna:lib:file-utilities');
var numfiles = 0;
var _ = require('lodash');
var Tail = require('always-tail');

var buf = [];
var buftimeout;

var globalExclude = [
    '/var/log/wtmp',
    '/var/log/btmp',
    '/var/log/utmp',
    '/var/log/wtmpx',
    '/var/log/btmpx',
    '/var/log/utmpx'
];

module.exports.getFiles = function (dir, files_) {
    files_ = files_ || [];
    var files;
    try {
        files = fs.readdirSync(dir);
    } catch (e) {
        debug('Error opening ' + dir + ': ' + e);
        return [];
    }

    var name;
    for (var i = 0; i < files.length; i += 1) {
        name = dir + path.sep + files[i];
        try {
            if (fs.statSync(name).isDirectory()) {
                exports.getFiles(name, files_);
            } else if (
                    (
                        // ends in .log
                        files[i].toLowerCase().indexOf('.log') === files[i].length - 4 ||
                        // extension-less files but not patterns like cron-20150928
                        files[i].indexOf('.') === -1 && files[i].indexOf('-20') === -1
                    ) && globalExclude.indexOf(name) === -1
                ) {
                files_.push(name);
            }
        } catch (e) {}
    }
    return files_;
};

module.exports.appender = function (xs) {
    xs = xs || [];
    return function (x) {
        xs.push(x);
        return xs;
    };
};

module.exports.saveConfig = function (config, configPath) {
    return properties.stringifyAsync(config, {
        path: configPath
    })
    .catch(err => {
        console.error('Error while saving to: ' + configPath + ': ' + err);
    });
};

module.exports.streamDir = function (dir, socket) {
    var logfiles = exports.getFiles(dir);
    numfiles += logfiles.length;

    if (logfiles.length > 0) {
        debug('Streaming ' + dir + ': ' + logfiles.length + ' files');
    }

    _.each(logfiles, function (file) {
        var tail;
        try {
            tail = new Tail(file, '\n', {interval: 250});
        } catch (err) {
            debug('Error tailing ' + file + ': ' + err);
            return;
        }
        var meta;

        tail.on('line', function (line) {
            if (line && line.length > 32000) {
                line = line.substring(0, 32000) + ' (cut off, too long...)';
            }

            meta = JSON.stringify({e: 'l', t: Date.now(), l: line, f: file});
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

            } else if (buftimeout) {
                buf.push(meta);
            }
        });
        tail.on('error', function (err) {
            debug('Tail error: ' + file + ': ' + err);
        });
        tail.watch();
    });

    return numfiles;
};
