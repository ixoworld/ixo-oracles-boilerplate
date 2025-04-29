import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { BatchKnowledgeDto } from './dto/batch-knowledge.dto';
import {
  CreateKnowledgeDto,
  KnowledgeStatusEnum,
} from './dto/create-knowledge.dto';
import { SemanticSearchDto } from './dto/semantic-search.dto';
import { UpdateKnowledgeDto } from './dto/update-knowledge.dto';
import { type IKnowledge } from './entities/knowledge.entity';
import { KnowledgeBatchService } from './knowledge-batch.service';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeBatchService: KnowledgeBatchService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new knowledge entry' })
  @ApiBody({ type: CreateKnowledgeDto })
  @ApiCreatedResponse({
    description: 'The knowledge entry has been successfully created.',
  })
  async create(@Body() createKnowledgeDto: CreateKnowledgeDto) {
    return this.knowledgeService.createKnowledge(createKnowledgeDto);
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new knowledge entry' })
  @ApiBody({ type: BatchKnowledgeDto })
  async createBatch(@Body() batchKnowledgeDto: BatchKnowledgeDto) {
    return this.knowledgeBatchService.createBatch(batchKnowledgeDto);
  }
  @Get()
  @ApiOperation({ summary: 'Get all knowledge entries' })
  @ApiOkResponse({ description: 'Knowledge entries retrieved successfully.' })
  @ApiQuery({
    name: 'status',
    enum: KnowledgeStatusEnum,
    description: 'Status to filter by',
  })
  @ApiQuery({
    name: 'page',
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    description: 'Number of items per page',
  })
  async findAll(
    @Query('status') status?: KnowledgeStatusEnum,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<{
    records: IKnowledge[];
    pagination: {
      total: number;
      page: number;
      limit: number;
    };
  }> {
    return this.knowledgeService.listKnowledge(status, page, limit);
  }

  @Get('status/:status')
  @ApiOperation({ summary: 'Get knowledge entries by status' })
  @ApiParam({
    name: 'status',
    enum: KnowledgeStatusEnum,
    description: 'Status to filter by',
  })
  @ApiOkResponse({ description: 'Knowledge entries retrieved successfully.' })
  async findByStatus(@Param('status') status: KnowledgeStatusEnum) {
    return this.knowledgeService.getKnowledgeByStatus(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a knowledge entry by ID' })
  @ApiParam({ name: 'id', description: 'Knowledge entry ID' })
  @ApiOkResponse({ description: 'Knowledge entry retrieved successfully.' })
  async findOne(@Param('id') id: string) {
    return this.knowledgeService.getKnowledge(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a knowledge entry' })
  @ApiParam({ name: 'id', description: 'Knowledge entry ID' })
  @ApiBody({ type: UpdateKnowledgeDto })
  @ApiOkResponse({ description: 'Knowledge entry updated successfully.' })
  async update(
    @Param('id') id: string,
    @Body() updateKnowledgeDto: UpdateKnowledgeDto,
  ) {
    return this.knowledgeService.updateKnowledge(id, updateKnowledgeDto);
  }

  @Patch(':id/status/:status')
  @ApiOperation({ summary: 'Update knowledge entry status' })
  @ApiParam({ name: 'id', description: 'Knowledge entry ID' })
  @ApiParam({
    name: 'status',
    enum: KnowledgeStatusEnum,
    description: 'New status',
  })
  @ApiOkResponse({ description: 'Status updated successfully.' })
  async updateStatus(
    @Param('id') id: string,
    @Param('status') status: KnowledgeStatusEnum,
  ) {
    return this.knowledgeService.updateKnowledgeStatus(id, status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a knowledge entry' })
  @ApiParam({ name: 'id', description: 'Knowledge entry ID' })
  @ApiOkResponse({ description: 'Knowledge entry deleted successfully.' })
  async remove(@Param('id') id: string) {
    return this.knowledgeService.deleteKnowledge(id);
  }

  @Post('search')
  @ApiOperation({ summary: 'Search for knowledge entries' })
  @ApiBody({ type: SemanticSearchDto })
  @ApiOkResponse({ description: 'Knowledge entries retrieved successfully.' })
  async search(@Body() searchKnowledgeDto: SemanticSearchDto) {
    return this.knowledgeService.semanticSearch(searchKnowledgeDto);
  }
}
