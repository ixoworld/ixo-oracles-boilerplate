import { SessionManagerService } from '@ixo/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { SessionHistoryProcessor } from './session-history-processor.service';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  let service: SessionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: SessionManagerService, useValue: {} },
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: SessionHistoryProcessor, useValue: {} },
        { provide: UserMatrixSqliteSyncService, useValue: {} },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
