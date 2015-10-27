var fs = require("fs");
var getos = require('./getos');

module.exports = function (cb) {
    if (process.platform !== 'linux') {
        throw new Error('Only Linux systems are supported');
    }

    fs.readFile("/etc/os-release", function(err, file) {
        if (err) {
            return getos(function (err, res) {
                if (err) {
                    cb(err);
                    return;
                }

                cb(null, {
                    os: res.dist,
                    name: res.dist + ' ' + res.release,
                    release: res.release,
                    code: res.codename
                });
            });
        }

        var osdist = {};
        file = file.toString().split('\n');
        for (var i = 0; i < file.length; i++) {
            if (file[i] && file[i].trim()) {
                var line = file[i].split('=');
                line[0] = line[0].trim().replace(/^\"/, "").replace(/\"$/, "");
                line[1] = line[1].trim().replace(/^\"/, "").replace(/\"$/, "");
                osdist[line[0].toUpperCase()] = line[1];
            }
        }

        return cb(null, {
            os: osdist["NAME"],
            name: osdist["PRETTY_NAME"],
            release: osdist["VERSION_ID"],
            code: osdist["VERSION"]
        });
    });
};
