#!/usr/bin/env node
/* globals process */
// override es6 promise with bluebird
Promise = require('bluebird');
var debug = require('debug')('logdna:index');
var program = require('commander');
var pkg = require('./package.json');
var fs = require('fs');
var properties = Promise.promisifyAll(require('properties'));
var _ = require('lodash');
var os = require('os');

var minireq = Promise.promisifyAll(require('./lib/minireq'), {multiArgs:true});
var WebSocket = require('./lib/logdna-websocket');
var distro = Promise.promisify(require('./lib/os-version'));
var config = require('./lib/config');
var fileUtils = require('./lib/file-utilities');
var apiClient = require('./lib/api-client');
var connectionManager = require('./lib/connection-manager');

var macaddress = require('macaddress');
var spawn = require('child_process').spawn;
var path = require('path');

// windows only
var wincmd;

if (os.getPlatform() === 'win32') {
  wincmd = require('node-windows');  
}

var socket;

process.title = 'logdna-agent';
program._name = 'logdna-agent';
program
    .version(pkg.version, '-v, --version')
    .description('This agent collect and ship logs for processing. Defaults to /var/log if run without parameters.')
    .option('-c, --config <file>', 'uses alternate config file (default: ' + config.DEFAULT_CONF_FILE + ')')
    .option('-k, --key <key>', 'sets LogDNA Agent Key in config')
    .option('-d, --logdir <dir>', 'adds custom log dir to config', fileUtils.appender(), [])
    .option('-t, --tags <tags>', 'set tags for this host (for auto grouping), separate multiple tags by comma')
    .on('--help', function () {
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

function checkElevated () {
    return new Promise ((resolve) => {
        if (os.platform() !=== 'win32' && process.getuid() > 0) {
            resolve(false);
        } else if (os.platform() !=== 'win32' && process.getuid() <= 0) {
            resolve(true);
        }

        wincmd.isAdminUser(isAdmin => {
          resolve(isAdmin);
        });
    });
}

minireq.setUA(path.join(program._name, '/', pkg.version));

checkElevated()
.then(isElevated => {
   if (!isElevated) {
       console.log('You must be running as an Administrator (root, sudo) run this agent! See -h or --help for more info.');
       process.exit();
   }
   
   return properties.parseAsync(program.config || config.DEFAULT_CONF_FILE, { path: true });
})
.then(parsedConfig => {
    config = _.merge({}, config, parsedConfig);
    if (!program.key && !config.key) {
        return console.error('LogDNA Agent Key not set! Use -k to set.');
    }

    // sanitize
    if (!config.logdir)
        config.logdir = [config.DEFAULT_LOG_PATH]; // default entry
    else if (!Array.isArray(config.logdir))
        config.logdir = config.logdir.split(','); // force array

    debug(console.log(config));

    if (program.key) {
        config.key = program.key;
        return fileUtils.saveConfig(config, program.config || config.DEFAULT_CONF_FILE).then(() => {
            console.log('Your LogDNA Agent Key has been successfully saved!');
            process.exit(0);
        });
    }

    if (program.logdir && program.logdir.length > 0) {
        config.logdir = _.uniq(config.logdir.concat(program.logdir));
        return fileUtils.saveConfig(config, program.config || config.DEFAULT_CONF_FILE).then(() => {
            console.log('Added ' + program.logdir.join(', ') + ' to config.');
            process.exit(0);
        });
    }

    if (program.tags) {
        config.tags = program.tags.replace(/\s*,\s*/g, ',').replace(/^,|,$/g, ''); // trim spaces around comma
        return fileUtils.saveConfig(config, program.config || config.DEFAULT_CONF_FILE).then(() => {
            console.log('Tags ' + config.tags + ' saved to config.');
            process.exit(0);
        });
    }

    config.hostname = os.hostname().replace('.ec2.internal', '');

    return distro();
})
.then(dist => {
    if (dist && dist.os) config.osdist = dist.os + (dist.release ? ' ' + dist.release : '');
    return minireq.get('http://169.254.169.254/latest/dynamic/instance-identity/document/', { timeout: 1000 });
})
.then((res, aws) => {
    if (aws) {
        config.awsid = aws.instanceId;
        config.awsregion = aws.region;
        config.awsaz = aws.availabilityZone;
        config.awsami = aws.imageId;
        config.awstype = aws.instanceType;
    }
    return macaddress.all();
})
.then(all => {

    var ifaces = [ 'eth0', 'eth1', 'eth2', 'eth3', 'eth4', 'eth5', 'en0', 'en1', 'en2', 'en3', 'en4', 'en5', 'bond0', 'bond1', 'em0', 'em1', 'em2' ];
    for (var i = 0; i < ifaces.length; i++) {
        if (all[ifaces[i]]) {
            config.mac = all[ifaces[i]].mac;
            config.ip = all[ifaces[i]].ipv4 || all[ifaces[i]].ipv6;
            break;
        }
    }
    debug(program._name + ' ' + pkg.version + ' started on ' + config.hostname + ' (' + config.ip + ')');

    return apiClient.getAuthToken(config, program._name, socket);
})
.then(() => {
    debug('got auth token:');
    debug(config.auth_token);
    debug('connecting to log server');
    return connectionManager.connectLogServer(config, program._name);
})
.then(sock => {
   socket = sock;
   debug('logdna agent successfully started'); 
});

process.on('uncaughtException', function (err) {
    debug('------------------------------------------------------------------');
    debug('Uncaught Error: ' + (err.stack || '').split('\r\n'));
    debug('------------------------------------------------------------------');
});
