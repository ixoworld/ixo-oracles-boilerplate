import { Module } from '@nestjs/common';
import { UserPreferencesController } from './user-preferences.controller';

@Module({
  controllers: [UserPreferencesController],
})
export class UserPreferencesModule {}
