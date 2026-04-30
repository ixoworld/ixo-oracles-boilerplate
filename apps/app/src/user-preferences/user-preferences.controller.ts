import { MatrixManager } from '@ixo/matrix';
import { getMatrixHomeServerCroppedForDid } from '@ixo/oracles-chain-client';
import { Controller, Get, Logger, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { ENV } from 'src/types';
import {
  UserPreferencesService,
  type UserPreferences,
} from './user-preferences.service';

@ApiTags('user-preferences')
@Controller('user-preferences')
export class UserPreferencesController {
  private readonly logger = new Logger(UserPreferencesController.name);

  constructor(private readonly configService: ConfigService<ENV>) {}

  @Get()
  @ApiOperation({
    summary: 'Get user preferences for the user↔oracle Matrix room',
  })
  @ApiResponse({
    status: 200,
    description:
      'Preferences object, or null when no preferences have been set yet.',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid auth token.' })
  async getPreferences(@Req() req: Request): Promise<UserPreferences | null> {
    const { did, homeServer } = req.authData;
    const oracleEntityDid =
      this.configService.getOrThrow<string>('ORACLE_ENTITY_DID');

    const userHomeServer =
      homeServer && homeServer.trim().length > 0
        ? homeServer
        : await getMatrixHomeServerCroppedForDid(did);

    const { roomId } =
      await MatrixManager.getInstance().getOracleRoomIdWithHomeServer({
        userDid: did,
        oracleEntityDid,
        userHomeServer,
      });

    if (!roomId) {
      this.logger.warn(
        `Could not resolve user↔oracle room for userDid=${did}, oracleEntityDid=${oracleEntityDid}, userHomeServer=${userHomeServer}`,
      );
      return null;
    }

    const prefs = await UserPreferencesService.getInstance().get(roomId);
    this.logger.log(
      `Fetched user preferences for userDid=${did}, roomId=${roomId}: ${prefs ? 'Found' : 'null'}`,
    );
    return prefs ?? null;
  }
}
