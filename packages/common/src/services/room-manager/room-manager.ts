import { MatrixManager, type Room } from '@ixo/matrix';
import { type CreateRoomDto, type GetRoomDto } from './dto.js';

export class RoomManagerService {
  constructor(protected readonly matrixManger = MatrixManager.getInstance()) {}

  public async createRoom(dto: CreateRoomDto): Promise<string> {
    const roomId = await this.matrixManger.createRoomAndJoin(dto);
    return roomId;
  }

  /**
   * Get the room id for a given oracle name and did
   * @param dto - The dto containing the oracle name and did
   * @returns The room id
   */
  public getRoomId(dto: GetRoomDto): Promise<string | undefined> {
    return this.matrixManger.getRoomId(dto);
  }

  public async getOrCreateRoom(dto: CreateRoomDto): Promise<string> {
    const roomId = await this.getRoomId(dto);
    if (roomId) {
      return roomId;
    }
    return this.createRoom(dto);
  }

  public async getRoom(dto: GetRoomDto): Promise<Room | undefined | null> {
    const roomId = await this.getRoomId(dto);
    if (roomId && dto.userAccessToken) {
      return this.matrixManger.getRoom(roomId, dto.userAccessToken);
    }
    return undefined;
  }
}
