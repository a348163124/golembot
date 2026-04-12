# StreamEvent

`StreamEvent` is the union type for all events yielded by `assistant.chat()`. It provides a unified interface across all engines.

## Type Definition

```typescript
type CompletionEvent =
  | { type: 'completion'; status: 'completed'; finalText: string;
      sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number }
  | { type: 'completion'; status: 'silent'; reason: 'pass' | 'skip';
      sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number }
  | { type: 'completion'; status: 'failed'; message: string; partialText?: string;
      sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number }
  | { type: 'completion'; status: 'aborted'; reason: 'user' | 'timeout'; partialText?: string;
      sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number };

type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number;
      costUsd?: number; numTurns?: number; fullText?: string }
  | CompletionEvent;
```

::: tip Terminal contract
`assistant.chat()` now always ends with exactly one `completion` event. Downstream consumers should treat `completion` as the terminal outcome and treat `done` as a lower-level engine lifecycle event kept for compatibility.
:::

## Event Types

### `text`

Streamed text content from the agent.

```typescript
{ type: 'text', content: 'Here is the analysis...' }
```

::: tip
Multiple `text` events form the complete response. Concatenate all `content` fields to build the full reply — each event is a partial chunk, not a complete message.
:::

### `tool_call`

The agent is invoking a tool (reading a file, running a command, etc.).

```typescript
{ type: 'tool_call', name: 'readFile', args: '{"path": "data.csv"}' }
```

| Field | Description |
|-------|-------------|
| `name` | Tool name (e.g., `readFile`, `bash`, `writeFile`) |
| `args` | JSON string of tool arguments |

### `tool_result`

The result of a tool invocation.

```typescript
{ type: 'tool_result', content: 'File contents here...' }
```

### `warning`

Non-fatal warning from the engine.

```typescript
{ type: 'warning', message: 'Running with --dangerously-skip-permissions' }
```

### `error`

An error occurred during processing.

```typescript
{ type: 'error', message: 'Engine process exited with code 1' }
```

### `done`

Signals the end of a low-level engine turn.

```typescript
{
  type: 'done',
  sessionId: 'abc-123',
  durationMs: 12345,
  costUsd: 0.042,
  numTurns: 3
}
```

| Field | Description | Availability |
|-------|-------------|-------------|
| `sessionId` | Engine session ID for resume | All engines |
| `durationMs` | Wall-clock duration | All engines |
| `costUsd` | API cost in USD | Claude Code, OpenCode |
| `numTurns` | Number of agent turns | Claude Code |
| `fullText` | Complete agent response text | Cursor, Claude Code |

`done` is not the final delivery contract. Some engines only attach metadata or `fullText` here. Prefer `completion` when deciding whether a reply completed, failed, stayed silent, or was aborted.

### `completion`

The terminal outcome for a chat turn.

#### `completed`

```typescript
{
  type: 'completion',
  status: 'completed',
  finalText: 'Here is the final answer...',
  durationMs: 12345,
  costUsd: 0.042
}
```

#### `silent`

```typescript
{
  type: 'completion',
  status: 'silent',
  reason: 'pass'
}
```

Used when the assistant intentionally chooses not to reply, for example `[PASS]` / `[SKIP]` flows in gateway/group-chat routing.

#### `failed`

```typescript
{
  type: 'completion',
  status: 'failed',
  message: 'Engine process exited with code 1',
  partialText: 'Partial answer...'
}
```

#### `aborted`

```typescript
{
  type: 'completion',
  status: 'aborted',
  reason: 'timeout',
  partialText: 'Partial answer...'
}
```

## Consuming Events

### Print text only

```typescript
for await (const event of assistant.chat('Hello')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

### Full event handling

```typescript
let fullText = '';

for await (const event of assistant.chat('Analyze the data')) {
  switch (event.type) {
    case 'text':
      fullText += event.content;
      break;
    case 'tool_call':
      console.log(`[tool] ${event.name}`);
      break;
    case 'tool_result':
      console.log(`[result] ${event.content.slice(0, 100)}...`);
      break;
    case 'error':
      console.error(`[error] ${event.message}`);
      break;
    case 'completion':
      if (event.status === 'completed') {
        console.log(`Completed in ${event.durationMs}ms`);
      } else if (event.status === 'failed') {
        console.error(`[failed] ${event.message}`);
      }
      break;
  }
}
```

### Accumulate for IM reply

```typescript
let reply = '';
for await (const event of assistant.chat(message)) {
  if (event.type === 'text') reply += event.content;
  if (event.type === 'completion' && event.status === 'completed' && !reply) {
    reply = event.finalText;
  }
}
await sendToIM(reply);
```

## What's Next

- [createAssistant()](/api/create-assistant) — library entry point and options
- [HTTP API](/api/http-api) — SSE streaming via `POST /chat`
- [Engine Overview](/engines/overview) — how engines produce these events
