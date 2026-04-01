import { Logger } from '@nestjs/common';
import type { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { UcanService } from 'src/ucan/ucan.service';
import type { SandboxUploadConfig } from 'src/messages/file-processing.service';
import type { PageMemoryAuth } from '../editor/page-memory';
import {
  SecretsService,
  type SecretIndexEntry,
} from 'src/secrets/secrets.service';
import { createMCPClient } from '../../mcp';
import type { getConfig } from 'src/config';

export interface AuthContext {
  sandboxHeaders: Record<string, string>;
  sandboxMCP: MultiServerMCPClient | undefined;
  memoryHeaders: Record<string, string>;
  sandboxUploadConfig: SandboxUploadConfig | undefined;
  pageMemoryAuth: PageMemoryAuth | undefined;
  secretIndex: SecretIndexEntry[];
}

export async function buildAuthContext(params: {
  userMatrixOpenIdToken: string | undefined;
  oracleOpenIdToken: string | undefined;
  oracleMatrixBaseUrl: string;
  homeServerName: string | undefined;
  userDid: string | undefined;
  matrixRoomId: string | undefined;
  ucanService: UcanService | undefined;
  configService: ReturnType<typeof getConfig>;
}): Promise<AuthContext> {
  const {
    userMatrixOpenIdToken,
    oracleOpenIdToken,
    oracleMatrixBaseUrl,
    homeServerName,
    userDid,
    matrixRoomId,
    ucanService,
    configService,
  } = params;

  // Load secret index (cheap — one state query per message)
  const roomId = matrixRoomId;
  const secretIndex = roomId
    ? await SecretsService.getInstance().getSecretIndex(roomId)
    : [];

  // Build base headers for sandbox MCP (auth only — secrets added lazily)
  // Try UCAN invocation first, fall back to Matrix OpenID tokens
  const matrixFallbackHeaders: Record<string, string> = {
    Authorization: `Bearer ${userMatrixOpenIdToken}`,
    'x-matrix-homeserver': homeServerName ?? '',
    'X-oracle-openid-token': oracleOpenIdToken ?? '',
    'x-oracle-homeserver': oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
  };

  let sandboxHeaders: Record<string, string> = matrixFallbackHeaders;

  if (ucanService?.hasSigningKey() && userDid) {
    try {
      const invocation = await ucanService.createServiceInvocation(
        configService.getOrThrow('SANDBOX_MCP_URL'),
        userDid,
      );
      if (invocation) {
        sandboxHeaders = {
          Authorization: `Bearer ${invocation}`,
          'X-Auth-Type': 'ucan',
        };
        Logger.log('[UCAN] Using UCAN invocation for sandbox auth');
      }
    } catch (err) {
      Logger.warn(
        `[UCAN] Failed to create sandbox invocation, falling back to Matrix auth: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Create sandbox MCP with auth headers (for tool schema discovery)
  const hasSandboxAuth =
    (userMatrixOpenIdToken && oracleOpenIdToken) ||
    sandboxHeaders['X-Auth-Type'] === 'ucan';
  const sandboxMCP = hasSandboxAuth
    ? createMCPClient({
        mcpServers: {
          sandbox: {
            type: 'http',
            url: configService.getOrThrow('SANDBOX_MCP_URL'),
            transport: 'http',
            headers: sandboxHeaders,
          },
        },
        defaultToolTimeout: 180_000,
      })
    : undefined;

  // Build memory engine headers — UCAN first, Matrix fallback
  const memoryMatrixFallbackHeaders: Record<string, string> = {
    'x-oracle-token': oracleOpenIdToken ?? '',
    'x-user-token': userMatrixOpenIdToken ?? '',
    'x-oracle-matrix-homeserver': oracleMatrixBaseUrl.replace(
      /^https?:\/\//,
      '',
    ),
    'x-user-matrix-homeserver': homeServerName ?? '',
    'x-room-id': matrixRoomId ?? '',
    'User-Agent': 'LangChain-MCP-Client/1.0',
  };

  let memoryHeaders: Record<string, string> = memoryMatrixFallbackHeaders;

  if (ucanService?.hasSigningKey() && userDid) {
    try {
      const memoryInvocation = await ucanService.createServiceInvocation(
        configService.getOrThrow('MEMORY_MCP_URL'),
        userDid,
        'ixo:memory',
      );
      if (memoryInvocation) {
        memoryHeaders = {
          Authorization: `Bearer ${memoryInvocation}`,
          'X-Auth-Type': 'ucan',
          'x-room-id': matrixRoomId ?? '',
          'User-Agent': 'LangChain-MCP-Client/1.0',
        };
        Logger.log('[UCAN] Using UCAN invocation for memory engine auth');
      }
    } catch (err) {
      Logger.warn(
        `[Memory MCP UCAN] Failed to create invocation, falling back to Matrix auth: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (ucanService) {
    // ucanService exists but hasSigningKey is false or userDid is missing
    Logger.warn(
      `[Memory MCP UCAN] Skipped — hasSigningKey=${ucanService.hasSigningKey()}, userDid=${userDid ?? 'missing'}`,
    );
  }

  // Build sandbox upload config for file processing (HTTP upload, no MCP needed)
  // Upload still uses Matrix OpenID tokens (UCAN upload support TODO)
  const sandboxUploadConfig: SandboxUploadConfig | undefined =
    userMatrixOpenIdToken && oracleOpenIdToken
      ? {
          sandboxMcpUrl: configService.getOrThrow('SANDBOX_MCP_URL'),
          userToken: userMatrixOpenIdToken,
          oracleToken: oracleOpenIdToken,
          homeServerName: homeServerName ?? '',
          oracleHomeServerUrl: oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
        }
      : undefined;

  // Build memory auth for page/block operation tracking
  const pageMemoryAuth: PageMemoryAuth | undefined =
    oracleOpenIdToken && userMatrixOpenIdToken && matrixRoomId
      ? {
          oracleToken: oracleOpenIdToken,
          userToken: userMatrixOpenIdToken,
          oracleHomeServer: oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
          userHomeServer: homeServerName ?? '',
          chatRoomId: matrixRoomId,
        }
      : undefined;

  Logger.log(
    `[buildAuthContext] PageMemory auth ${pageMemoryAuth ? 'available' : 'unavailable (missing tokens or roomId)'}`,
  );

  return {
    sandboxHeaders,
    sandboxMCP,
    memoryHeaders,
    sandboxUploadConfig,
    pageMemoryAuth,
    secretIndex,
  };
}
