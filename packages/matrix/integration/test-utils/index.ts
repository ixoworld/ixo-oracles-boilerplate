import { PostgreSqlContainer } from '@testcontainers/postgresql';
import * as sdk from 'matrix-js-sdk';
import { type MatrixManager } from 'src';
import { syncMatrixState } from 'src/utils/sync';
import { GenericContainer, Network, Wait } from 'testcontainers';

jest.mock('matrix-js-sdk/lib/logger');

export type CleanupFunction = () => Promise<void>;
export async function prepareTest(
  manager: MatrixManager,
): Promise<CleanupFunction> {
  // Create network
  const network = await new Network().start();

  // Start PostgreSQL container
  const postgresContainer = await new PostgreSqlContainer()
    .withDatabase('synapse')
    .withUsername('postgres')
    .withPassword('password')
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_INITDB_ARGS: '--encoding=UTF8 --no-locale',
    })
    .withNetwork(network)
    .withNetworkAliases('matrix-db') // This matches the hostname in config
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections'),
    )
    .start();

  // Start Synapse container
  const synapseContainer = await new GenericContainer(
    'matrixdotorg/synapse:ixo',
  )
    .withEnvironment({
      SYNAPSE_SERVER_NAME: 'michael.test',
      SYNAPSE_REPORT_STATS: 'no',
      POSTGRES_HOST: 'matrix-db', // Use network alias instead of container IP
      POSTGRES_PORT: '5432', // Use default port within network
      POSTGRES_USER: postgresContainer.getUsername(),
      POSTGRES_PASSWORD: postgresContainer.getPassword(),
      POSTGRES_DB: postgresContainer.getDatabase(),
      SYNAPSE_CONFIG_PATH: '/data/homeserver.yaml',
    })
    .withNetwork(network)
    .withExposedPorts(8008, 8408)
    .withCopyDirectoriesToContainer([
      {
        source: './integration/matrix/data',
        target: '/data',
        mode: 0o644,
      },
    ])
    .withWaitStrategy(Wait.forHttp('/health', 8008))
    .start();

  // Set environment variables for tests
  process.env.MATRIX_BASE_URL = `http://${synapseContainer.getHost()}:${synapseContainer.getMappedPort(8008)}`;

  // 3. Register an "Oracle admin" user (assuming open registration)
  const oracleReg = await registerTestUser({
    baseUrl: process.env.MATRIX_BASE_URL,
    username: 'oracle',
    password: 'oracle',
  });

  process.env.MATRIX_ORACLE_ADMIN_ACCESS_TOKEN = oracleReg.accessToken;
  process.env.MATRIX_ORACLE_ADMIN_USER_ID = oracleReg.userId;
  process.env.MATRIX_ORACLE_ADMIN_PASSWORD = 'oracle';
  process.env.MATRIX_RECOVERY_PHRASE = 'recovery phrase';

  await manager.init();

  return async () => {
    await manager.stop();
    await synapseContainer.stop();
    await postgresContainer.stop();
    await network.stop();
  };
}
export async function registerTestUser({
  baseUrl,
  username,
  password,
}: {
  baseUrl: string;
  username: string;
  password: string;
}): Promise<{ userId: string; accessToken: string; deviceId: string }> {
  const response = await fetch(`${baseUrl}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      password,
      // The 'm.login.dummy' flow is the simplest approach if open registration is enabled
      auth: {
        type: 'm.login.dummy',
      },
    }),
  });

  // Always check if registration succeeded
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Registration failed (${response.status}): ${errorBody}`);
  }

  // Registration succeeded; parse the JSON response
  const data = (await response.json()) as {
    user_id: string;
    access_token: string;
    device_id: string;
  };

  return {
    userId: data.user_id,
    accessToken: data.access_token,
    deviceId: data.device_id,
  };
}

// Helper functions
export async function createTestUser(prefix = 'user') {
  const username = `${prefix}_${crypto.randomUUID().slice(0, 6)}`;
  return registerTestUser({
    baseUrl: process.env.MATRIX_BASE_URL ?? '',
    username,
    password: 'password123',
  });
}

export async function createMatrixClient(userReg: {
  userId: string;
  accessToken: string;
  deviceId: string;
}) {
  const client = sdk.createClient({
    baseUrl: process.env.MATRIX_BASE_URL ?? '',
    accessToken: userReg.accessToken,
    userId: userReg.userId,
    deviceId: userReg.deviceId,
  });

  await client.startClient({ initialSyncLimit: 1 });
  await syncMatrixState(client);
  return client;
}

export function generateTestDid() {
  return `did:ixo:ixo1${crypto.randomUUID().replace(/-/g, '').slice(0, 38)}`;
}

export async function createRoomForUser(
  manager: MatrixManager,
  userReg: { accessToken: string },
  oracleName: string,
) {
  const did = generateTestDid();
  const roomId = await manager.createRoomAndJoin({
    userAccessToken: userReg.accessToken,
    did,
    oracleName,
  });
  return { roomId, did };
}
