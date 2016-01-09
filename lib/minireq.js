var http = require("http");
var https = require("https");
var url = require("url");
var _ = require("lodash");
var req;
var ua;

function get(uri, options, callback) {
    if (typeof options == "function") {
        callback = options;
        options = {};
    }
    _.extend(options, url.parse(uri));
    options.headers = options.headers || {};

    if (ua)
        options.headers['User-Agent'] = ua;

    req = (options.protocol == "http:" ? http : https).get(options, function(res) {
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

    if (options.timeout) {
        req.setTimeout(options.timeout, function() {
            return callback && callback("Error: Request timed out");
        });
    }
}

function post(uri, postdata, options, callback) {
    if (typeof options == "function") {
        callback = options;
        options = {};
    }
    _.extend(options, url.parse(uri));
    options.method = "POST";
    options.headers = options.headers || {};

    if (typeof postdata == "object") {
        options.headers['Content-Type'] = 'application/json';
        postdata = JSON.stringify(postdata);
    }

    if (ua)
        options.headers['User-Agent'] = ua;

    req = (options.protocol == "http:" ? http : https).request(options, function(res) {
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

    if (options.timeout) {
        req.setTimeout(options.timeout, function() {
            return callback && callback("Error: Request timed out");
        });
    }

    req.write(postdata);
    req.end();
}

function setUA(useragent) {
    ua = useragent;
}

exports.setUA = setUA;
exports.get = get;
exports.post = post;
