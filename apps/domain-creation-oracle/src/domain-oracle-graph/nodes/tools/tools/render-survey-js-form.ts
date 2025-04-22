import sseService from '@/services/sse/sse.service.js';
import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { Entities } from '@ixo/oracles-chain-client';
import { RenderComponentEvent } from '@ixo/oracles-events/server';

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const renderSurveyJsForm = tool(
  async ({ protocolDid }, _runnableConfig) => {
    const runnableConfig = _runnableConfig as IRunnableConfigWithRequiredFields;
    const { configs, thread_id, requestId } = runnableConfig.configurable;
    if (!thread_id || !requestId) {
      throw new Error('thread_id and requestId are required');
    }
    const matrixAccessToken = configs?.matrix.accessToken;
    const surveyJson = await Entities.getSurveyJsDomain(
      {
        protocolDid,
      },
      matrixAccessToken,
    );
    const componentEvent = new RenderComponentEvent({
      componentName: 'survey-js-form',
      connectionId: thread_id,
      requestId,
      sessionId: thread_id,
      args: {
        surveyJson,
      },
    });

    // sseService.sendEvent(thread_id, componentEvent);

    return JSON.stringify({
      message: 'Rendered the Survey JS Form on the client',
      surveyJson,
    });
  },
  {
    name: 'render_survey_js_form',

    description:
      'Render a Survey JS Form aka entity/domain form on the client interface',
    schema: z.object({
      protocolDid: z.string(),
    }),
  },
);
