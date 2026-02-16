import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { SessionHistoryProcessor } from '../sessions/session-history-processor.service';
import { WsService } from './ws.service';

describe('WsService', () => {
  let service: WsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsService,
        { provide: SessionHistoryProcessor, useValue: {} },
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
    }).compile();

    service = module.get<WsService>(WsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
