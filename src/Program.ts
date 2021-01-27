import ApiGateway from 'aws-sdk/clients/apigateway';

import Lambda, { _Blob } from 'aws-sdk/clients/lambda';
import { CredentialsOptions } from 'aws-sdk/lib/credentials';
import chalk from 'chalk';

export interface Context {
  [key: string]: any;

  apiId?: string;
  functionArn?: string;
}

export interface RunConfiguration {
  // will be pulled from .aws/credentials if there's any
  credentials?: CredentialsOptions;
  region: string;
  lambda: {
    functionName: string;
    executionRole: string;
    codeBundle: _Blob;
    timeoutInSeconds?: number;
    memorySizeInMb?: number;
    environmentVariables?: Record<string, string>;
  };
  apigateway: {
    apiName: string;
    resourcePathPart: string;
  };
}

export class Program {
  config: RunConfiguration = {
    region: '',
    lambda: {
      functionName: '',
      executionRole: '',
      codeBundle: '',
    },
    apigateway: {
      apiName: '',
      resourcePathPart: '',
    },
  };
  context: Context = {};

  constructor(public useAutomaticRollbackOnFailure = true) {}

  async run(config: RunConfiguration): Promise<void> {
    this.context = {};
    this.config = config;
    const lambda = this.initializeLambda();

    let functionExists = false;
    try {
      await lambda
        .getFunction({
          FunctionName: config.lambda.functionName,
        })
        .promise();
      functionExists = true;
    } catch (e) {
      // catch error thrown if function was not found
    }
    if (functionExists) {
      throw new Error(
        `Function with name ${chalk.yellow(config.lambda.functionName)} already exists.`,
      );
    }

    const apiGateway = this.initializeApiGateway();

    try {
      const getApisResult = await apiGateway
        .getRestApis({
          limit: 500,
        })
        .promise();
      if (getApisResult.items?.some((api) => api.name === config.apigateway.apiName)) {
        throw new Error(
          `REST-API with name ${chalk.yellow(config.apigateway.apiName)} already exists.`,
        );
      }

      const createApiResult = await apiGateway
        .createRestApi({
          name: config.apigateway.apiName,
          endpointConfiguration: {
            types: ['REGIONAL'],
          },
        })
        .promise();

      if (!createApiResult.id) {
        throw new Error('REST-API creation failed.');
      }

      this.context.apiId = createApiResult.id;

      const getResourcesResult = await apiGateway
        .getResources({
          restApiId: createApiResult.id,
        })
        .promise();
      const rootResource = getResourcesResult.items?.find((item) => item.path === '/');

      if (!rootResource?.id) {
        throw new Error('REST-API creation failed.');
      }

      const createResourceResult = await apiGateway
        .createResource({
          restApiId: createApiResult.id,
          pathPart: config.apigateway.resourcePathPart,
          parentId: rootResource.id,
        })
        .promise();

      if (!createResourceResult?.id) {
        throw new Error('Resource creation failed.');
      }

      await apiGateway
        .putMethod({
          restApiId: createApiResult.id,
          resourceId: createResourceResult.id,
          httpMethod: 'ANY',
          authorizationType: 'NONE',
        })
        .promise();

      const createFunctionResult = await lambda
        .createFunction({
          FunctionName: config.lambda.functionName,
          Runtime: 'nodejs12.x',
          Handler: 'index.handler',
          Role: config.lambda.executionRole,
          Code: {
            ZipFile: config.lambda.codeBundle,
          },
          Timeout: config.lambda.timeoutInSeconds || 8,
          MemorySize: config.lambda.memorySizeInMb || 256,
          PackageType: config.lambda.codeBundle ? 'Zip' : undefined,
          Environment: {
            Variables: config.lambda.environmentVariables,
          },
        })
        .promise();

      if (!createFunctionResult.FunctionArn) {
        throw new Error('Function creation failed.');
      }
      this.context.functionArn = createFunctionResult.FunctionArn;

      await apiGateway
        .putIntegration({
          restApiId: createApiResult.id,
          resourceId: createResourceResult.id,
          httpMethod: 'ANY',
          type: 'AWS_PROXY',
          integrationHttpMethod: 'POST',
          uri: `arn:aws:apigateway:${lambda.config.region}:lambda:path/2015-03-31/functions/${createFunctionResult.FunctionArn}/invocations`,
        })
        .promise();

      await apiGateway
        .putIntegrationResponse({
          restApiId: createApiResult.id,
          resourceId: createResourceResult.id,
          httpMethod: 'ANY',
          statusCode: '200',
          responseTemplates: {},
        })
        .promise();

      await apiGateway
        .createDeployment({
          restApiId: createApiResult.id,
          stageName: 'default',
        })
        .promise();

      const accountId = createFunctionResult.FunctionArn.split(':')[4];
      await lambda
        .addPermission({
          FunctionName: config.lambda.functionName,
          StatementId: 'apigateway-test',
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: `arn:aws:execute-api:${lambda.config.region}:${accountId}:${createApiResult.id}/*/*/${config.apigateway.resourcePathPart}`,
        })
        .promise();

      await lambda
        .addPermission({
          FunctionName: config.lambda.functionName,
          StatementId: 'apigateway-default',
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: `arn:aws:execute-api:${lambda.config.region}:${accountId}:${createApiResult.id}/default/*/${config.apigateway.resourcePathPart}`,
        })
        .promise();
      return this.onSuccess();
    } catch (e) {
      await this.onFailure(e);
      throw new Error();
    }
  }

  private async rollback(): Promise<void> {
    if (this.context.apiId) {
      const apiGateway = this.initializeApiGateway();
      try {
        await apiGateway
          .deleteRestApi({
            restApiId: this.context.apiId,
          })
          .promise();
        console.log(chalk.yellow('API deleted'));
      } catch (e) {}
    }

    if (this.context.functionArn) {
      const lambda = this.initializeLambda();
      try {
        await lambda
          .deleteFunction({
            FunctionName: this.config.lambda.functionName,
          })
          .promise();
        console.log(chalk.yellow('Function deleted'));
      } catch (e) {}
    }
  }

  private async onSuccess(): Promise<void> {
    console.log(chalk.green('Program succeeded'));
  }

  private async onFailure(error: any): Promise<void> {
    console.error(chalk.redBright(`Program failed:`));
    if (error.stack) {
      console.error(' ' + chalk.red(error.stack));
    }
    if (Object.keys(this.context).length) {
      console.error(
        ' ' +
          chalk.blueBright('Context: ') +
          chalk.blue(JSON.stringify(this.context, undefined, 2)),
      );

      if (this.useAutomaticRollbackOnFailure) {
        console.log(chalk.yellowBright('Rolling back...'));
        await this.rollback();
      }
    }
  }

  private initializeLambda(): Lambda {
    return new Lambda({
      credentials: this.config.credentials,
      region: this.config.region,
    });
  }

  private initializeApiGateway(): ApiGateway {
    return new ApiGateway({
      credentials: this.config.credentials,
      region: this.config.region,
    });
  }
}
