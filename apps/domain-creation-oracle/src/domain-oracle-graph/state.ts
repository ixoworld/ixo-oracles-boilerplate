import { BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { IProtocol } from './types.js';

export const domainCreationOracleState = Annotation.Root({
  protocolList: Annotation<IProtocol[]>({
    reducer: (prev, curr) => {
      const array = [...prev, ...curr];
      const uniqueArray = array.filter(
        (protocol, index, self) =>
          index === self.findIndex((t) => t.did === protocol.did),
      );
      return uniqueArray;
    },
    default: () => [],
  }),
  selectedProtocol: Annotation<IProtocol | null>({
    default: () => null,
    reducer: (_, curr) => {
      return curr;
    },
  }),

  config: Annotation<{
    wsId?: string;
    did: string;
  }>({
    default: () => ({
      did: '',
      wsId: '',
    }),
    reducer: (prev, curr) => {
      return { ...prev, ...curr };
    },
  }),
  createdDomains: Annotation<string[]>({
    default: () => [],
    reducer: (prev, curr) => {
      return [...prev, ...curr];
    },
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

export type DomainCreationOracleState = typeof domainCreationOracleState.State;
