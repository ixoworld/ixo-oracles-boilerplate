import { Module } from '@nestjs/common';
import { MatrixManagerRegistryService } from './matrix-manager-registry-service.service';

@Module({
  imports: [],
  providers: [MatrixManagerRegistryService],
  exports: [MatrixManagerRegistryService],
})
export class MatrixRegistryModule {}
