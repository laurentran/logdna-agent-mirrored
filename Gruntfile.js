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
            nexe: "nexe -i index.js -o logdna-agent-linux -f -t ~/tmp -r 0.12.7"
        }
    });
    grunt.loadNpmTasks('grunt-line-remover');
    grunt.loadNpmTasks('grunt-exec');
    grunt.registerTask('build', ['lineremover', 'exec']);
};
