import chalk from 'chalk';
import { config } from 'dotenv';
import { promises } from 'fs';
import { join } from 'path';
import { Program } from './Program';

config();

const program = new Program();
(async () => {
  const envVariableErrors: string[] = [];
  const checkEnvironmentVariableAvailability = (key: string) => {
    if (!process.env[key]) {
      envVariableErrors.push(key + ' needs to be set');
    }
  };

  checkEnvironmentVariableAvailability('AWS_REGION');
  checkEnvironmentVariableAvailability('LAMBDA_FUNCTION_NAME');
  checkEnvironmentVariableAvailability('LAMBDA_EXECUTION_ROLE');
  checkEnvironmentVariableAvailability('APIGATEWAY_API_NAME');
  checkEnvironmentVariableAvailability('APIGATEWAY_RESOURCE_PATH_PART');

  if (envVariableErrors.length) {
    console.error(
      chalk.redBright('Invalid environment-variables:\n- ') +
        envVariableErrors.map((err) => chalk.red(err)).join('\n- '),
    );
    throw new Error();
  }

  // load bundle
  const bundleBuffer = await promises.readFile(join(__dirname, '../bundle.zip'));

  // setup everything with passed configuration
  return program.run({
    region: process.env.AWS_REGION!,
    lambda: {
      functionName: process.env.LAMBDA_FUNCTION_NAME!,
      executionRole: process.env.LAMBDA_EXECUTION_ROLE!,
      codeBundle: bundleBuffer,
    },
    apigateway: {
      apiName: process.env.APIGATEWAY_API_NAME!,
      resourcePathPart: process.env.APIGATEWAY_RESOURCE_PATH_PART!,
    },
  });
})()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
