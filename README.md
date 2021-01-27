# Jovo Deployment for AWS

Easily deploy Jovo-applications on AWS.

![Structure of deployed architecture](./overview.svg 'Structure of deployed architecture')

## Getting Started

1. Clone this repository
1. Install all dependencies: `npm install`
1. Set the correct environment-variables or overwrite `src/index.ts` to pass the configuration

   - For a reference of required environment-variables take a look at [`.env.example`](../master/.env.example)
   - By default `dotenv` is used and environment-variables are loaded from a `.env`-file in the root.
   - Because the `aws-sdk` is used, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` can be automatically loaded if you have a profile set. For more information, take a look [here](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-shared.html).

1. Compile the .ts-files: `npm run build`

1. Run the project `npm start` or `node dist`

## `Program`

`Program` is the main class that takes care of the underlying processes for deploying the architecture.

It provides a rollback-functionality that will be called if an error occurs during the deployment, which will then undo steps done until the point of failure. \
This rollback-functionality can be turned off by passing `false` to the constructor of `Program`, although it is advised to not do so.

The deployment-process is started by calling the `run`-method of `Program`. This method takes a [`RunConfiguration`](../master/src/Program.ts#L14)-object as a parameter which is mandatory for the deployment.

Here's an example of a valid [`RunConfiguration`](../master/src/Program.ts#L14)-object:

```typescript
import { RunConfiguration } from './Program';
import { promises } from 'fs';

const bundleBuffer = promises.readFile('path/to/bundle.zip');
const config: RunConfiguration = {
  credentials: {
     accessKeyId: '$ACCESS_KEY_ID',
     secretAccessKey: '$SECRET_ACCESS_KEY',
  },
  region: 'eu-central-1',
  lambda: {
    functionName: 'automatic-test',
    executionRole: 'arn:aws:iam::$ACCOUNT:role/$ROLE_NAME',
    codeBundle: bundleBuffer,
  },
  apigateway: {
    apiName: 'automatic-test',
    resourcePathPart: 'automatic-test',
  },
};
```
