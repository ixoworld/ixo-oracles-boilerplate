import { jsonToYaml } from '@ixo/common';
import { Entities } from '@ixo/oracles-chain-client';
import { tool } from '@langchain/core/tools';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { searchDomainWithSemanticSearchTool } from './tools/search-domain-with-semantic-search-tool.js';
import { selectDomainTool } from './tools/select-domain-tool.js';
import { renderSurveyJsForm } from './tools/render-survey-js-form.js';
const getEntityByIdTool = tool(
  async ({ entityOrDomainId }) => {
    const entity = await Entities.getEntityById(entityOrDomainId);
    if (!entity) {
      return `Entity with id ${entityOrDomainId} not found`;
    }
    return jsonToYaml(entity);
  },
  {
    name: 'get_entityOrDomain_by_id',
    description: 'Get an entity or domain by its did',
    schema: z.object({
      entityOrDomainId: z
        .string()
        .regex(/^did:ixo:entity:[\w-]+$/)
        .describe(
          'The did of the entity or domain example: did:ixo:entity:123 or did:ixo:entity:2595cbf3ccb447e2c33bc28375393cb4',
        ),
    }),
  },
);

const tools = [
  getEntityByIdTool,
  searchDomainWithSemanticSearchTool,
  selectDomainTool,
  renderSurveyJsForm,
];
const toolsNode = new ToolNode(tools);

export { tools, toolsNode };
