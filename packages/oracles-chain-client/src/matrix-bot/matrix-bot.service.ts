import {
  createMatrixApiClient,
  createMatrixClaimBotClient,
  createMatrixRoomBotClient,
  createMatrixStateBotClient,
} from '@ixo/matrixclient-sdk';
import {
  getMatrixClaimBotServerUrlByNetwork,
  MatrixBotHomeServerUrlByNetwork,
  MatrixHomeServerUrlByNetwork,
  MatrixHomeServerUrlCroppedByNetwork,
  MatrixRoomBotServerUrlByNetwork,
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
  private matrixClaimBotClient: ReturnType<typeof createMatrixClaimBotClient>;
  private matrixRoomBotClient: ReturnType<typeof createMatrixRoomBotClient>;

  constructor(accessToken?: string) {
    this.matrixClient = createMatrixStateBotClient({
      botUrl: MatrixBotHomeServerUrlByNetwork,
      accessToken: accessToken,
    });

    this.matrixAPIClient = createMatrixApiClient({
      homeServerUrl: MatrixHomeServerUrlByNetwork,
    });
    // this.matrixBidBotClient = this.createMatrixBidBotClient(accessToken);
    this.matrixClaimBotClient = createMatrixClaimBotClient({
      botUrl: getMatrixClaimBotServerUrlByNetwork(),
      accessToken,
    });
    this.matrixRoomBotClient = createMatrixRoomBotClient({
      botUrl: MatrixRoomBotServerUrlByNetwork,
      accessToken: accessToken ?? '',
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

  getRoomAlias(did: string) {
    return `#${did.replaceAll(/:/g, '-')}:${MatrixHomeServerUrlCroppedByNetwork}`;
  }

  async getRoomByDid(entityDid: string): Promise<string | void> {
    if (!entityDid) throw new Error('Entity DID is required');
    const roomAlias = this.getRoomAlias(entityDid);

    try {
      const { room_id } =
        await this.matrixAPIClient.room.v1beta1.queryId(roomAlias);

      return room_id;
    } catch (error) {
      console.error('Error getting room by DID', { error });
      throw new Error(`[getRoomByDid] Error getting room by DID`);
    }
  }
  async sourceRoomAndJoin(entityDid: string): Promise<string> {
    try {
      const sourceRoomResponse =
        await this.matrixRoomBotClient.room.v1beta1.sourceRoomAndJoin(
          entityDid,
        );

      await this.inviteClaimBot(sourceRoomResponse.roomId);
      return sourceRoomResponse.roomId;
    } catch (error) {
      console.error('Error sourcing room and joining', { error });
      throw new Error(`[sourceRoomAndJoin] Error sourcing room and joining`);
    }
  }

  async inviteClaimBot(roomId: string) {
    try {
      await this.matrixClaimBotClient.bot.v1beta1.invite(roomId);
      return 'ok';
    } catch (error) {
      console.error('Error inviting bot', { error });
      throw new Error(`[inviteClaimBot] Error inviting bot: ${error}`);
    }
  }

  async saveClaimToMatrix(collectionId: string, claim: any) {
    try {
      const claimToStr = JSON.stringify(claim);
      const response = await this.matrixClaimBotClient.claim.v1beta1.saveClaim(
        collectionId,
        claimToStr,
      );

      return response;
    } catch (error) {
      throw new Error(
        `[saveClaimToMatrix] Error saving claim to matrix: ${error}`,
      );
    }
  }

  async getClaimBody(collectionId: string, claimId: string) {
    const claimBody = await this.matrixClaimBotClient.claim.v1beta1.queryClaim(
      collectionId,
      claimId,
    );
    return claimBody;
  }
}
