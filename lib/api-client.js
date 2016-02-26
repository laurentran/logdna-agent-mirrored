var Promise = require('bluebird');

var debug = require('debug')('logdna:lib:api-client');
var minireq = require('./minireq');
Promise.promisifyAll(minireq, {multiArgs: true});

var pkg = require('../package.json');
var authtimeout;

module.exports.getAuthToken = function (config, agentName, socket) { 
    debug("Authenticating Agent Key with " + config.LOGDNA_APIHOST + (config.LOGDNA_APISSL ? " (SSL)" : "") + "...");
    var url = (config.LOGDNA_APISSL ? "https://" : "http://") + config.LOGDNA_APIHOST + "/authenticate/" + config.key;
    debug(url);
    return minireq.postAsync(url, {
            hostname: config.hostname
          , mac: config.mac
          , ip: config.ip
          , tags: config.tags
          , agentname: agentName + "-linux"
          , agentversion: pkg.version
          , osdist: config.osdist
          , awsid: config.awsid
          , awsregion: config.awsregion
          , awsaz: config.awsaz
          , awsami: config.awsami
          , awstype: config.awstype
        })
        .spread((res, body) => {
            debug(body);
            if (res.statusCode !== 200) {
                // got error, try again after appropriate delay
                debug("Auth error: " + res.statusCode + ": " + JSON.stringify(body));
                if (authtimeout) clearTimeout(authtimeout);
                authtimeout = setTimeout(function() {
                    exports.getAuthToken(config, callback);
                }, config.AUTHFAIL_DELAY);
                return;
            }

            debug("Auth success, got token: " + body.token);

            if (config.LOGDNA_LOGHOST || config.LOGDNA_LOGPORT) {
                config.LOGDNA_LOGHOST = config.LOGDNA_LOGHOST || "logs.logdna.com";
                config.LOGDNA_LOGPORT = config.LOGDNA_LOGPORT || 80;
                config.LOGDNA_LOGSSL = config.LOGDNA_LOGSSL || false;

            } else {
                config.LOGDNA_LOGHOST = body.server;
                config.LOGDNA_LOGPORT = body.port;
                config.LOGDNA_LOGSSL = body.ssl;
            }

            config.auth_token = body.token;

            if (socket) {
                debug(socket);
                
                if (!socket.options) {
                    socket.options = {
                        query: {
                            auth_token: body.token,
                            timestamp: Date.now()
                        }
                    }
                }
                // already setup, replace query in existing socket io connection
                socket.options.query.auth_token = body.token;
            }

            return;
        })
        .catch(err => {
            debug("Auth error:");
            debug(err);
            if (authtimeout) {
                clearTimeout(authtimeout);
            }
            
            return new Promise(resolve => {
                authtimeout = setTimeout(function() {
                    exports.getAuthToken(config, agentName, socket);
                }, config.AUTHERROR_DELAY);
            });
        });
}
