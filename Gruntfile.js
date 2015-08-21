module.exports = function(grunt) {

    grunt.initConfig({
        lineremover: {
            nukebrowser: {
                files: {
                    'node_modules/socket.io-client/node_modules/engine.io-client/node_modules/engine.io-parser/package.json': 'node_modules/socket.io-client/node_modules/engine.io-client/node_modules/engine.io-parser/package.json'
                },
                options: {
                    exclusionPattern: /browser/
                }
            }
        },
        exec: {
            nexe: "nexe -i index.js -o logdna-agent-linux -f -t /tmp"
        }
    });
    grunt.loadNpmTasks('grunt-line-remover');
    grunt.loadNpmTasks('grunt-exec');
    grunt.registerTask('build', ['lineremover', 'exec']);
};
