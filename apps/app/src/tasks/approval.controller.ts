/**
 * ApprovalController — HTTP endpoint for task approval decisions.
 *
 * Used by the Portal FE when the user clicks "Approve" or "Reject"
 * on the approval UI component. Bypasses text-based classification
 * since the decision is explicit.
 *
 * @see spec §14 — Approval Gates
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';
import type { Request } from 'express';

import { getMatrixHomeServerCroppedForDid } from '@ixo/oracles-chain-client';
import { SessionManagerService } from '@ixo/common';
import { ConfigService } from '@nestjs/config';
import type { ENV } from 'src/types';
import { ApprovalService } from './approval.service';

class ApprovalDecisionDto {
  @IsNotEmpty()
  @IsBoolean()
  approved: boolean;
}

@ApiTags('tasks')
@Controller('tasks')
export class ApprovalController {
  constructor(
    private readonly approvalService: ApprovalService,
    private readonly sessionManagerService: SessionManagerService,
    private readonly config: ConfigService<ENV>,
  ) {}

  @Post(':taskId/approval')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit approval decision for a task result',
    description:
      'Used by the Portal UI when the user clicks Approve or Reject on a pending task result.',
  })
  @ApiParam({
    name: 'taskId',
    required: true,
    description: 'The task ID, e.g. "task_abc123"',
  })
  @ApiResponse({
    status: 200,
    description: 'Approval decision processed.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request or no pending approval.',
  })
  async submitApproval(
    @Req() req: Request,
    @Param('taskId') taskId: string,
    @Body() body: ApprovalDecisionDto,
  ) {
    const { did } = req.authData;

    // Resolve the user's main room
    const userHomeServer = await getMatrixHomeServerCroppedForDid(did);
    const { roomId: mainRoomId } =
      await this.sessionManagerService.matrixManger.getOracleRoomIdWithHomeServer(
        {
          userDid: did,
          oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
          userHomeServer,
        },
      );

    if (!mainRoomId) {
      return {
        success: false,
        error: 'Could not resolve user room',
      };
    }

    await this.approvalService.handleApprovalResponse({
      taskId,
      approved: body.approved,
      mainRoomId,
    });

    return {
      success: true,
      taskId,
      decision: body.approved ? 'approved' : 'rejected',
    };
  }
}
