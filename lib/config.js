/* globals process */
var os = require('os');
var path = require('path');
module.exports = {
    DEFAULT_LOG_PATH: os.platform() !== 'win32' ? '/var/log' : path.join(process.env.APPDATA + '../local'),
    DEFAULT_CONF_FILE: '/etc/logdna.conf',
    LOGDNA_APIHOST: process.env.LDAPIHOST || 'api.logdna.com',
    LOGDNA_APISSL: isNaN(process.env.USESSL) ? true : + process.env.USESSL,
    LOGDNA_LOGHOST: process.env.LDLOGHOST,
    LOGDNA_LOGPORT: process.env.LDLOGPORT,
    LOGDNA_LOGSSL: isNaN(process.env.LDLOGSSL) ? true: + process.env.LDLOGSSL,
    STATS_INTERVAL: 300000, // 5 min
    AUTHERROR_DELAY: 60000, // 1 min
    AUTHFAIL_DELAY: 3600000, // 1 hr
};
