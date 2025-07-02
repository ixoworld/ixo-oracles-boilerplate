import {
  createMatrixApiClient,
  createMatrixStateBotClient,
} from '@ixo/matrixclient-sdk';
import {
  MatrixBotHomeServerUrlByNetwork,
  MatrixHomeServerUrlByNetwork,
  MatrixHomeServerUrlCroppedByNetwork,
} from './config.js';

export interface MatrixConfig {
  botUrl: string;
  accessToken: string;
  roomId: string;
}

/**
 * A service class for interacting with the Matrix server for storing and retrieving data.
 */
export class MatrixBotService {
  private matrixClient: ReturnType<typeof createMatrixStateBotClient>;
  private matrixAPIClient: ReturnType<typeof createMatrixApiClient>;

  constructor(accessToken?: string) {
    this.matrixClient = createMatrixStateBotClient({
      botUrl: MatrixBotHomeServerUrlByNetwork,
      accessToken: accessToken,
    });

    this.matrixAPIClient = createMatrixApiClient({
      homeServerUrl: MatrixHomeServerUrlByNetwork,
    });
  }

  async get<T>(
    roomId: string,
    key: string,
    path?: string,
  ): Promise<T | Record<string, T>> {
    try {
      const response = await this.matrixClient.state.v1beta1.queryState(
        roomId,
        key,
        path,
      );
      return response.data as T | Record<string, T>;
    } catch (error) {
      console.error(
        `Error fetching data from type "${key}" with key "${path}":`,
        error,
      );
      throw new Error('Failed to retrieve data.');
    }
  }

  async getRoomIdFromAlias(did: string): Promise<string> {
    const daoRoomAlias = `#${did.replaceAll(/:/g, '-')}:${MatrixHomeServerUrlCroppedByNetwork}`;
    const response =
      await this.matrixAPIClient.room.v1beta1.queryId(daoRoomAlias);
    return response.room_id;
  }
}
