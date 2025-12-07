import { getSubscriptionUrlByNetwork } from '@ixo/common';
import { MatrixManager } from '@ixo/matrix';
import { setupClaimSigningMnemonics } from '@ixo/oracles-chain-client';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ENV, matrixAccountRoomId } from './config';
import { EditorMatrixClient } from './graph/agents/editor/editor-mx';
import { UserMatrixSqliteSyncService } from './user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
async function bootstrap(): Promise<void> {
  // await migrate();

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<ENV>);
  const port = configService.get<number>('PORT', 3000); // Default to 3000 if PORT not set

  // Security Headers
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*', // Configure as needed
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-matrix-access-token',
      'x-did',
      'x-request-id',
      'x-timezone',
    ],
    exposedHeaders: ['X-Request-Id'],
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that do not have any decorators
      transform: true, // Automatically transform payloads to DTO instances
    }),
  );

  // Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('API Boilerplate')
    .setDescription('The API description for the boilerplate')
    // set json docs link
    .setExternalDoc('OpenAPI JSON', '/docs/json')
    .setVersion('1.0')
    // Define the Matrix access token header as an API key security scheme
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-matrix-access-token',
        description: "User's Matrix access token (Required for most endpoints)",
      },
      'matrix-token',
    )
    // Define the DID header as an API key security scheme
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-did',
        description: "User's DID (Required for most endpoints)",
      },
      'did',
    )
    // Apply both security requirements globally
    .addSecurityRequirements('matrix-token')
    .addSecurityRequirements('did')
    // Remove the duplicate global parameters
    .build();
  const document = SwaggerModule.createDocument(app, config);

  // Serve Swagger JSON at the specified URL
  app.use('/docs/json', (req, res) => {
    res.json(document);
  });

  SwaggerModule.setup('docs', app, document, {
    // explorer: true,
    // customSiteTitle: 'API Documentation',
    swaggerUrl: '/docs/json',
  });

  const matrixManager = MatrixManager.getInstance();
  await matrixManager.init();

  const editorMatrixClient = EditorMatrixClient.getInstance();
  editorMatrixClient.init().catch((error) => {
    Logger.error('Failed to initialize EditorMatrixClient:', error);
    Logger.warn('Editor functionality may be limited until sync completes');
  });
  Logger.log('EditorMatrixClient initialization started in background...');

  registerGracefulShutdown({ app, matrixManager });

  Logger.log('Setting up claim signing mnemonics...');
  Logger.log(`Matrix account room id: ${matrixAccountRoomId}`);
  const decryptedSigningMnemonic = await setupClaimSigningMnemonics({
    matrixRoomId: matrixAccountRoomId,
    matrixAccessToken: configService.getOrThrow(
      'MATRIX_ORACLE_ADMIN_ACCESS_TOKEN',
    ),
    walletMnemonic: configService.getOrThrow('SECP_MNEMONIC'),
    pin: configService.getOrThrow('MATRIX_VALUE_PIN'),
    signerDid: configService.getOrThrow('ORACLE_DID'),
    network: configService.getOrThrow('NETWORK'),
  });
  Logger.log('Claim signing mnemonics setup complete', {
    decryptedSigningMnemonic,
  });

  await app.listen(port);
  Logger.log(`Application is running on: ${await app.getUrl()}`);
  Logger.log(`Swagger UI available at: ${await app.getUrl()}/docs`);
  Logger.log(`Oracle: ${matrixManager.getClient()?.userId}`);
  Logger.log(
    `subscription: ${configService.get('SUBSCRIPTION_URL') ?? getSubscriptionUrlByNetwork(configService.getOrThrow('NETWORK'))}`,
  );
  Logger.log(
    `Throw on insufficient credits: ${configService.get('THROW_ON_INSUFFICIENT_CREDITS')}. type: ${typeof configService.get('THROW_ON_INSUFFICIENT_CREDITS')}`,
  );
}
void bootstrap();

function registerGracefulShutdown({
  app,
  matrixManager,
}: {
  app: INestApplication;
  matrixManager: MatrixManager;
}): void {
  const context = 'Bootstrap';

  const gracefulShutdown = async (signal: NodeJS.Signals) => {
    Logger.log(`${signal} received, starting graceful shutdown...`, context);

    try {
      // Step 1: Upload checkpoints to Matrix
      try {
        const userMatrixSqliteSyncService = app.get(
          UserMatrixSqliteSyncService,
        );
        Logger.log(
          'Uploading checkpoint to Matrix storage task started',
          context,
        );
        await userMatrixSqliteSyncService.uploadCheckpointToMatrixStorageTask();
        Logger.log(
          'Uploading checkpoint to Matrix storage task complete',
          context,
        );
      } catch (error) {
        Logger.warn(
          'Failed to upload checkpoint during shutdown (continuing anyway)',
          error instanceof Error ? error.message : String(error),
          context,
        );
      }

      // Step 2: Close Nest application
      try {
        Logger.log('Stopping Nest application...', context);
        await app.close();
        Logger.log('Nest application stopped', context);
      } catch (error) {
        Logger.error(
          'Error stopping Nest application',
          error instanceof Error ? error.message : String(error),
          context,
        );
      }

      // Step 3: Shutdown MatrixManager
      try {
        Logger.log('Stopping MatrixManager client...', context);
        await matrixManager.shutdown();
        Logger.log('MatrixManager client stopped', context);
      } catch (error) {
        Logger.error(
          'Error stopping MatrixManager',
          error instanceof Error ? error.message : String(error),
          context,
        );
      }

      // Step 4: Destroy EditorMatrixClient
      try {
        Logger.log('Stopping EditorMatrixClient...', context);
        await EditorMatrixClient.destroy();
        Logger.log('EditorMatrixClient stopped', context);
      } catch (error) {
        Logger.error(
          'Error stopping EditorMatrixClient',
          error instanceof Error ? error.message : String(error),
          context,
        );
      }

      Logger.log('Graceful shutdown complete', context);
      process.exit(0);
    } catch (error) {
      Logger.error(
        'Error during graceful shutdown',
        error instanceof Error ? error.stack : String(error),
        context,
      );
      process.exit(1);
    }
  };

  ['SIGTERM', 'SIGINT'].forEach((signal) => {
    process.once(signal, () => void gracefulShutdown(signal as NodeJS.Signals));
  });
}
