import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { MessagesService } from '../messages/messages.service';
import { SessionsService } from '../sessions/sessions.service';
import { SlackService } from './slack.service';

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackService,
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: MessagesService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: {} },
        { provide: SessionsService, useValue: {} },
      ],
    }).compile();

    service = module.get<SlackService>(SlackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
