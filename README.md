# logdna-agent-linux

[![Build Status](http://logdna-ci.westus.cloudapp.azure.com/api/badges/sedouard/logdna-agent/status.svg)](http://logdna-ci.westus.cloudapp.azure.com/sedouard/logdna-agent)

LogDNA's client agent which streams log files to your LogDNA account.

## Getting Started

### Configuration File

You'll need to create a configuration file [like this one](./lib/.logdna.conf):

```conf
logdir: /var/log/myapp
key: <YOUR LOGDNA KEY>
autoupdate: 1
```

On Windows, you can use Windows paths, just make sure to use `\\` as a separator:

```conf
logdir: C:\\Users\\sedouard\\AppData\\logdna
key: <YOUR LOGDNA KEY>
autoupdate: 1
```

### From an Official Release

Check out the offical [LogDNA Documentation](https://logdna.com/) on how to get started from a released version of LogDNA CLI and agent.

### From Source

Follow these quick instructions to run the LogDNA agent from source

```bash
git clone https://github.com/sedouard/logdna-agent.git
cd logdna-agent
npm install
# you can also just call node index.js to see other options
node index.js -c <YOUR LOGDNA Configuration>
```

## How it Works

The LogDNA agent authenticates using your LogDNA key and opens a web socket to the LogDNA service. It then 'tails' for new log files added to your specific logging directories watching for file changes. Those changes are sent to to LogDNA via the web socket.

## Contributing

Contributions are always welcome. See the [contributing guide]() to learn how you can help.
