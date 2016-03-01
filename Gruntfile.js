var pkg = require('./package.json');
var grunt = require('grunt');
require('load-grunt-tasks')(grunt);

module.exports = function (grunt) {

    var files = ['./*.js', 'lib/**/*.js'];
    grunt.initConfig({
        lineremover: {
            nukebrowser: {
                files: {
                    'node_modules/ws/package.json': 'node_modules/ws/package.json'
                },
                options: {
                    exclusionPattern: /browser/
                }
            }
        },
        exec: {
            nexe: 'nexe -i index.js -o logdna-agent -f -t ~/tmp -r 0.12.7',
            fpm_rpm: 'fpm -s dir -t rpm -n logdna-agent -v ' + pkg.version + ' --license Commercial --vendor \'Answerbook, Inc.\' --description \'LogDNA Agent for Linux\' --url http://logdna.com/ -m \'<help@logdna.com>\' --before-remove ./scripts/before-remove --after-upgrade ./scripts/after-upgrade -f ./logdna-agent=/usr/bin/logdna-agent ./scripts/init-script=/etc/init.d/logdna-agent',
            fpm_deb: 'fpm -s dir -t deb -n logdna-agent -v ' + pkg.version + ' --license Commercial --vendor \'Answerbook, Inc.\' --description \'LogDNA Agent for Linux\' --url http://logdna.com/ -m \'<help@logdna.com>\' --before-remove ./scripts/before-remove --after-upgrade ./scripts/after-upgrade -f --deb-no-default-config-files ./logdna-agent=/usr/bin/logdna-agent ./scripts/init-script=/etc/init.d/logdna-agent'
        },
        jshint: {
            files: files,
            options: {
                jshintrc: '.jshintrc'
            }
        },
        jscs: {
            files: {
                src: files
            },
            options: {
                config: '.jscsrc',
                esnext: true
            }
        }
    });
    grunt.registerTask('test', ['jshint', 'jscs']);
    grunt.registerTask('build', ['lineremover', 'exec:nexe']);
    grunt.registerTask('release', ['build', 'exec:fpm_rpm', 'exec:fpm_deb']);
};
