import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { type ENV } from 'src/types';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private static instance: RedisService;

  constructor(private readonly configService: ConfigService<ENV>) {
    RedisService.instance = this;
  }

  static getInstance(): RedisService {
    return RedisService.instance;
  }

  onModuleInit() {
    const redisUrl = this.configService.getOrThrow('REDIS_URL');
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
    });

    return this.client.connect();
  }

  onModuleDestroy() {
    return this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  static getClient(): Redis {
    return RedisService.getInstance().getClient();
  }
}
