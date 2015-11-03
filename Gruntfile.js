var pkg = require('./package.json');
module.exports = function(grunt) {

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
            nexe: "nexe -i index.js -o logdna-agent-linux -f -t ~/tmp -r 0.12.7",
            fpm_rpm: 'fpm -s dir -t rpm -n logdna-agent-linux -v ' + pkg.version + ' --license Commercial --vendor "Answerbook, Inc." --description "LogDNA Agent for Linux" --url http://logdna.com/ -m "<help@logdna.com>" --before-remove ./scripts/before-remove --after-upgrade ./scripts/after-upgrade -f ./logdna-agent-linux=/usr/bin/logdna-agent-linux ./scripts/init-script=/etc/init.d/logdna-agent',
            fpm_deb: 'fpm -s dir -t deb -n logdna-agent-linux -v ' + pkg.version + ' --license Commercial --vendor "Answerbook, Inc." --description "LogDNA Agent for Linux" --url http://logdna.com/ -m "<help@logdna.com>" --before-remove ./scripts/before-remove --after-upgrade ./scripts/after-upgrade -f --deb-no-default-config-files ./logdna-agent-linux=/usr/bin/logdna-agent-linux ./scripts/init-script=/etc/init.d/logdna-agent'
        }
    });
    grunt.loadNpmTasks('grunt-line-remover');
    grunt.loadNpmTasks('grunt-exec');
    grunt.registerTask('build', ['lineremover', 'exec:nexe']);
    grunt.registerTask('release', ['exec:fpm_rpm', 'exec:fpm_deb']);
};
