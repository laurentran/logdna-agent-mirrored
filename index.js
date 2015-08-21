#!/usr/bin/env node

var program = require('commander');
var pkg = require('./package.json');
var fs = require('fs');
var Tail = require('tail').Tail;
var properties = require("properties");
var _ = require("lodash");
var io = require('socket.io-client');

var socket;

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

properties.parse(program.config || "/etc/logdna.conf", {
    path: true
}, function(error, config) {
    config = config || {};
    if (error && !program.key) return console.error("LogDNA Agent Key not set! Use -k to set.");
    if (!config.key) return console.error("LogDNA Agent Key not set! Use -k to set.");

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

    socket = io('ws://localhost', {
        transports: ['websocket']
    });
    socket.on('connect', function() {
        console.log("connected to server.");
    });
    socket.on('error', function(err) {
        console.log("error: " + err);
    });
    socket.on('disconnect', function() {
        console.log("disconnected to server.");
    });
    socket.on('reconnecting', function(num) {
        console.log("reconnecting to server: " + num);
    });
    socket.on('reconnect_error', function(err) {
        console.log("reconnect error: " + err);
    });
    socket.on('event', function(data) {
        console.log(data);
    });

    // monitor logs
    _.each(config.logdir, function(dir) {
        getDir(dir);
    });
});

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
