#!/usr/bin/env node

var program = require('commander');
var pkg = require('./package.json');
var fs = require('fs');
var Tail = require('always-tail');
var properties = require("properties");
var _ = require("lodash");
var minireq = require("./lib/minireq");
var WebSocket = require('./lib/logdna-websocket');
var os = require("os");
var distro = require('./lib/linux-distro');
var macaddress = require('macaddress');
var spawn = require('child_process').spawn;

var socket;
var numfiles = 0;
var buf = [];
var buftimeout;
var authtimeout;

var DEFAULT_CONF_FILE = "/etc/logdna.conf";
var LOGDNA_APIHOST = process.env.LDAPIHOST || "api.logdna.com";
var LOGDNA_APISSL = isNaN(process.env.USESSL) ? true : +process.env.USESSL;
var LOGDNA_LOGHOST = process.env.LDLOGHOST;
var LOGDNA_LOGPORT = process.env.LDLOGPORT;
var LOGDNA_LOGSSL = isNaN(process.env.LDLOGSSL) ? true: +process.env.LDLOGSSL;
var STATS_INTERVAL = 300000; // 5 min
var AUTHERROR_DELAY = 60000; // 1 min
var AUTHFAIL_DELAY = 3600000; // 1 hr
// var AUTHFAIL_DELAY = 10000; // 10s

var globalExclude = [
    '/var/log/wtmp',
    '/var/log/btmp',
    '/var/log/utmp',
    '/var/log/wtmpx',
    '/var/log/btmpx',
    '/var/log/utmpx',
];

process.title = 'logdna-agent';
program._name = 'logdna-agent';
program
    .version(pkg.version, "-v, --version")
    .description('This agent collect and ship logs for processing. Defaults to /var/log if run without parameters.')
    .option('-c, --config <file>', 'uses alternate config file (default: ' + DEFAULT_CONF_FILE + ')')
    .option('-k, --key <key>', 'sets LogDNA Agent Key in config')
    .option('-d, --logdir <dir>', 'adds custom log dir to config', appender(), [])
    .option('-t, --tags <tags>', 'set tags for this host (for auto grouping), separate multiple tags by comma')
    .on('--help', function() {
        console.log('  Examples:');
        console.log();
        console.log('    $ logdna-agent --key YOUR_AGENT_KEY');
        console.log('    $ logdna-agent -d /home/ec2-user/logs');
        console.log('    $ logdna-agent -d /home/ec2-user/logs -d /path/to/another/log_dir        # multiple logdirs in 1 go');
        console.log('    $ logdna-agent -t tag');
        console.log('    $ logdna-agent -t staging,2ndtag');
        console.log();
    })
    .parse(process.argv);

if (process.getuid() > 0) {
    console.log("You must be root to run this agent! See -h or --help for more info.");
    process.exit();
}

minireq.setUA(program._name + "/" + pkg.version);

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
            path: program.config || DEFAULT_CONF_FILE
        }, function(err) {
            if (err)
                console.error("Error while saving to: " + (program.config || DEFAULT_CONF_FILE) + ": " + err);
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

    if (program.tags) {
        config.tags = program.tags.replace(/\s*,\s*/g, ",").replace(/^,|,$/g, ""); // trim spaces around comma
        saveConfig(function() {
            console.log("Tags " + config.tags + " saved to config.");
            process.exit(0);
        });
        return;
    }

    config.hostname = os.hostname().replace(".ec2.internal", "");

    distro(function (err, dist) {
        if (!err && dist && dist.os) config.osdist = dist.os + (dist.release ? " " + dist.release : "");

        minireq.get("http://169.254.169.254/latest/dynamic/instance-identity/document/", { timeout: 1000 }, function(err, res, aws) {
            if (!err && aws) {
                config.awsid = aws.instanceId;
                config.awsregion = aws.region;
                config.awsaz = aws.availabilityZone;
                config.awsami = aws.imageId;
                config.awstype = aws.instanceType;
            }

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
});

process.on("uncaughtException", function(err) {
    log("------------------------------------------------------------------");
    log("Uncaught Error: " + (err.stack || "").split("\r\n"));
    log("------------------------------------------------------------------");
});

function getAuthToken(config, callback) {
    log("Authenticating Agent Key with " + LOGDNA_APIHOST + (LOGDNA_APISSL ? " (SSL)" : "") + "...");
    minireq.post( (LOGDNA_APISSL ? "https://" : "http://") + LOGDNA_APIHOST + "/authenticate/" + config.key, {
            hostname: config.hostname
          , mac: config.mac
          , ip: config.ip
          , tags: config.tags
          , agentname: program._name + "-linux"
          , agentversion: pkg.version
          , osdist: config.osdist
          , awsid: config.awsid
          , awsregion: config.awsregion
          , awsaz: config.awsaz
          , awsami: config.awsami
          , awstype: config.awstype
        }, function(err, res, body) {
        if (err || res.statusCode != "200") {
            // got error, try again after appropriate delay
            if (err) {
                log("Auth error: " + err);
                if (authtimeout) clearTimeout(authtimeout);
                authtimeout = setTimeout(function() {
                    getAuthToken(config, callback);
                }, AUTHERROR_DELAY);
                return;

            } else {
                log("Auth error: " + res.statusCode + ": " + JSON.stringify(body));
                if (authtimeout) clearTimeout(authtimeout);
                authtimeout = setTimeout(function() {
                    getAuthToken(config, callback);
                }, AUTHFAIL_DELAY);
                return;
            }
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
    log("socket created");
    socket = new WebSocket( (LOGDNA_LOGSSL ? "https://" : "http://") + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT + "/", {
        query: { auth_token: config.auth_token, timestamp: Date.now() }
    });
    socket.on('open', function() {
        log("Connected to " + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT + " (" + socket._socket.remoteAddress + ")" + (LOGDNA_LOGSSL ? " (SSL)" : ""));

        if (!numfiles) {
            // start streaming logs from logdir(s) on startup
            _.each(config.logdir, function(dir) {
                streamDir(dir);
            });

            setTimeout(sendStats, STATS_INTERVAL);

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
            if (authtimeout) clearTimeout(authtimeout);
            authtimeout = setTimeout(function() {
                getAuthToken(config);
            }, 250);
            return;

        } else if (~err.indexOf("403")) {
            // intentional unauth
            log("Got 403 response, sleeping for " + AUTHFAIL_DELAY + "ms...");
            socket.reconnectionDelay = AUTHFAIL_DELAY;
            socket.reconnectionDelayMax = AUTHFAIL_DELAY;
        }
    });
    socket.on('close', function(code, message) {
        log('Disconnected from server: ' + code + ': ' + message);

        // clear buffer if disconnected for more than 120s
        buftimeout = setTimeout(function() {
            buf = [];
            buftimeout = null;
        }, 120000);
    });
    socket.on('reconnecting', function(num) {
        log("Attempting to connect #" + num + " to " + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT + (LOGDNA_LOGSSL ? " (SSL)" : "") + " using " + config.auth_token + "...");
        socket.reconnectionDelay = 1000; // reset
        socket.reconnectionDelayMax = 5000; // reset
        socket.options.query.timestamp = Date.now(); // update drift
    });
    socket.on('message', function(data) {
        if (data.substring(0, 1) == "{") {
            data = JSON.parse(data);

            if (data.e == "u" && config.autoupdate != "0") {
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

            log("Unknown event received: " + JSON.stringify(data));

        } else
            log("Unknown event received: " + data);
    });
}

function streamDir(dir) {
    var logfiles = getFiles(dir);
    numfiles += logfiles.length;

    if (logfiles.length > 0)
        log("Streaming " + dir + ": " + logfiles.length + " files");

    _.each(logfiles, function(file) {
        var tail;
        try {
            tail = new Tail(file, "\n", { interval: 250 });
        } catch (err) {
            log("Error tailing " + file + ": " + err);
            return;
        }
        var meta;

        tail.on("line", function(line) {
            if (line && line.length > 32000)
                line = line.substring(0, 32000) + " (cut off, too long...)";

            meta = JSON.stringify({ e: "l", t: Date.now(), l: line, f: file });
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
        tail.watch();
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
        try {
            if (fs.statSync(name).isDirectory()) {
                getFiles(name, files_);
            } else if (
                    (
                        files[i].toLowerCase().indexOf(".log") == files[i].length - 4 || // ends in .log
                        (!~files[i].indexOf(".") && !~files[i].indexOf("-20")) // extension-less files but not patterns like cron-20150928
                    ) && !~globalExclude.indexOf(name)
                ) {
                files_.push(name);
            }
        } catch (e) {}
    }
    return files_;
}

function sendStats() {
    if (socket.connected) {
        socket.send(JSON.stringify({ e: "s", m: process.memoryUsage() }));
    }
    setTimeout(sendStats, STATS_INTERVAL);
}

function appender(xs) {
    xs = xs || [];
    return function(x) {
        xs.push(x);
        return xs;
    };
}

function log(msg) {
    console.log("[" + new Date().toISOString().substring(2, 19).replace("T", " ").replace(/[Z\-]/g, "") + "] " + msg);
}
