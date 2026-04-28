/* eslint-disable no-console */
import { tool } from '@langchain/core/tools';
import { getConfig } from 'src/config';
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
  // Set by ai-skills when the response row is private (i.e. owned by the
  // caller). Absent for public rows.
  visibility?: 'public' | 'private';
  ownerDid?: string | null;
  oracleDid?: string | null;
};

interface MergedSkill {
  title: string;
  description: string;
  path: string;
  /** `public` — registry skill visible to everyone; `private` — owned by the current (oracle, user) pair. */
  source: 'public' | 'private';
  cid?: string;
  createdAt?: string;
}

function normalizeRegistryCapsule(capsule: Capsule): MergedSkill {
  return {
    title: capsule.name,
    description: capsule.description ?? '',
    path: `/workspace/skills/${capsule.name}`,
    source: capsule.visibility === 'private' ? 'private' : 'public',
    cid: capsule.cid,
    createdAt: capsule.createdAt
      ? new Date(capsule.createdAt).toISOString()
      : undefined,
  };
}

interface SkillsToolDeps {
  /**
   * Raw `ixo:skills` UCAN invocation token. When present, listing/search calls
   * to ai-skills forward it as `Authorization: Bearer` + `X-Auth-Type: ucan`,
   * which makes the user's own published private skills surface in the
   * results alongside public registry skills. When omitted, only public skills
   * are returned.
   */
  skillsUcan?: string;
}

export function createListSkillsTool(deps: SkillsToolDeps) {
  return tool(
    async (params: { limit?: number; offset?: number }) => {
      const limit = params.limit ?? 20;
      const offset = params.offset ?? 0;

      const registryResult = await fetchRegistryCapsules(
        limit,
        offset,
        deps.skillsUcan,
      );

      const registry = registryResult.capsules.map(normalizeRegistryCapsule);
      const privateRegistry = registry.filter((s) => s.source === 'private');
      const publicRegistry = registry.filter((s) => s.source === 'public');
      const skills: MergedSkill[] = [...privateRegistry, ...publicRegistry];

      const output = {
        skills,
        pagination: registryResult.pagination,
        privateSkillCount: privateRegistry.length,
      };
      console.log('listSkills output', {
        privateSkills: privateRegistry.length,
        publicSkills: publicRegistry.length,
      });
      return output;
    },
    {
      name: 'list_skills',
      description: `List available skills from the IXO skills registry — the caller's **published** private skills first, then public registry skills.

Each entry includes:
- title: skill name
- description: skill description
- path: absolute sandbox path to the skill folder
- source: "private" (your published skill) or "public" (registry)
- cid: required by load_skill, exec, read_skill. Never use a CID as a file path.`,
      schema: z.object({
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe(
            'Optional: number of skills to return (1-100, default: 20).',
          ),
        offset: z
          .number()
          .min(0)
          .optional()
          .describe('Optional: pagination offset (default: 0).'),
      }),
    },
  );
}

export function createSearchSkillsTool(deps: SkillsToolDeps) {
  return tool(
    async (params: { q: string; limit?: number }) => {
      const limit = params.limit ?? 10;

      const registryCapsules = await searchRegistryCapsules(
        params.q,
        limit,
        deps.skillsUcan,
      );

      const registry = registryCapsules.map(normalizeRegistryCapsule);
      const privateRegistry = registry.filter((s) => s.source === 'private');
      const publicRegistry = registry.filter((s) => s.source === 'public');

      const skills: MergedSkill[] = [...privateRegistry, ...publicRegistry];

      const output = {
        query: params.q,
        count: skills.length,
        privateSkillCount: privateRegistry.length,
        skills,
      };
      console.log('searchSkills output', {
        query: params.q,
        privateMatches: privateRegistry.length,
        publicMatches: publicRegistry.length,
      });
      return output;
    },
    {
      name: 'search_skills',
      description: `Search the caller's published skills and the public IXO registry by query.

Matching published (private) skills come first, then public registry results. Each entry includes title, description, path, source ("private" | "public"), and cid.`,
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
          .describe('Optional: max results to return (1-50, default: 10).'),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Registry calls (ai-skills)
// ---------------------------------------------------------------------------

/**
 * Build the auth/network header set for outbound ai-skills requests. When a
 * UCAN invocation is available, ai-skills returns the caller's private skills
 * alongside the public ones; without it, only public rows come back.
 *
 * `X-IXO-Network` is a routing hint for ai-skills' did:ixo resolver, not a
 * capsule-storage axis. Defaults to mainnet — override via the optional
 * `SKILLS_REGISTRY_NETWORK` env var if needed.
 */
function buildRegistryHeaders(skillsUcan: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    'X-IXO-Network': configService.get('NETWORK') ?? 'mainnet',
  };
  if (skillsUcan) {
    headers['Authorization'] = `Bearer ${skillsUcan}`;
    headers['X-Auth-Type'] = 'ucan';
  }
  return headers;
}

async function fetchRegistryCapsules(
  limit: number,
  offset: number,
  skillsUcan: string | undefined,
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

  const response = await fetch(url.toString(), {
    headers: buildRegistryHeaders(skillsUcan),
  });
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

async function searchRegistryCapsules(
  q: string,
  limit: number,
  skillsUcan: string | undefined,
): Promise<Capsule[]> {
  const url = new URL('/capsules/search', SKILLS_CAPSULES_BASE_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', limit.toString());

  const response = await fetch(url.toString(), {
    headers: buildRegistryHeaders(skillsUcan),
  });
  if (!response.ok) {
    throw new Error(`Search skills failed: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    query: string;
    count: number;
    capsules: Capsule[];
  };

  // Dedup by name. When a private (caller-owned) and a public row share a
  // name, prefer the private one — the user's own skill always wins. Among
  // entries of the same source, keep the newest by createdAt.
  const skillsMap = new Map<string, Capsule>();
  for (const capsule of data.capsules) {
    const existing = skillsMap.get(capsule.name);
    if (!existing) {
      skillsMap.set(capsule.name, capsule);
      continue;
    }
    const incomingPrivate = capsule.visibility === 'private';
    const existingPrivate = existing.visibility === 'private';
    if (incomingPrivate && !existingPrivate) {
      skillsMap.set(capsule.name, capsule);
      continue;
    }
    if (!incomingPrivate && existingPrivate) {
      continue;
    }
    // Same visibility tier — keep the newer one.
    const isNewer =
      capsule.createdAt && existing.createdAt
        ? new Date(capsule.createdAt).getTime() >
          new Date(existing.createdAt).getTime()
        : false;
    if (isNewer) skillsMap.set(capsule.name, capsule);
  }
  return Array.from(skillsMap.values());
}
