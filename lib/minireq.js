var http = require("http");
var https = require("https");
var url = require("url");
var options, req;

function post(uri, postdata, callback) {
    options = url.parse(uri);
    options.method = "POST";

    if (typeof postdata == "object") {
        options.headers = {
            'Content-Type': 'application/json'
        };
        postdata = JSON.stringify(postdata);
    }

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

    req.write(postdata);
    req.end();
}

exports.post = post;
