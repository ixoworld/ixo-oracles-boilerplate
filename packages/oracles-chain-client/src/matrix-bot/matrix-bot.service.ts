import {
  createMatrixApiClient,
  createMatrixClaimBotClient,
  createMatrixRoomBotClient,
  createMatrixStateBotClient,
} from '@ixo/matrixclient-sdk';
import {
  getMatrixUrlsForDid,
  getMatrixHomeServerCroppedForDid,
} from './did-matrix-batcher.js';
import type { GetOpenIdToken } from './openid-token-provider.js';

export interface MatrixConfig {
  botUrl: string;
  accessToken: string;
  roomId: string;
}

export class MatrixBotService {
  private accessToken?: string;
  private getOpenIdToken?: GetOpenIdToken;
  private authDid?: string;

  constructor(
    accessToken?: string,
    getOpenIdToken?: GetOpenIdToken,
    authDid?: string,
  ) {
    this.accessToken = accessToken;
    this.getOpenIdToken = getOpenIdToken;
    this.authDid = authDid;
  }

  private async requireAuth(): Promise<{
    openIdToken: string;
    authDid: string;
  }> {
    if (!this.getOpenIdToken || !this.authDid) {
      throw new Error(
        'OpenID token provider and authDid are required for authenticated bot operations. ' +
          'Pass getOpenIdToken and authDid to the MatrixBotService constructor.',
      );
    }
    const openIdToken = await this.getOpenIdToken();
    return { openIdToken, authDid: this.authDid };
  }

  private async getStateBotForDid(did: string) {
    const matrixUrls = await getMatrixUrlsForDid(did);
    return createMatrixStateBotClient({
      botUrl: matrixUrls.stateBot,
      accessToken: this.accessToken,
      homeServerUrl: matrixUrls.homeServer,
    });
  }

  private async getApiClientForDid(did: string) {
    const matrixUrls = await getMatrixUrlsForDid(did);
    return createMatrixApiClient({
      homeServerUrl: matrixUrls.homeServer,
    });
  }

  private async getClaimBotForDid(did: string) {
    const matrixUrls = await getMatrixUrlsForDid(did);
    return createMatrixClaimBotClient({
      botUrl: matrixUrls.claimBot,
      accessToken: this.accessToken,
      homeServerUrl: matrixUrls.homeServer,
    });
  }

  private async getRoomBotForDid(did: string) {
    const matrixUrls = await getMatrixUrlsForDid(did);
    return createMatrixRoomBotClient({
      botUrl: matrixUrls.roomsBot,
      accessToken: this.accessToken ?? '',
      homeServerUrl: matrixUrls.homeServer,
    });
  }

  async getWithDid<T>(
    did: string,
    roomId: string,
    key: string,
    path?: string,
  ): Promise<T | Record<string, T>> {
    try {
      const { openIdToken, authDid } = await this.requireAuth();
      const stateBot = await this.getStateBotForDid(did);
      const response = await stateBot.state.v1beta1.queryState(
        roomId,
        key,
        path ?? '',
        openIdToken,
        authDid,
      );
      return response.data as T | Record<string, T>;
    } catch (error) {
      console.error(
        `Error fetching data from type "${key}" with key "${path}" for DID "${did}":`,
        error,
      );
      throw new Error('Failed to retrieve data.');
    }
  }

  async getRoomIdFromAliasWithDid(entityDid: string): Promise<string> {
    const homeServerCropped =
      await getMatrixHomeServerCroppedForDid(entityDid);
    const daoRoomAlias = `#${entityDid.replaceAll(/:/g, '-')}:${homeServerCropped}`;
    const apiClient = await this.getApiClientForDid(entityDid);
    const response = await apiClient.room.v1beta1.queryId(daoRoomAlias);
    return response.room_id;
  }

  async getRoomAliasWithDid(did: string): Promise<string> {
    const homeServerCropped = await getMatrixHomeServerCroppedForDid(did);
    return `#${did.replaceAll(/:/g, '-')}:${homeServerCropped}`;
  }

  async getRoomByDidWithDid(entityDid: string): Promise<string | void> {
    if (!entityDid) throw new Error('Entity DID is required');
    const roomAlias = await this.getRoomAliasWithDid(entityDid);
    const apiClient = await this.getApiClientForDid(entityDid);

    try {
      const { room_id } = await apiClient.room.v1beta1.queryId(roomAlias);
      return room_id;
    } catch (error) {
      console.error('Error getting room by DID', { error });
      throw new Error(`[getRoomByDid] Error getting room by DID`);
    }
  }

  async sourceRoomAndJoinWithDid(entityDid: string): Promise<string> {
    try {
      const { openIdToken, authDid } = await this.requireAuth();
      const roomBot = await this.getRoomBotForDid(entityDid);
      const sourceRoomResponse =
        await roomBot.room.v1beta1.sourceRoomAndJoin(
          entityDid,
          openIdToken,
          authDid,
        );

      const claimBot = await this.getClaimBotForDid(entityDid);
      await claimBot.bot.v1beta1.invite(sourceRoomResponse.roomId);
      return sourceRoomResponse.roomId;
    } catch (error) {
      console.error('Error sourcing room and joining', { error });
      throw new Error(
        `[sourceRoomAndJoin] Error sourcing room and joining`,
      );
    }
  }

  async inviteClaimBotWithDid(entityDid: string, roomId: string) {
    try {
      const claimBot = await this.getClaimBotForDid(entityDid);
      await claimBot.bot.v1beta1.invite(roomId);
      return 'ok';
    } catch (error) {
      console.error('Error inviting bot', { error });
      throw new Error(`[inviteClaimBot] Error inviting bot: ${error}`);
    }
  }

  async saveClaimToMatrixWithDid(
    entityDid: string,
    collectionId: string,
    claim: unknown,
  ) {
    try {
      const { openIdToken, authDid } = await this.requireAuth();
      const claimBot = await this.getClaimBotForDid(entityDid);
      const claimToStr = JSON.stringify(claim);
      const response = await claimBot.claim.v1beta1.saveClaim(
        collectionId,
        claimToStr,
        openIdToken,
        authDid,
      );
      return response;
    } catch (error) {
      throw new Error(
        `[saveClaimToMatrix] Error saving claim to matrix: ${error}`,
      );
    }
  }

  async getClaimBodyWithDid(
    entityDid: string,
    collectionId: string,
    claimId: string,
  ) {
    const { openIdToken, authDid } = await this.requireAuth();
    const claimBot = await this.getClaimBotForDid(entityDid);
    const claimBody = await claimBot.claim.v1beta1.queryClaim(
      collectionId,
      claimId,
      openIdToken,
      authDid,
    );
    return claimBody;
  }
}
