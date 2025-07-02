import { Logger } from '@ixo/logger';
import { type MatrixClient, ClientEvent } from 'matrix-js-sdk';

export async function syncMatrixState(client: MatrixClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function onSync(state: string) {
      switch (state) {
        case 'NULL':
          Logger.info('NULL state');
          break;
        case 'SYNCING':
          // ...
          break;
        case 'PREPARED':
          Logger.info(`PREPARED state for user ${client.getUserId()}`);
          cleanup();
          resolve();
          break;
        case 'RECONNECTING':
          Logger.info('RECONNECTING state');
          break;
        case 'CATCHUP':
          Logger.info('CATCHUP state');
          break;
        case 'ERROR':
          cleanup();
          reject(new Error('Error starting Matrix client'));
          break;
        case 'STOPPED':
          Logger.info('STOPPED state');
          break;
        default:
          break;
      }
    }

    // Attach the listener
    client.on(ClientEvent.Sync, onSync);

    // A small utility to remove the listener
    function cleanup(): void {
      client.removeListener(ClientEvent.Sync, onSync);
    }
  });
}
