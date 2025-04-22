import { createGenericChatNode } from '@ixo/common';
import { tools } from './tools/tools.nodes.js';

const genericChatNode = createGenericChatNode(
  {
    APP_NAME: 'Domain Creation Oracle',
    APP_PURPOSE:
      "To help users create domains aka entities on the IXO network though oracle's chat interface in the ixo's apps",
    APP_MAIN_FEATURES: 'Create, manage, and configure domains',
    APP_TARGET_USERS: 'Users who want to create and manage domains',
    APP_UNIQUE_SELLING_POINTS: 'Easy to use, fast, and secure',
  },
  tools,
);

export default genericChatNode;
