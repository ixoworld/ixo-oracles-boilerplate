import { request } from '../utils/request.js';
import {
  type CreateAndJoinOracleRoomPayload,
  type JoinSpaceOrRoomPayload,
  type MatrixClientConstructorParams,
  type SourceSpacePayload,
} from './types.js';

class MatrixClient {
  constructor(private readonly params: MatrixClientConstructorParams) {
    this.params.appServiceBotUrl =
      this.params.appServiceBotUrl ?? MatrixRoomBotServerUrl[chainNetwork];
    this.params.homeserverUrl =
      this.params.homeserverUrl ?? MatrixHomeServerUrl[chainNetwork];

    if (!this.params.appServiceBotUrl || !this.params.homeserverUrl) {
      throw new Error('Matrix client params are not valid');
    }
  }

  // source space
  public async sourceMainSpace(payload: SourceSpacePayload): Promise<string> {
    const url = `${this.params.appServiceBotUrl}/spaces/source`;
    const response = await request<{ space_id: string }>(url, 'POST', {
      body: JSON.stringify({
        did: payload.userDID,
      }),
    });

    return decodeURIComponent(response.space_id);
  }

  /**
   * Join a Matrix room using the room ID or alias
   * @param roomIdOrAlias - The room ID (!example:server.com) or alias (#example:server.com)
   * @param accessToken - The user's Matrix access token
   * @param homeserverUrl - The homeserver URL (defaults to matrix.org)
   * @returns The joined room ID
   */
  public async joinSpaceOrRoom(
    payload: JoinSpaceOrRoomPayload,
  ): Promise<string> {
    try {
      // Use the join endpoint with room ID or alias
      const url = `${this.params.homeserverUrl}/_matrix/client/v3/join/${payload.roomId}`;

      const response = await request<{ room_id: string }>(url, 'POST', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.params.userAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      return decodeURIComponent(response.room_id);
    } catch (error) {
      console.error('Error joining room:', error);
      throw error;
    }
  }

  public async createAndJoinOracleRoom(
    payload: CreateAndJoinOracleRoomPayload,
  ): Promise<string> {
    const url = `${this.params.appServiceBotUrl}/spaces/oracle/create`;
    const response = await request<{ roomId: string }>(url, 'POST', {
      body: JSON.stringify({
        did: payload.userDID,
        oracleDid: payload.oracleDID,
      }),
      headers: {
        Authorization: `Bearer ${this.params.userAccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    return this.joinSpaceOrRoom({ roomId: response.roomId });
  }

  public async inviteUser(roomId: string, userId: string): Promise<void> {
    const url = `${this.params.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.params.userAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Failed to invite ${userId} to ${roomId}: ${res.status} ${errText}`,
      );
    }
  }
}

export default MatrixClient;

const MatrixRoomBotServerUrl = {
  devnet: 'https://rooms.bot.devmx.ixo.earth',
  testnet: 'https://rooms.bot.testmx.ixo.earth',
  mainnet: 'https://rooms.bot.mx.ixo.earth',
};

const MatrixHomeServerUrl = {
  devnet: 'https://devmx.ixo.earth',
  testnet: 'https://testmx.ixo.earth',
  mainnet: 'https://mx.ixo.earth',
};
const chainNetwork = process.env
  .NEXT_PUBLIC_CHAIN_NETWORK as keyof typeof MatrixRoomBotServerUrl;
