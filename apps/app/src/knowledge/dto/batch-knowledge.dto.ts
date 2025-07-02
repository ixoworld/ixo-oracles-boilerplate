import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { CreateKnowledgeDto } from './create-knowledge.dto';

export class BatchKnowledgeDto {
  @ApiProperty({
    description: 'Array of knowledge items to be processed in batch',
    type: [CreateKnowledgeDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateKnowledgeDto)
  @IsObject({
    each: true,
    message: 'Each item must be an object, type: CreateKnowledgeDto',
  })
  items: CreateKnowledgeDto[];
}
