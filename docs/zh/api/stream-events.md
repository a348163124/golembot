# StreamEvent

`StreamEvent` 是 `assistant.chat()` 产出的所有事件的联合类型。跨引擎提供统一接口。

## 类型定义

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

::: tip 终态语义
`assistant.chat()` 现在总会以且仅以一个 `completion` 事件收尾。下游消费方应把 `completion` 当成统一终态，`done` 只保留为底层引擎流结束事件。
:::

## 事件类型

| 类型 | 说明 |
|------|------|
| `text` | 来自 Agent 的流式文本内容 |
| `tool_call` | Agent 正在调用工具（读文件、运行命令等） |
| `tool_result` | 工具调用的结果 |
| `warning` | 来自引擎的非致命警告 |
| `error` | 处理过程中发生错误 |
| `done` | 底层引擎一轮结束。可选字段：`sessionId`、`durationMs`、`costUsd`（Claude Code/OpenCode）、`numTurns`（Claude Code）、`fullText`（Cursor/Claude Code，完整回复文本） |
| `completion` | 统一终态。状态为 `completed`、`silent`、`failed`、`aborted` 之一 |

::: tip
多个 `text` 事件拼接成完整回复——每个事件是一个部分片段，不是完整消息。需要将所有 `content` 字段拼接起来才是完整回复。
:::

`done` 不再等同于“最终回复已经成功交付”。如果你要判断一轮对话最终是成功、静默、失败还是中断，请优先消费 `completion`。

### `completion` 示例

```typescript
{ type: 'completion', status: 'completed', finalText: '这里是最终回复' }
{ type: 'completion', status: 'silent', reason: 'pass' }
{ type: 'completion', status: 'failed', message: 'Engine process exited with code 1' }
{ type: 'completion', status: 'aborted', reason: 'timeout', partialText: '半截回复' }
```

## 消费事件

```typescript
// 只打印文本
for await (const event of assistant.chat('你好')) {
  if (event.type === 'text') process.stdout.write(event.content);
}

// IM 场景：累积后发送
let reply = '';
for await (const event of assistant.chat(message)) {
  if (event.type === 'text') reply += event.content;
  if (event.type === 'completion' && event.status === 'completed' && !reply) {
    reply = event.finalText;
  }
}
await sendToIM(reply);
```

## 下一步

- [createAssistant()](/zh/api/create-assistant) — 库入口和配置选项
- [HTTP API](/zh/api/http-api) — 通过 `POST /chat` 进行 SSE 流式调用
- [引擎概览](/zh/engines/overview) — 各引擎如何产出这些事件
