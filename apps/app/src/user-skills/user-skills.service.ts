import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type { StructuredTool } from '@langchain/core/tools';

export interface UserSkillEntry {
  /** Folder slug under /workspace/data/user-skills/. */
  slug: string;
  /** First non-empty content of SKILL.md (heading + first paragraph). */
  description: string;
  /** Absolute sandbox path. */
  path: string;
}

interface SandboxRunResult {
  output: string;
  success: boolean;
  error?: string;
  exitCode?: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Discovers and caches the per-user list of custom skills that live under
 * /workspace/data/user-skills/ in the user's sandbox.
 *
 * Manual singleton (mirrors SecretsService) because it is reached from
 * LangGraph agent code that runs outside the NestJS DI container.
 */
export class UserSkillsService {
  private static instance: UserSkillsService;

  private cacheManager: Cache | null = null;

  private constructor() {}

  static getInstance(): UserSkillsService {
    if (!UserSkillsService.instance) {
      UserSkillsService.instance = new UserSkillsService();
    }
    return UserSkillsService.instance;
  }

  setCacheManager(cache: Cache): void {
    this.cacheManager = cache;
  }

  private cacheKey(userDid: string): string {
    return `user-skills:list:${userDid}`;
  }

  /**
   * Return the user's custom skills.
   *
   * Cached per-DID for 5 minutes. Pass `refresh: true` to bypass the cache —
   * the agent is told to do this immediately after writing or deleting a
   * skill file so the next listing reflects the change.
   */
  async list(opts: {
    userDid: string;
    sandboxRunTool: StructuredTool;
    refresh?: boolean;
  }): Promise<UserSkillEntry[]> {
    const { userDid, sandboxRunTool, refresh } = opts;

    if (!refresh && this.cacheManager) {
      const cached = await this.cacheManager.get<UserSkillEntry[]>(
        this.cacheKey(userDid),
      );
      if (cached) return cached;
    }

    const fresh = await this.fetchFromSandbox(sandboxRunTool);

    if (this.cacheManager) {
      await this.cacheManager.set(this.cacheKey(userDid), fresh, FIVE_MINUTES);
    }

    return fresh;
  }

  /** Bust the cached listing for a user. Useful after a server-side write. */
  async invalidate(userDid: string): Promise<void> {
    await this.cacheManager?.del(this.cacheKey(userDid));
  }

  private async fetchFromSandbox(
    sandboxRunTool: StructuredTool,
  ): Promise<UserSkillEntry[]> {
    // One round-trip:
    //   1. mkdir -p the user-skills folder so the listing is idempotent
    //      on first use. `mkdir -p` is a no-op when the directory already
    //      exists — it does NOT delete, replace, or modify an existing
    //      directory or its contents. Safe to call on every invocation.
    //   2. List subdirectories that contain a SKILL.md.
    //   3. Print up to 20 lines of each SKILL.md so we can derive a
    //      description.
    // The cwd is /workspace/data, but we use absolute paths for clarity.
    const code = [
      'set -e',
      'DIR=/workspace/data/user-skills',
      'mkdir -p "$DIR"', // idempotent: no-op if $DIR already exists
      'shopt -s nullglob 2>/dev/null || true',
      'for d in "$DIR"/*/; do',
      '  [ -f "$d/SKILL.md" ] || continue',
      '  slug=$(basename "$d")',
      '  echo "::USER_SKILL::$slug"',
      '  head -n 20 "$d/SKILL.md"',
      '  echo "::END_USER_SKILL::"',
      'done',
    ].join('\n');

    let raw: unknown;
    try {
      raw = await sandboxRunTool.invoke({ code });
    } catch (error) {
      Logger.warn(
        `[UserSkillsService] sandbox_run failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }

    const parsed = parseSandboxResult(raw);
    if (!parsed.success || (parsed.exitCode != null && parsed.exitCode !== 0)) {
      Logger.warn(
        `[UserSkillsService] listing failed (exit ${parsed.exitCode ?? '?'}): ${
          parsed.error ?? 'unknown'
        }`,
      );
      return [];
    }

    return parseSkillBlocks(parsed.output);
  }
}

/**
 * Mirror of the parser in apply-sandbox-output-to-block.ts. Kept local rather
 * than imported to avoid cross-module coupling between two unrelated tools.
 */
function parseSandboxResult(raw: unknown): SandboxRunResult {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SandboxRunResult;
    } catch {
      return { output: raw, success: true };
    }
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'content' in raw &&
    Array.isArray((raw as Record<string, unknown>).content)
  ) {
    const blocks = (raw as { content: Array<{ type: string; text: string }> })
      .content;
    const textBlock = blocks.find((b) => b.type === 'text');
    if (textBlock) {
      try {
        return JSON.parse(textBlock.text) as SandboxRunResult;
      } catch {
        return { output: textBlock.text, success: true };
      }
    }
  }
  return raw as SandboxRunResult;
}

function parseSkillBlocks(output: string): UserSkillEntry[] {
  const entries: UserSkillEntry[] = [];
  const lines = output.split('\n');
  let currentSlug: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentSlug) {
      entries.push({
        slug: currentSlug,
        description: deriveDescription(buffer),
        path: `/workspace/data/user-skills/${currentSlug}`,
      });
    }
    currentSlug = null;
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('::USER_SKILL::')) {
      flush();
      currentSlug = line.slice('::USER_SKILL::'.length).trim();
    } else if (line.startsWith('::END_USER_SKILL::')) {
      flush();
    } else if (currentSlug) {
      buffer.push(line);
    }
  }
  flush();

  return entries;
}

/**
 * Pull the first informative line from a SKILL.md head: prefer a non-heading
 * sentence, fall back to the H1.
 */
function deriveDescription(lines: string[]): string {
  let title = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (!title) title = line.replace(/^#+\s*/, '');
      continue;
    }
    return line.length > 240 ? `${line.slice(0, 240)}…` : line;
  }
  return title;
}
