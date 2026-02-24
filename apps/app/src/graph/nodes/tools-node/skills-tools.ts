/* eslint-disable no-console */
import { tool } from '@langchain/core/tools';
import z from 'zod';

const SKILLS_CAPSULES_BASE_URL = 'https://capsules.skills.ixo.earth';

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

interface NormalizedCapsule {
  title: string;
  cid: string;
  description: string;
  path: string;
  createdAt?: string;
}

function normalizeCapsule(capsule: Capsule): NormalizedCapsule {
  return {
    title: capsule.name,
    cid: capsule.cid,
    createdAt: capsule.createdAt
      ? new Date(capsule.createdAt).toISOString()
      : undefined,
    description: capsule.description ?? '',
    path: `/workspace/skills/${capsule.name}`,
  };
}

/**
 * List available skills (capsules) from the IXO skills registry with pagination.
 */
const listSkills = async (params: { limit?: number; offset?: number }) => {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const url = new URL('/capsules', SKILLS_CAPSULES_BASE_URL);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('offset', offset.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`List skills failed: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    capsules: Capsule[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };

  const output = {
    skills: data.capsules.map(normalizeCapsule),
    pagination: data.pagination,
  };

  console.log('listSkills output', output);
  return output;
};

/**
 * Search the IXO skills registry by query.
 */
const searchSkills = async (params: { q: string; limit?: number }) => {
  const limit = params.limit ?? 10;

  const url = new URL('/capsules/search', SKILLS_CAPSULES_BASE_URL);
  url.searchParams.set('q', params.q);
  url.searchParams.set('limit', limit.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Search skills failed: ${response.statusText}`);
  }

  const skillsMap = new Map<string, NormalizedCapsule>();

  const data = (await response.json()) as {
    query: string;
    count: number;
    capsules: Capsule[];
  };

  for (const capsule of data.capsules) {
    const existing = skillsMap.get(capsule.name);
    const isNewer = capsule.createdAt
      ? new Date(capsule.createdAt).getTime() >
        (existing?.createdAt ? new Date(existing.createdAt).getTime() : 0)
      : false;

    if (isNewer) {
      skillsMap.set(capsule.name, normalizeCapsule(capsule));
    }
  }

  const output = {
    query: data.query,
    count: data.count,
    skills: Array.from(skillsMap.values()),
  };

  console.log('searchSkills output', output);
  return output;
};

export const listSkillsTool = tool(listSkills, {
  name: 'list_skills',
  description: `List available skills (capsules) from the IXO skills registry. Use this to discover what skills exist before delegating to the Skills Agent.
  
  Return the output in the following format:
  - skills: list of skills
    - title: skill name
    - cid: skill cid
    - description: skill description
    - path: skill path
  - pagination: pagination information
    - total: total number of skills
    - limit: limit number of skills
    - offset: offset number of skills
    - hasMore: boolean indicating if there are more skills
  `,
  schema: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe('Optional: Number of skills to return (1-100, default: 20)'),
    offset: z
      .number()
      .min(0)
      .optional()
      .describe(
        'Optional: Number of skills to skip for pagination (default: 0)',
      ),
  }),
});

export const searchSkillsTool = tool(searchSkills, {
  name: 'search_skills',
  description: `Search the IXO skills registry by query. Use this to find skills relevant to the user's task before delegating to the Skills Agent

  Return the output in the following format:
  - query: search query
  - count: total number of skills found
  - skills: list of skills
    - title: skill name
    - cid: skill cid
    - description: skill description
    - path: skill path
  `,
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
      .describe('Optional: Max results to return (1-50, default: 10)'),
  }),
});
