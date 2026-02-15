import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { CallsService } from './calls.service';

describe('CallsService', () => {
  let service: CallsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: 'MATRIX_MANAGER', useValue: {} },
        { provide: UserMatrixSqliteSyncService, useValue: {} },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
