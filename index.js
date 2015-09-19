#!/usr/bin/env node

var program = require('commander');
var pkg = require('./package.json');
var fs = require('fs');
var Tail = require('./tail').Tail;
var properties = require("properties");
var _ = require("lodash");
var io = require('socket.io-client');
var request = require("request");
var os = require("os");
var macaddress = require('macaddress');

var socket;
var auth_token;
var monitoring = false;

var DEFAULT_CONF_FILE = "/etc/logdna.conf";
var LOGDNA_APIHOST = process.env.LDAPIHOST || "api.logdna.com";
var LOGDNA_APISSL = isNaN(process.env.USESSL) ? true : +process.env.USESSL;
var LOGDNA_LOGHOST = process.env.LDLOGHOST;
var LOGDNA_LOGPORT = process.env.LDLOGPORT;
var LOGDNA_LOGSSL = process.env.LDLOGSSL;
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

properties.parse(program.config || DEFAULT_CONF_FILE, {
    path: true
}, function(error, config) {
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

    macaddress.all(function (err, all) {
        var ifaces = [ 'eth0', 'eth1', 'en0', 'en1' ];
        var mac, ip;
        for (var i = 0; i < ifaces.length; i++) {
            if (all[ifaces[i]]) {
                mac = all[ifaces[i]].mac;
                ip = all[ifaces[i]].ipv4 || all[ifaces[i]].ipv6;
                break;
            }
        }
        authenticate(config, mac, ip);
    });
});

function authenticate(config, mac, ip) {
    request.post( (LOGDNA_APISSL ? "https://" : "http://") + LOGDNA_APIHOST + "/authenticate/" + config.key, { json: { hostname: os.hostname(), mac: mac, ip: ip, agentname: program._name, agentversion: pkg.version } }, function(err, res, body) {
        if (err || res.statusCode != "200") {
            // got error, try again in an hour
            if (err)
                console.log("API error: " + err);
            else
                console.log("API error: " + res.statusCode + ": " + JSON.stringify(body));

            return setTimeout(function() {
                authenticate(config, mac, ip);
            }, AUTHFAIL_DELAY * 1000);
        }

        console.log(body);

        if (LOGDNA_LOGHOST || LOGDNA_LOGPORT || LOGDNA_LOGSSL) {
            LOGDNA_LOGHOST = LOGDNA_LOGHOST || "logs.logdna.com";
            LOGDNA_LOGPORT = LOGDNA_LOGPORT || 80;
            LOGDNA_LOGSSL = LOGDNA_LOGSSL || false;

        } else {
            LOGDNA_LOGHOST = body.server;
            LOGDNA_LOGPORT = body.port;
            LOGDNA_LOGSSL = body.ssl;
        }

        auth_token = body.token;

        if (!socket) {
            setupSockets(config);
        }
    });
}

function setupSockets(config) {
    console.log((LOGDNA_LOGSSL ? "wss://" : "ws://") + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT);
    socket = io( (LOGDNA_LOGSSL ? "wss://" : "ws://") + LOGDNA_LOGHOST + ":" + LOGDNA_LOGPORT, {
        transports: ['websocket'],
        query: { auth_token: auth_token }
    });
    socket.on('connect', function() {
        console.log("Connected to " + LOGDNA_LOGHOST + ".");

        // monitor logs
        if (!monitoring) {
            _.each(config.logdir, function(dir) {
                getDir(dir);
            });
        }
    });
    socket.on('error', function(err) {
        console.log("Server error: " + err);
        if (~err.indexOf("401") || ~err.indexOf("403")) {
            console.log("Got " + err.substring(0, 3) + " response, sleeping for " + AUTHFAIL_DELAY + "s...");
            socket.io.reconnectionDelay(AUTHFAIL_DELAY * 1000);
            socket.io.reconnectionDelayMax(AUTHFAIL_DELAY * 1000);
        }
    });
    socket.on('disconnect', function() {
        console.log("Disconnected from server.");
    });
    socket.on('reconnecting', function(num) {
        console.log("Reconnecting to server: " + num);
        socket.io.reconnectionDelay(1000); // reset
        socket.io.reconnectionDelayMax(5000); // reset
    });
    socket.on('reconnect_error', function(err) {
        console.log("Reconnect error: " + err);
    });
    socket.on('event', function(data) {
        console.log(data);
    });
}

function onNewLine(file) {
    return function(line) {
        socket.emit("l", { l: line, f: file });
        // console.log(file + ": " + line);
    };
}

function onFileError(file) {
    return function(err) {
        console.log(file + ": " + err);
    };
}

function getDir(dir) {
    var logfiles = getFiles(dir);

    if (logfiles.length > 0)
        console.log("Monitoring " + dir + " with " + logfiles.length + " files...");

    for (var i = 0; i < logfiles.length; i++) {
        var tail = new Tail(logfiles[i]);

        // var filename = logfiles[i].split("/").pop();
        var filename = logfiles[i];

        tail.on("line", onNewLine(filename));
        tail.on("error", onFileError(filename));
    }
}

function getFiles(dir, files_) {
    files_ = files_ || [];
    var files;
    try {
        files = fs.readdirSync(dir);
    } catch (e) {
        console.log("Error opening " + dir + ": " + e);
        return [];
    }
    for (var i in files) {
        var name = dir + '/' + files[i];
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files_);
        } else if (name.toLowerCase().indexOf(".log") == name.length - 4) {
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
