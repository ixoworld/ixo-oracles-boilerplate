import { Global, Module } from '@nestjs/common';
import { SseController } from './sse.controller';
import { SseService } from './sse.service';

@Global()
@Module({
  providers: [SseService],
  controllers: [SseController],
  exports: [SseService],
})
export class SseModule {}
