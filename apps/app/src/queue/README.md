# Memory Queue Module

This module handles asynchronous saving of human and AI messages to the Matrix memory engine using BullMQ.

## Features

- **Asynchronous Processing**: Messages are queued and processed in the background
- **Bulk Saving**: Multiple messages can be batched together for efficiency
- **Retry Logic**: Failed jobs are automatically retried with exponential backoff
- **Error Handling**: Comprehensive error logging and monitoring

## Setup

### 1. Environment Variables

Add these to your `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password  # Optional
REDIS_DB=0                          # Optional, defaults to 0
```

### 2. Redis Setup

Make sure Redis is running:

```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or install locally
brew install redis  # macOS
sudo apt install redis-server  # Ubuntu
```

## Usage

### Queue Single Message

```typescript
await memoryQueueService.queueMessage({
  content: 'Hello, how are you?',
  roleType: 'user',
  name: 'John Doe',
  roomId: 'room_id',
  userDid: 'did:user:123',
  sessionId: 'session_123',
});
```

### Queue Conversation

```typescript
await memoryQueueService.queueConversation({
  humanMessage: 'What is the weather?',
  aiMessage: 'The weather is sunny today.',
  userName: 'John Doe',
  aiName: 'Oracle Assistant',
  roomId: 'room_id',
  userDid: 'did:user:123',
  sessionId: 'session_123',
});
```

### Queue Status

```typescript
const status = await memoryQueueService.getQueueStatus();
console.log(status);
// { waiting: 5, active: 2, completed: 100, failed: 1 }
```

## How It Works

1. **Messages Service** → Receives human message
2. **AI Response** → Generates AI response
3. **Queue Service** → Queues both messages for memory saving
4. **Queue Processor** → Processes job and calls matrix-memory tool
5. **Matrix Memory** → Saves to memory engine via Matrix events

## Configuration

The queue is configured with:

- **Retry**: 3 attempts with exponential backoff
- **Cleanup**: Keeps 100 completed jobs, 50 failed jobs
- **Priority**: Memory saving jobs have priority 10
- **Delay**: 1 second delay to allow message batching

## Monitoring

Logs include:

- Job queuing confirmations
- Processing progress
- Success/failure notifications
- Detailed error information for debugging

## Error Handling

- **Non-critical**: Memory saving failures don't break conversations
- **Retries**: Failed jobs are automatically retried
- **Logging**: All errors are logged with context
- **Graceful**: The system continues working even if memory saving fails
