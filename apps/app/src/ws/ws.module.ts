import { Global, Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { WsGateway } from './ws.gateway';
import { WsService } from './ws.service';

@Global()
@Module({
  imports: [SessionsModule],
  providers: [WsService, WsGateway],
  exports: [WsService],
})
export class WsModule {}
