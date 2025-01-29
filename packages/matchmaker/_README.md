(sorry Endel Idk why readme.md is blocked from committing or where you want this documentation)

# Readme

1. Ensure that you are using the ValkeyDriver and LocalPresence in your colyseus server configuration
2. Ensure that you are passing externalMatchmaking: true to the ValkeyDriver, and an authentication token (DON'T SHARE THIS) a la externalMatchmakerAuth on the ServerOptions
3. Ensure that the redis/valkey cluster config in this package matches the one provided to the server Driver

# Goal
The purpose of this package is to help with high availability and global-scale deployments of colyseus. It is assumed that you have some familiarity with AWS and server architecture.

To achieve these goals, we extricate most of the matchmaker functions from the colyseus/core package and run them in a lambda function.

You will likely need to do SOME work regarding customization of the lambda function etc. on your end.

# Local
To run this locally, ensure you have a redis server available ( a docker-compose is pre-configured in the matchmaker/local file ) and then run the local app in matchmaker/local/index.ts

# Remote
Remote use is what this package was truly designed for. Inside of the remote folder you will find an example terraform definition that you can use to deploy the infrastructure.