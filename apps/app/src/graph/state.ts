import { UserContextData } from '@ixo/common';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { type BaseMessage } from 'langchain';
import { type BrowserToolCallDto } from 'src/messages/dto/send-message.dto';

export const CustomerSupportGraphState = Annotation.Root({
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

  client: Annotation<'portal' | 'matrix' | 'slack'>({
    default: () => 'portal',
    reducer: (_, curr) => curr,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  editorRoomId: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (prev, curr) => curr,
  }),

  currentEntityDid: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (prev, curr) => curr,
  }),

  browserTools: Annotation<BrowserToolCallDto[] | undefined>({
    default: () => [],
    // always override the tool list
    reducer: (_, curr) => curr,
  }),
  userContext: Annotation<UserContextData>({
    default: () => ({
      identity: undefined,
      work: undefined,
      goals: undefined,
      interests: undefined,
      relationships: undefined,
      recent: undefined,
    }),
    reducer: (prev, curr) => ({ ...prev, ...curr }),
  }),
});

export type TCustomerSupportGraphState = typeof CustomerSupportGraphState.State;
