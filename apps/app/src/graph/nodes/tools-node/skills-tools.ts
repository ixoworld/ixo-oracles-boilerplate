/* eslint-disable no-console */
import { tool, type StructuredTool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { getConfig } from 'src/config';
import {
  UserSkillsService,
  type UserSkillEntry,
} from 'src/user-skills/user-skills.service';
import z from 'zod';

const configService = getConfig();
const SKILLS_CAPSULES_BASE_URL = configService.getOrThrow(
  'SKILLS_CAPSULES_BASE_URL',
);

type Capsule = {
  cid: string;
  name: string;
  description: string;
  license?: string | null;
  compatibility?: string | null;
  allowedTools?: string | null;
  metadata?: Record<string, string> | null;
  archiveSize?: number;
  createdAt?: string;
};

interface MergedSkill {
  title: string;
  description: string;
  path: string;
  source: 'user' | 'public';
  /** Only present for public skills. User skills don't have a CID. */
  cid?: string;
  createdAt?: string;
}

function normalizePublicCapsule(capsule: Capsule): MergedSkill {
  return {
    title: capsule.name,
    description: capsule.description ?? '',
    path: `/workspace/skills/${capsule.name}`,
    source: 'public',
    cid: capsule.cid,
    createdAt: capsule.createdAt
      ? new Date(capsule.createdAt).toISOString()
      : undefined,
  };
}

function normalizeUserSkill(entry: UserSkillEntry): MergedSkill {
  return {
    title: entry.slug,
    description: entry.description,
    path: entry.path,
    source: 'user',
  };
}

interface SkillsToolDeps {
  /** The wrapped sandbox_run tool. Without it, only public skills are returned. */
  sandboxRunTool?: StructuredTool;
  /** The user's DID. Used as the cache key for the per-user skill listing. */
  userDid?: string;
}

/**
 * Fetch the user's custom skills from the sandbox. Returns an empty list if
 * the dependencies aren't available or the sandbox call fails — never throws.
 */
async function getUserSkills(
  deps: SkillsToolDeps,
  refresh: boolean,
): Promise<MergedSkill[]> {
  if (!deps.sandboxRunTool || !deps.userDid) return [];
  try {
    const entries = await UserSkillsService.getInstance().list({
      userDid: deps.userDid,
      sandboxRunTool: deps.sandboxRunTool,
      refresh,
    });
    return entries.map(normalizeUserSkill);
  } catch (error) {
    Logger.warn(
      `[skills-tools] user-skills listing failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

export function createListSkillsTool(deps: SkillsToolDeps) {
  return tool(
    async (params: { limit?: number; offset?: number; refresh?: boolean }) => {
      const limit = params.limit ?? 20;
      const offset = params.offset ?? 0;
      const refresh = params.refresh ?? false;

      // Public skills + user skills in parallel.
      const [publicResult, userSkills] = await Promise.all([
        fetchPublicCapsules(limit, offset),
        getUserSkills(deps, refresh),
      ]);

      // User skills always come first — the prompt promises "highest priority".
      const skills: MergedSkill[] = [
        ...userSkills,
        ...publicResult.capsules.map(normalizePublicCapsule),
      ];

      const output = {
        skills,
        pagination: publicResult.pagination,
        userSkillCount: userSkills.length,
      };
      console.log('listSkills output', {
        userSkills: userSkills.length,
        publicSkills: publicResult.capsules.length,
        refresh,
      });
      return output;
    },
    {
      name: 'list_skills',
      description: `List available skills — both **user** (custom, in /workspace/data/user-skills/) and **public** (from the IXO skills registry).

User skills are returned first and have priority. Use this to discover what skills exist before delegating to the Skills Agent.

Each entry includes:
- title: skill name (or slug for user skills)
- description: skill description
- path: absolute sandbox path to the skill folder
- source: "user" or "public"
- cid: only set for public skills — required by load_skill, exec, read_skill. Never use a CID as a file path.

User skills are pre-loaded — DO NOT call load_skill for them. Read them directly with read_skill using the path field.

After creating, updating, or deleting a user skill (via sandbox_write or sandbox_run rm under user-skills/), call this tool again with refresh: true so the new state is reflected.`,
      schema: z.object({
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe(
            'Optional: number of public skills to return (1-100, default: 20). Does not limit user skills.',
          ),
        offset: z
          .number()
          .min(0)
          .optional()
          .describe(
            'Optional: pagination offset for public skills (default: 0).',
          ),
        refresh: z
          .boolean()
          .optional()
          .describe(
            'Optional: bypass the per-user cache for the user-skills listing. Set to true immediately after creating, updating, or deleting a user skill.',
          ),
      }),
    },
  );
}

export function createSearchSkillsTool(deps: SkillsToolDeps) {
  return tool(
    async (params: { q: string; limit?: number; refresh?: boolean }) => {
      const limit = params.limit ?? 10;
      const refresh = params.refresh ?? false;
      const queryLower = params.q.toLowerCase();

      const [publicCapsules, userSkills] = await Promise.all([
        searchPublicCapsules(params.q, limit),
        getUserSkills(deps, refresh),
      ]);

      const userMatches = userSkills.filter(
        (s) =>
          s.title.toLowerCase().includes(queryLower) ||
          s.description.toLowerCase().includes(queryLower),
      );

      const skills: MergedSkill[] = [
        ...userMatches,
        ...publicCapsules.map(normalizePublicCapsule),
      ];

      const output = {
        query: params.q,
        count: skills.length,
        userSkillCount: userMatches.length,
        skills,
      };
      console.log('searchSkills output', {
        query: params.q,
        userMatches: userMatches.length,
        publicMatches: publicCapsules.length,
      });
      return output;
    },
    {
      name: 'search_skills',
      description: `Search both **user** and **public** skills by query. Use this to find skills relevant to the user's task before delegating to the Skills Agent.

User-skill matches come first. Each entry includes title, description, path, source ("user" | "public"), and cid (public skills only).

After creating, updating, or deleting a user skill, call again with refresh: true.`,
      schema: z.object({
        q: z
          .string()
          .min(1, 'Search query is required')
          .describe(
            'Search query (e.g. "pptx", "invoice", "presentation", "docx"). Required.',
          ),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe(
            'Optional: max public-skill results to return (1-50, default: 10). User skills are always fully searched.',
          ),
        refresh: z
          .boolean()
          .optional()
          .describe(
            'Optional: bypass the per-user cache for user-skills. Set to true immediately after creating, updating, or deleting a user skill.',
          ),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Public registry calls
// ---------------------------------------------------------------------------

async function fetchPublicCapsules(
  limit: number,
  offset: number,
): Promise<{
  capsules: Capsule[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}> {
  const url = new URL('/capsules', SKILLS_CAPSULES_BASE_URL);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('offset', offset.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`List skills failed: ${response.statusText}`);
  }
  return (await response.json()) as {
    capsules: Capsule[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };
}

async function searchPublicCapsules(
  q: string,
  limit: number,
): Promise<Capsule[]> {
  const url = new URL('/capsules/search', SKILLS_CAPSULES_BASE_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', limit.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Search skills failed: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    query: string;
    count: number;
    capsules: Capsule[];
  };

  // Same dedup-by-name-keep-newest logic the original tool used.
  const skillsMap = new Map<string, Capsule>();
  for (const capsule of data.capsules) {
    const existing = skillsMap.get(capsule.name);
    const isNewer =
      capsule.createdAt && existing?.createdAt
        ? new Date(capsule.createdAt).getTime() >
          new Date(existing.createdAt).getTime()
        : !existing;
    if (isNewer) skillsMap.set(capsule.name, capsule);
  }
  return Array.from(skillsMap.values());
}
