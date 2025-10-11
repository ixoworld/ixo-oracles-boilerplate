import { UserContextData } from '@ixo/common';
import { type BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
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

  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  accounts: Annotation<
    {
      did: string;
      name: string;
      email: string;
      phone: string;
      address: string;
    }[]
  >({
    default: () => [],
    reducer: (prev, curr) => [...prev, ...curr],
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
