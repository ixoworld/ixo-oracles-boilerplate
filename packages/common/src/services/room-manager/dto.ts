import { IsNotEmpty, IsString } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  did: string;

  @IsString()
  @IsNotEmpty()
  oracleName: string;

  @IsString()
  userAccessToken: string;
}

export class GetRoomDto {
  @IsString()
  @IsNotEmpty()
  did: string;

  @IsString()
  @IsNotEmpty()
  oracleName: string;
}
