# Matrix State Manager

## Overview

The MatrixStateManager provides functionality to manage state in Matrix rooms. It handles storing, retrieving, and updating state events in Matrix rooms with proper validation and serialization.

## State Storage Structure

States are stored as Matrix state events with the following characteristics:

- Event type: `ixo.room.state`
- Content structure: The actual state data is stored under the `data` property of the state event content
- Serialization: All state data is stringified using SuperJSON to preserve complex data types

### Example State Event Structure

```typescript
{
  type: "ixo.room.state",
  state_key: "weather_temperature",
  content: {
    data: "<SuperJSON serialized string>" // Contains the actual state data
  }
}
```

## State Key Format

State keys follow a specific format to ensure proper organization and validation:

- Format: `{oracleName}_{key}`
- Example: `weather_temperature`
- Requirements:
  - `oracleName` must be one of the supported oracle names
  - `key` can be any string identifying the specific state

## Data Serialization

The module uses SuperJSON for data serialization, which offers several advantages over standard JSON:

### Supported Types

SuperJSON preserves JavaScript types that JSON.stringify cannot handle:

- Date objects
- Map and Set collections
- BigInt values
- undefined values
- Regular expressions
- Circular references
- Class instances
- And more complex types

### Example

```typescript
// Original data
const data = {
  timestamp: new Date(),
  values: new Map([['temp', 25]]),
  regex: /pattern/,
};

// Stored in Matrix
const serialized = superjson.stringify(data);
// Later retrieved and deserialized
const retrieved = superjson.parse(serialized);
```

## API Methods

### getState<C>

Retrieves state data from a Matrix room.

```typescript
async getState<C>(roomId: string, stateKey: string): Promise<C>
```

### setState<C>

Sets state data in a Matrix room.

```typescript
async setState<C>(payload: IStatePayload<C>): Promise<void>
```

### updateState<C>

Updates existing state data in a Matrix room.

```typescript
async updateState<C>(payload: IStatePayload<C>): Promise<void>
```

### listStateEvents<D>

Lists all state events in a Matrix room.

```typescript
async listStateEvents<D>(room: sdk.Room): Promise<D[]>
```

## Error Handling

The module includes validation for:

- Room ID format
- State key format
- Oracle name validation
- Serialization/deserialization errors

## Usage Examples

### Setting State

```typescript
await matrixStateManager.setState({
  roomId: '!room:domain',
  stateKey: 'weather_temperature',
  data: { temperature: 25, unit: 'celsius' },
});
```

### Getting State

```typescript
const state = await matrixStateManager.getState<WeatherData>(
  '!room:domain',
  'weather_temperature',
);
```

### Updating State

```typescript
await matrixStateManager.updateState({
  roomId: '!room:domain',
  stateKey: 'weather_temperature',
  data: { temperature: 26 },
});
```
