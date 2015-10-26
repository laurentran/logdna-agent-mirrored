#!/usr/bin/env node

var program = require('commander');
var pkg = require('./package.json');
var fs = require('fs');
var Tail = require('tail').Tail;
var properties = require("properties");
var _ = require("lodash");
var WebSocket = require('./logdna-websocket');
var http = require("http");
var https = require("https");
var url = require("url");
var os = require("os");
var distro = require('linux-distro');
var macaddress = require('macaddress');

var socket;
var numfiles;
var buf = [];
var buftimeout;

var DEFAULT_CONF_FILE = "/etc/logdna.conf";
var LOGDNA_APIHOST = process.env.LDAPIHOST || "api.logdna.com";
var LOGDNA_APISSL = isNaN(process.env.USESSL) ? true : +process.env.USESSL;
var LOGDNA_LOGHOST = process.env.LDLOGHOST;
var LOGDNA_LOGPORT = process.env.LDLOGPORT;
var LOGDNA_LOGSSL = isNaN(process.env.LDLOGSSL) ? true: +process.env.LDLOGSSL;
var AUTHFAIL_DELAY = 3600; // 1 hr
// var AUTHFAIL_DELAY = 10; // 10s

process.title = 'logdna-agent-linux';
program._name = 'logdna-agent-linux';
program
    .version(pkg.version, "-v, --version")
    .description('This agent collect and ship logs for processing. Defaults to /var/log if run without parameters.')
    .option('-c, --config <file>', 'uses alternate config file (default: /etc/logdna.conf)')
    .option('-k, --key <key>', 'sets LogDNA Agent Key in config')
    .option('-d, --logdir <dir>', 'adds custom log dir to config', appender(), [])
    .on('--help', function() {
        console.log('  Examples:');
        console.log();
        console.log('    $ logdna-agent-linux --key YOUR_AGENT_KEY');
        console.log('    $ logdna-agent-linux -d /home/ec2-user/logs');
        console.log('    $ logdna-agent-linux -d /home/ec2-user/logs -d /path/to/another/log_dir        # multiple logdirs in 1 go');
        console.log();
    })
    .parse(process.argv);

if (process.getuid() > 0) {
    console.log("You must be root to run this agent! See -h or --help for more info.");
    process.exit();
}

properties.parse(program.config || DEFAULT_CONF_FILE, { path: true }, function(error, config) {
    config = config || {};
    if (!program.key && (error || !config.key)) return console.error("LogDNA Agent Key not set! Use -k to set.");

    // sanitize
    if (!config.logdir)
        config.logdir = ['/var/log']; // default entry
    else if (!Array.isArray(config.logdir))
        config.logdir = config.logdir.split(','); // force array

    var saveConfig = function(callback) {
        properties.stringify(config, {
            path: program.config || "/etc/logdna.conf"
        }, function(err) {
            if (err)
                console.error("Error while saving to: " + (program.config || "/etc/logdna.conf") + ": " + err);
            else
                callback();
        });
    };

    // console.log(config);

    if (program.key) {
        config.key = program.key;
        saveConfig(function() {
            console.log("Your LogDNA Agent Key has been successfully saved!");
            process.exit(0);
        });
        return;
    }

    if (program.logdir && program.logdir.length > 0) {
        config.logdir = _.uniq(config.logdir.concat(program.logdir));
        saveConfig(function() {
            console.log("Added " + program.logdir.join(", ") + " to config.");
            process.exit(0);
        });
        return;
    }

    config.hostname = os.hostname().replace(".ec2.internal", "");

    distro(function (err, dist) {
        config.dist = dist.name;

        macaddress.all(function (err, all) {
            var ifaces = [ 'eth0', 'eth1', 'eth2', 'eth3', 'eth4', 'eth5', 'en0', 'en1', 'en2', 'en3', 'en4', 'en5' ];
            for (var i = 0; i < ifaces.length; i++) {
                if (all[ifaces[i]]) {
                    config.mac = all[ifaces[i]].mac;
                    config.ip = all[ifaces[i]].ipv4 || all[ifaces[i]].ipv6;
                    break;
                }
            }
            log(program._name + " " + pkg.version + " started on " + config.hostname + " (" + config.ip + ")");

            getAuthToken(config, function() {
                connectLogServer(config);
            });
        });
    });
});

function getAuthToken(config, callback) {
    log("Authenticating Agent Key with " + LOGDNA_APIHOST + (LOGDNA_APISSL ? " (SSL)" : "") + "...");
    postRequest( (LOGDNA_APISSL ? "https://" : "http://") + LOGDNA_APIHOST + "/authenticate/" + config.key, { hostname: config.hostname, mac: config.mac, ip: config.ip, agentname: program._name, agentversion: pkg.version, osdist: config.dist }, function(err, res, body) {
        if (err || res.statusCode != "200") {
            // got error, try again in an hour
            if (err)
                log("Auth error: " + err);
            else
                log("Auth error: " + res.statusCode + ": " + JSON.stringify(body));

            return setTimeout(function() {
                getAuthToken(config, callback);
            }, AUTHFAIL_DELAY * 1000);
        }

        // console.log(body);
        log("Auth success, got token: " + body.token);

        if (LOGDNA_LOGHOST || LOGDNA_LOGPORT) {
            LOGDNA_LOGHOST = LOGDNA_LOGHOST || "logs.logdna.com";
            LOGDNA_LOGPORT = LOGDNA_LOGPORT || 80;
            LOGDNA_LOGSSL = LOGDNA_LOGSSL || false;

        } else {
            LOGDNA_LOGHOST = body.server;
            LOGDNA_LOGPORT = body.port;
            LOGDNA_LOGSSL = body.ssl;
        }

        config.auth_token = body.token;

        if (socket) {
            // already setup, replace query in existing socket io connection
            socket.options.query.auth_token = body.token;
        }

        return callback && callback();
    });
}

function connectLogServer(config) {
    socket = new WebSocket( (LOGDNA_LOGSSL ? "https://" : "http://") + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT, {
        query: { auth_token: config.auth_token, timestamp: Date.now() }
    });
    socket.on('open', function() {
        log("Connected to " + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT + " (" + socket._socket.remoteAddress + ")" + (LOGDNA_LOGSSL ? " (SSL)" : ""));

        if (!numfiles) {
            // start streaming logs from logdir(s) on startup
            _.each(config.logdir, function(dir) {
                streamDir(dir);
            });

        } else {
            // reconnected, resume streaming
            log("Streaming resumed: " + numfiles + " files");
            clearTimeout(buftimeout);
        }
    });
    socket.on('error', function(err) {
        err = err.toString();
        log("Server error: " + err);
        if (~err.indexOf("401")) {
            // invalid token, reauth
            log("Got 401 response, reauthenticating...");
            return setTimeout(function() {
                getAuthToken(config);
            }, 500);

        } else if (~err.indexOf("403")) {
            // intentional unauth
            log("Got 403 response, sleeping for " + AUTHFAIL_DELAY + "s...");
            socket.reconnectionDelay = AUTHFAIL_DELAY * 1000;
            socket.reconnectionDelayMax = AUTHFAIL_DELAY * 1000;
        }
    });
    socket.on('close', function(code, message) {
        log('Disconnected from server: ' + code + ': ' + message);

        // clear buffer if disconnected for more than 10s
        buftimeout = setTimeout(function() {
            buf = [];
            buftimeout = null;
        }, 10000);
    });
    socket.on('reconnecting', function(num) {
        log("Attempting to connect #" + num + " to " + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT + (LOGDNA_LOGSSL ? " (SSL)" : "") + " using " + config.auth_token + "...");
        socket.reconnectionDelay = 1000; // reset
        socket.reconnectionDelayMax = 5000; // reset
        socket.options.query.timestamp = Date.now(); // update drift
    });
    socket.on('message', function(data) {
        log("Unknown event received: " + data);
    });
}

function streamDir(dir) {
    var logfiles = getFiles(dir);
    numfiles = logfiles.length;

    if (numfiles > 0)
        log("Streaming " + dir + ": " + numfiles + " files");

    _.each(logfiles, function(file) {
        var tail = new Tail(file);
        var meta;

        tail.on("line", function(line) {
            meta = JSON.stringify({ event: "l", t: Date.now(), l: line, f: file });
            if (socket.connected) {
                // send any buffered data
                if (buf.length) {
                    _.each(buf, function(data) {
                        socket.send(data);
                    });

                    log("Sent " + buf.length + " lines queued from earlier disconnection");
                    buf = [];
                }

                socket.send(meta);

            } else if (buftimeout) {
                buf.push(meta);
            }
        });
        tail.on("error", function(err) {
            log("Tail error: " + file + ": " + err);
        });
    });
}

function getFiles(dir, files_) {
    files_ = files_ || [];
    var files;
    try {
        files = fs.readdirSync(dir);
    } catch (e) {
        log("Error opening " + dir + ": " + e);
        return [];
    }

    var name;
    for (var i = 0; i < files.length; i++) {
        name = dir + '/' + files[i];
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files_);
        } else if (name.toLowerCase().indexOf(".log") == name.length - 4 || // ends in .log
                  (!~name.indexOf(".") && !~name.indexOf("-20")) // extension-less files but not patterns like cron-20150928
            ) {
            files_.push(name);
        }
    }
    return files_;
}

function appender(xs) {
    xs = xs || [];
    return function(x) {
        xs.push(x);
        return xs;
    };
}

function postRequest(uri, postdata, callback) {
    var options = url.parse(uri);
    options.method = "POST";

    if (typeof postdata == "object") {
        options.headers = {
            'Content-Type': 'application/json'
        };
        postdata = JSON.stringify(postdata);
    }

    var req = (options.protocol == "http:" ? http : https).request(options, function(res) {
        res.setEncoding('utf8');
        var body = "";
        res.on('data', function(chunk) {
            body += chunk;
        });
        res.on("end", function() {
            if (body && body.substring(0, 1) == "{")
                body = JSON.parse(body);
            return callback && callback(null, res, body);
        });
    });

    req.on("error", function(err) {
        return callback && callback(err);
    });

    req.write(postdata);
    req.end();
}

function log(msg) {
    console.log("[" + new Date().toISOString().substring(2, 19).replace("T", " ").replace(/[Z\-]/g, "") + "] " + msg);
}
