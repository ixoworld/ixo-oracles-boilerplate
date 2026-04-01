import type { TaskExecutionContext } from 'src/tasks/processors/processor-utils';
import {
  EDITOR_MODE_PROMPTS,
  STANDALONE_EDITOR_PROMPTS,
} from '../editor/prompts';

export function buildOperationalMode(params: {
  taskExecutionContext?: TaskExecutionContext;
  editorRoomId?: string;
  spaceId?: string;
  currentEntityDid?: string;
  runNumber?: number;
}): { operationalMode: string; editorSection: string } {
  // Build operational mode + editor section via JS — cleaner than nested mustache conditionals
  const editorPrompts = params.editorRoomId
    ? EDITOR_MODE_PROMPTS
    : params.spaceId
      ? STANDALONE_EDITOR_PROMPTS
      : null;

  const operationalMode = params.taskExecutionContext
    ? [
        `**Autonomous Task Execution Mode**`,
        ``,
        `You are running a scheduled task autonomously — no human is in the loop. The user message contains a Task Page that is your **complete blueprint**. You MUST follow this exact 2-step sequence:`,
        ``,
        `## Step 1: Execute the Task`,
        `- Follow the Task Page exactly — execute "What to Do", format per "How to Report", obey "Constraints".`,
        `- If a step fails, check "Notes" for fallbacks before improvising. If the page is missing critical sections, report failure instead of guessing.`,
        `- Do not ask questions or narrate. Deliver only the requested output.`,
        ``,
        `### Tool Preferences`,
        `- **API calls / JSON data**: ALWAYS use the Sandbox (write a fetch/curl/requests script). NEVER use Firecrawl for API endpoints (/api/, /v1/, /v2/, /v3/, JSON responses).`,
        `- **Web scraping (human-readable pages)**: Use the Firecrawl Agent for scraping articles, blogs, news pages.`,
        `- **Web search**: Use the Firecrawl Agent's search tool for quick web searches.`,
        `- **Memory**: Use the Memory Agent to recall prior knowledge before external lookups.`,
        ``,
        `## Step 2: Execution Report (REQUIRED)`,
        `After producing your output, you MUST review your execution before finishing:`,
        ``,
        `1. **Task Page Notes** — Use the editor to append to "Notes" under "### Run #${params.taskExecutionContext.runNumber} Learnings":`,
        `   - If issues occurred (API failures, retries, fallbacks, unexpected data): document each one concisely.`,
        `   - If everything was smooth: write "No issues encountered."`,
        `   Do NOT overwrite existing notes.`,
        `2. **Memory Engine** — Use the Memory Agent to store any cross-task learnings that could benefit future tasks (e.g., "API X rate-limits at 10 req/min", "Website Y needs JS rendering").`,
      ].join('\n')
    : editorPrompts
      ? editorPrompts.operationalMode
      : params.currentEntityDid
        ? [
            `**Entity Context Active**`,
            ``,
            `You are currently viewing an entity (DID: ${params.currentEntityDid}). Use:`,
            `- **Domain Indexer Agent** for entity discovery, overviews, and FAQs`,
            `- **Portal Agent** for navigation or UI actions (e.g., \`showEntity\`)`,
            `- **Memory Agent** for historical knowledge`,
            `For entities like ecs, supamoto, ixo, QI, use both Domain Indexer and Memory Agent together.`,
            ``,
            `**Important:** Pages (BlockNote documents) are NOT entities. For pages, use \`list_workspace_pages\` and \`call_editor_agent\` — never the Domain Indexer.`,
          ].join('\n')
        : [
            `**General Conversation Mode**`,
            ``,
            `Default to conversation mode, using the Memory Agent for recall and the Firecrawl Agent for external research or fresh data.`,
            ``,
            `### Tool Preferences`,
            `- **API calls / JSON data**: ALWAYS use the Sandbox (write a fetch/curl/requests script). NEVER use Firecrawl for API endpoints.`,
            `- **Web scraping (human-readable pages)**: Use the Firecrawl Agent for articles, blogs, news.`,
            `- **Web search**: Use the Firecrawl Agent's search tool.`,
            ``,
            `### Task Trial Runs`,
            `When the Task Manager asks you to do a trial run for a scheduled task, you are testing the work so the user can approve it. After completing the work:`,
            `1. Show the user the result as requested.`,
            `2. **Report your execution trace** — list every agent, URL, API endpoint (with params), search query, skill (name + CID), and the step-by-step order. Mention any failures or fallbacks.`,
            `This trace is critical — the Task Manager uses it to write a detailed task page for autonomous runs.`,
          ].join('\n');

  const editorSection = editorPrompts?.editorSection ?? '';

  return { operationalMode, editorSection };
}
