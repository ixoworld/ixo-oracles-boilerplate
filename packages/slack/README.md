# @ixo/slack

A powerful and type-safe Slack integration package that provides a wrapper around the Slack Bolt SDK with robust Socket Mode connection management and error handling.

## Features

- 🚀 Easy-to-use wrapper around Slack's Bolt SDK
- 📝 Full TypeScript support
- 🔒 Enhanced Socket Mode support with automatic reconnection
- 🔄 Robust error handling and connection management
- 💬 Rich messaging capabilities with markdown support
- 🧵 Thread management
- 👥 User management and profile handling
- ⚡ Ephemeral message support
- ✏️ Message editing and deletion
- 📄 Automatic handling of long messages with block splitting
- 🏥 Health monitoring and connection status reporting

## Socket Mode Connection Management

The enhanced Slack client provides robust Socket Mode connection management to prevent server failures and ensure reliable operation:

### Key Features

- **Automatic Reconnection**: Automatically attempts to reconnect on connection failures
- **Exponential Backoff**: Uses exponential backoff strategy for reconnection attempts
- **Error Classification**: Intelligently identifies Socket Mode-specific errors
- **Health Monitoring**: Periodic health checks to monitor connection status
- **Graceful Shutdown**: Proper cleanup when the application stops
- **Connection Status**: Real-time connection status and statistics

### Error Handling

The client handles various Socket Mode connection issues:

- WebSocket disconnections
- Network timeouts (ETIMEDOUT)
- Connection resets (ECONNRESET)
- DNS resolution failures (ENOTFOUND)
- Socket hang-ups

### Configuration Options

You can configure the Socket Mode behavior using environment variables:

```bash
# Maximum number of reconnection attempts (default: 10)
SLACK_MAX_RECONNECT_ATTEMPTS=10

# Initial reconnection delay in milliseconds (default: 1000)
SLACK_RECONNECT_DELAY_MS=1000
```

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
  'xapp-your-app-token', // App-Level Token with connection:write scope
);

// Start the Slack app with enhanced error handling
await slack.start();

// Check connection status
console.log('Connected:', slack.isConnected());
console.log('Stats:', slack.getConnectionStats());

// Stop the Slack app gracefully
await slack.stop();
```

### Using with NestJS

The package includes a NestJS service with lifecycle management:

```typescript
import { SlackService } from '@ixo/slack';

@Injectable()
export class MyService {
  constructor(private readonly slackService: SlackService) {}

  async sendNotification() {
    // Check if Slack is available before using
    const status = this.slackService.getStatus();
    if (!status.isConfigured || !status.isConnected) {
      console.log('Slack not available');
      return;
    }

    await this.slackService.postMessage({
      channel: 'C1234567890',
      text: 'Hello from a resilient connection!',
    });
  }
}
```

### Health Check Integration

Monitor Slack connection health in your application:

```typescript
// GET /health endpoint returns:
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "slack": {
      "status": "connected", // "connected", "disconnected", or "disabled"
      "isConnected": true,
      "isConfigured": true,
      "connectionStats": {
        "isConnected": true,
        "reconnectAttempts": 0,
        "maxReconnectAttempts": 10
      }
    }
  }
}
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

## Troubleshooting Socket Mode Issues

### Common Issues and Solutions

1. **Server Restarts Due to Socket Disconnections**
   - The enhanced client now handles disconnections gracefully
   - Check logs for reconnection attempts
   - Monitor the `/health` endpoint for connection status

2. **Frequent Reconnections**
   - Check network stability
   - Verify Slack tokens are valid
   - Monitor the `reconnectAttempts` in connection stats

3. **Application Won't Start**
   - Verify `SLACK_BOT_OAUTH_TOKEN` and `SLACK_APP_TOKEN` are set correctly if you want Slack integration
   - The application will continue without Slack if tokens are not provided
   - Check logs for specific error messages

### Monitoring

- Use the `/health` endpoint to monitor connection status
- Check application logs for connection events
- Monitor the `reconnectAttempts` metric for connection stability

## API Reference

### `Slack` Class

#### Constructor

- `constructor(BOT_OAUTH_TOKEN: string, SLACK_APP_TOKEN: string)`

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
- `isConnected(): boolean`
- `getConnectionStats(): { isConnected: boolean; reconnectAttempts: number; maxReconnectAttempts: number }`

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
