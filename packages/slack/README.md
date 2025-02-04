# @ixo/slack

A powerful and type-safe Slack integration package that provides a wrapper around the Slack Bolt SDK for easy interaction with Slack's API.

## Features

- 🚀 Easy-to-use wrapper around Slack's Bolt SDK
- 📝 Full TypeScript support
- 🔒 Socket Mode support for secure connections
- 💬 Rich messaging capabilities with markdown support
- 🧵 Thread management
- 👥 User management and profile handling
- ⚡ Ephemeral message support
- ✏️ Message editing and deletion
- 📄 Automatic handling of long messages with block splitting

## Installation

```bash
pnpm add @ixo/slack
```

## Usage

### Initialize the Slack Client

```typescript
import { Slack } from '@ixo/slack';

const slack = new Slack(
  'xoxb-your-bot-token', // Bot OAuth Token
  'xapp-your-app-token', // App-Level Token
);

// Start the Slack app
await slack.start();

// Stop the Slack app -- should be called on server shutdown (e.g. in an express server)
await slack.stop();
```

### Posting Messages

```typescript
// Simple text message
await slack.postMessage({
  channel: 'C1234567890',
  text: 'Hello, world!',
});

// Message with markdown formatting
await slack.postMessage({
  channel: 'C1234567890',
  text: '**Bold** and _italic_ text',
  format: true,
});

// Message in a thread
await slack.postMessage({
  channel: 'C1234567890',
  text: 'Reply in thread',
  threadTs: '1234567890.123456',
});
```

### Working with Threads

```typescript
// Get chat history in a thread
const messages = await slack.getChatHistoryInThread(
  'C1234567890',
  '1234567890.123456',
);
```

### Ephemeral Messages

```typescript
// Send a message visible only to a specific user
await slack.postEphemeral({
  channel: 'C1234567890',
  user: 'U1234567890',
  text: 'Only you can see this message',
});
```

### Message Management

```typescript
// Update a message
await slack.updateMessage({
  channel: 'C1234567890',
  ts: '1234567890.123456',
  text: 'Updated message',
});

// Delete a message
await slack.deleteMessage({
  channel: 'C1234567890',
  ts: '1234567890.123456',
});
```

### User Management

```typescript
// List workspace members
const { members, nextCursor } = await slack.listMembers();

// Get user profile
const userProfile = await slack.getUserProfile('U1234567890');

// Get bot's own profile
const botProfile = await slack.getCurrentUserProfile();
```

## API Reference

### `Slack` Class

#### Constructor

- `constructor(BOT_OAUTH_TOKEN: string, SLACK_APP_LEVEL_TOKEN: string)`

#### Methods

- `postMessage(params: PostMessageParams): Promise<ChatPostMessageResponse>`
- `getChatHistoryInThread(channel: string, threadId: string): Promise<MessageElement[]>`
- `postEphemeral(params: PostEphemeralParams): Promise<ChatPostMessageResponse>`
- `updateMessage(params: ChatUpdateArguments): Promise<void>`
- `deleteMessage(params: ChatDeleteArguments): Promise<void>`
- `listMembers(cursor?: string, limit?: number): Promise<ListMembersResponse>`
- `getUserProfile(userId: string): Promise<Profile & { userId: string } | undefined>`
- `getCurrentUserProfile(): Promise<Profile & { userId: string } | undefined>`
- `start(): Promise<void>`
- `stop(): Promise<void>`

## Development

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run tests
pnpm test
```

## License

Private package - All rights reserved.

## Contributing

This is a private package. Please refer to the internal contribution guidelines.
