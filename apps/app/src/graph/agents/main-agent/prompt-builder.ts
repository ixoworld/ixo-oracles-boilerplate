import {
  AI_ASSISTANT_PROMPT,
  SLACK_FORMATTING_CONSTRAINTS_CONTENT,
} from '../../nodes/chat-node/prompt';
import type { TMainAgentGraphState } from '../../state';
import type { SecretIndexEntry } from 'src/secrets/secrets.service';
import type { OracleConfig } from './oracle-config';

export function buildOracleContext(oc: OracleConfig): string {
  const lines: string[] = [];
  if (oc.oracleName) lines.push(`**Name:** ${oc.oracleName}`);
  if (oc.orgName) lines.push(`**Organization:** ${oc.orgName}`);
  if (oc.description) lines.push(`**Purpose:** ${oc.description}`);
  if (oc.location) lines.push(`**Location:** ${oc.location}`);
  return lines.join('\n');
}

/**
 * Convert a memory engine SearchEnhancedResponse into clean markdown.
 * Extracts only the meaningful content (facts + entity names) and drops
 * internal metadata (strategy_used, query, UUIDs, total_results).
 *
 * Accepts unknown to avoid coupling to the SearchEnhancedResponse type
 * while safely extracting the fields that exist at runtime.
 */
export function formatUserContext(data: unknown): string {
  if (!data || typeof data !== 'object') return '_No information available._';

  const obj = data as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return '_No information available._';

  const lines: string[] = [];

  // Extract facts — array of { fact: string, ... }
  const facts = Array.isArray(obj.facts) ? obj.facts : [];
  for (const f of facts) {
    const fact =
      typeof f === 'object' && f !== null && 'fact' in f
        ? String(f.fact)
        : null;
    if (fact) lines.push(`- ${fact}`);
  }

  // Extract entity names — array of { name: string, ... }
  const entities = Array.isArray(obj.entities) ? obj.entities : [];
  const names = entities
    .map((e) =>
      typeof e === 'object' && e !== null && 'name' in e
        ? String(e.name)
        : null,
    )
    .filter(Boolean);
  if (names.length > 0) lines.push(`- **Related:** ${names.join(', ')}`);

  return lines.length > 0 ? lines.join('\n') : '_No information available._';
}

// Helper function to format time context
export const formatTimeContext = (
  timezone: string | undefined,
  currentTime: string | undefined,
): string => {
  if (!timezone && !currentTime) {
    return 'Not available.';
  }

  let context = '';

  if (currentTime) {
    context += `Current local time: ${currentTime}`;
  }

  if (timezone) {
    if (context) {
      context += `\nTimezone: ${timezone}`;
    } else {
      context += `Timezone: ${timezone}`;
    }
  }

  return context || 'Not available.';
};

export async function buildSystemPrompt(params: {
  oracleConfig: OracleConfig;
  state: Partial<TMainAgentGraphState>;
  operationalMode: string;
  editorSection: string;
  timeContext: string;
  secretIndex: SecretIndexEntry[];
  oracleName: string;
}): Promise<string> {
  return AI_ASSISTANT_PROMPT.format({
    APP_NAME: params.oracleName,
    ORACLE_CONTEXT: buildOracleContext(params.oracleConfig),
    IDENTITY_CONTEXT: formatUserContext(params.state?.userContext?.identity),
    WORK_CONTEXT: formatUserContext(params.state?.userContext?.work),
    GOALS_CONTEXT: formatUserContext(params.state?.userContext?.goals),
    INTERESTS_CONTEXT: formatUserContext(params.state?.userContext?.interests),
    RELATIONSHIPS_CONTEXT: formatUserContext(
      params.state?.userContext?.relationships,
    ),
    RECENT_CONTEXT: formatUserContext(params.state?.userContext?.recent),
    TIME_CONTEXT: params.timeContext,
    CURRENT_ENTITY_DID: params.state.currentEntityDid ?? '',
    OPERATIONAL_MODE: params.operationalMode,
    EDITOR_SECTION: params.editorSection,
    SLACK_FORMATTING_CONSTRAINTS:
      params.state.client === 'slack'
        ? SLACK_FORMATTING_CONSTRAINTS_CONTENT
        : '',
    USER_SECRETS_CONTEXT:
      params.secretIndex.length > 0
        ? params.secretIndex.map((s) => `- _USER_SECRET_${s.name}`).join('\n')
        : '',
    CUSTOM_OPENING: params.oracleConfig.prompt?.opening ?? '',
    CUSTOM_COMMUNICATION_STYLE:
      params.oracleConfig.prompt?.communicationStyle ?? '',
    CUSTOM_CAPABILITIES: params.oracleConfig.prompt?.capabilities ?? '',
  });
}
