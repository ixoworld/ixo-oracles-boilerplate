import { type App } from '@slack/bolt';
import {
  type AllMessageEvents,
  type Block,
  type KnownBlock,
  type UsersListResponse,
} from '@slack/web-api';

type ProfileResponse = ReturnType<App['client']['users']['profile']['get']>;
type ChatPostMessageResponse = ReturnType<App['client']['chat']['postMessage']>;

export type SlackBlock = Block | KnownBlock;
export type PostMessageParams = {
  channel: string;
  text?: string;
  threadTs?: string;
  blocks?: SlackBlock[];
  format?: boolean;
};

export type ListMembersResponse = {
  members: UsersListResponse['members'];
  nextCursor?: string;
};

export { type AllMessageEvents };
export type { ChatPostMessageResponse, ProfileResponse };
