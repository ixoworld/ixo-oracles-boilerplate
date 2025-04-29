import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
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
  items: CreateKnowledgeDto[];
}
