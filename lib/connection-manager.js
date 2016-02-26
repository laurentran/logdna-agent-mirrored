/* globals process */
var debug = require('debug')('logdna:lib:connection-manager');
var spawn = require('child_process').spawn;
var fileUtils = require('./file-utilities');
var apiClient = require('./api-client');
var WebSocket = require('./logdna-websocket');
var _ = require('lodash');
var buf = [];
var buftimeout;
var authtimeout;
var socket;
var numfiles = 0;
module.exports.connectLogServer = function (config, programName) {
    var url = (config.LOGDNA_LOGSSL ? "https://" : "http://") + config.LOGDNA_LOGHOST + ":" + config.LOGDNA_LOGPORT + '/?auth_token=' + config.auth_token + '&timestamp=' + Date.now();
    var options = {
        query: { auth_token: config.auth_token, timestamp: Date.now() }
    };
    debug(url);
    socket = new WebSocket(url, options);

    debug('socket.options:');
    debug(socket.options);
    socket.options = options;
    return new Promise(resolve => {
        debug('Connecting to LogDNA Web Socket');
        socket.on('open', function() {
            debug("Connected to " + config.LOGDNA_LOGHOST + ":" + config.LOGDNA_LOGPORT + " (" + socket._socket.remoteAddress + ")" + (config.LOGDNA_LOGSSL ? " (SSL)" : ""));

            if (!numfiles) {
                // start streaming logs from logdir(s) on startup
                _.each(config.logdir, function(dir) {
                    numfiles += fileUtils.streamDir(dir, socket);
                });
                debug('Streaming ' + numfiles + ' files');
                setTimeout(exports.sendStats, config.STATS_INTERVAL);

            } else {
                // reconnected, resume streaming
                debug("Streaming resumed: " + numfiles + " files");
                clearTimeout(buftimeout);
            }
            return resolve(socket);
        });
        socket.on('error', function(err) {
            err = err.toString();
            debug("Server error: " + err);
            if (~err.indexOf("401")) {
                // invalid token, reauth
                debug("Got 401 response, reauthenticating...");
                if (authtimeout) clearTimeout(authtimeout);
                authtimeout = setTimeout(function() {
                    apiClient.getAuthToken(config, programName, socket);
                }, 250);

            } else if (~err.indexOf("403")) {
                // intentional unauth
                debug("Got 403 response, sleeping for " + config.AUTHFAIL_DELAY + "ms...");
                socket.reconnectionDelay = config.AUTHFAIL_DELAY;
                socket.reconnectionDelayMax = config.AUTHFAIL_DELAY;
            }
        });
        socket.on('close', function(code, message) {
            debug('Disconnected from server: ' + code + ': ' + message);

            // clear buffer if disconnected for more than 120s
            buftimeout = setTimeout(function() {
                buf = [];
                buftimeout = null;
            }, 120000);
        });
        socket.on('reconnecting', function(num) {
            debug("Attempting to connect #" + num + " to " + config.LOGDNA_LOGHOST + ":" + config.LOGDNA_LOGPORT + (config.LOGDNA_LOGSSL ? " (SSL)" : "") + " using " + config.auth_token + "...");
            socket.reconnectionDelay = 1000; // reset
            socket.reconnectionDelayMax = 5000; // reset
            socket.options.query.timestamp = Date.now(); // update drift
        });
        socket.on('message', function(data) {
            if (data.substring(0, 1) == "{") {
                data = JSON.parse(data);

                if (data.e == "u" && config.autoupdate != "0") {
                    debug('updating self');
                    // update self
                    spawn('/bin/bash', ['-c',
                        'if [[ ! -z $(which apt-get) ]]; then apt-get update; apt-get install -y --force-yes logdna-agent; elif [[ ! -z $(which yum) ]]; then yum clean expire-cache; yum -y install logdna-agent; elif [[ ! -z $(which zypper) ]]; then zypper refresh; zypper install -y logdna-agent; fi; sleep 1; /etc/init.d/logdna-agent start'
                    ]);
                    return;
                }

                if (data.e == "r") {
                    // restart self
                    spawn('/bin/bash', ['-c',
                        '/etc/init.d/logdna-agent restart'
                    ]);
                    return;
                }

                debug("Unknown event received: " + JSON.stringify(data));

            } else
                debug("Unknown event received: " + data);
        });
    });
};

module.exports.sendStats = function (socket, config) {
    return new Promise(resolve => {
        if (socket.connected) {
            socket.send(JSON.stringify({ e: 's', m: process.memoryUsage() }));
            resolve();
        }
        setTimeout(() => {
            resolve(exports.sendStats(socket));
        }, config.STATS_INTERVAL);
    });
};
