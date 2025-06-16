import { Global, Module } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import { WsService } from './ws.service';

@Global()
@Module({
  providers: [WsService, WsGateway],
  exports: [WsService],
})
export class WsModule {}
