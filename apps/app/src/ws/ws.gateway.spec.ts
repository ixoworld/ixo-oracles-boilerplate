import { Test, type TestingModule } from '@nestjs/testing';
import { WsGateway } from './ws.gateway';
import { WsService } from './ws.service';

describe('WsGateway', () => {
  let gateway: WsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WsGateway, { provide: WsService, useValue: {} }],
    }).compile();

    gateway = module.get<WsGateway>(WsGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
