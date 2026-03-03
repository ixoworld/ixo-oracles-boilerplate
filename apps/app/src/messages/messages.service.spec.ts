import { SessionManagerService } from '@ixo/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { MainAgentGraph } from 'src/graph';
import { UcanService } from 'src/ucan/ucan.service';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { FileProcessingService } from './file-processing.service';
import { MessagesService } from './messages.service';

describe('MessagesService', () => {
  let service: MessagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: MainAgentGraph, useValue: {} },
        { provide: SessionManagerService, useValue: { matrixManger: {} } },
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: UserMatrixSqliteSyncService, useValue: {} },
        { provide: FileProcessingService, useValue: {} },
        { provide: UcanService, useValue: {} },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
