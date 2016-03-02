# Contributing

Contributions are always welcome! Be sure to follow the [github workflow](https://guides.github.com/introduction/flow/) when contributing to this project:

* Create an issue, or comment on an issue to indicate what you are working on. This avoids work duplication.
* Fork the repository and clone to your local machine
* You should already be on the default branch `master` - if not, check it out (`git checkout master`)
* Create a new branch for your feature/fix `git checkout -b my-new-feature`)
* Write your feature/fix
* Stage the changed files for a commit (`git add .`)
* Commit your files with a *useful* commit message ([example](https://github.com/Azure/azure-quickstart-templates/commit/53699fed9983d4adead63d9182566dec4b8430d4)) (`git commit`)
* Push your new branch to your GitHub Fork (`git push origin my-new-feature`)
* Visit this repository in GitHub and create a Pull Request.

# Running the Tests

Any tests are written in the [`./test`](./test) folder. At the moment there aren't any unit tests. 

To run all the validations (including `jshint` and `jscs` for code style) do:

```
grunt test
```

This is the same command that is ran during CI runs on your pull-request.

# Debugging

Each file has a `debug` variable defined such as:

```js
var debug = require('debug')('logdna:index');
```

To enable logs for the [index.js](https://github.com/sedouard/logdna-agent/blob/master/index.js) file just set the environment variable `DEBUG`:

```bash
# Unix/Linux
export DEBUG=logdna:index
# windows
set DEBUG=logdna:index
```

This enables `debug` log messages for the [index.js](https://github.com/sedouard/logdna-agent/blob/master/index.js) file.

You can also enable one or more modules to log by using `*`:

```bash
# Unix/Linux
export DEBUG=logdna:*
# windows
set DEBUG=logdna:lib:lib:api-client,logdna:index
```

You can use this to diagnose certain parts of the agent.
