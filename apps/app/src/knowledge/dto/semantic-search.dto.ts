import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SemanticSearchDto {
  @ApiProperty({
    description: 'The query string to search for in the knowledge base',
    example: 'How does climate change affect biodiversity?',
  })
  @IsString()
  @IsNotEmpty()
  query: string;
}
