import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateKnowledgeDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsBoolean()
  @IsOptional()
  approved?: boolean;

  @IsBoolean()
  @IsOptional()
  public?: boolean;
}
