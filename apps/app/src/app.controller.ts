import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Throttle({
    default: {
      ttl: 60000, // 1 minute
      limit: 30, // 30 requests
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
