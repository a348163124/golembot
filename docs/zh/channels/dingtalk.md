# 钉钉

通过 Stream 模式（WebSocket）将 GolemBot 助手接入钉钉。无需公网 IP。

## 前置条件

```bash
pnpm add dingtalk-stream
```

## 钉钉开放平台配置

1. 前往[钉钉开发者后台](https://open-dev.dingtalk.com/)，创建一个机器人应用
2. 在**凭证信息**中，复制 **Client ID**（AppKey）和 **Client Secret**（AppSecret）
3. 在**消息推送**中，选择 **Stream 模式**
4. 按需配置机器人权限

## 配置

```yaml
# golem.yaml
channels:
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}
```

```sh
# .env
DINGTALK_CLIENT_ID=dingxxxxxxxxxx
DINGTALK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxx
```

## 启动

```bash
golembot gateway --verbose
```

## 群聊行为

钉钉群被视为**群聊**。通过 `golem.yaml` 中的 `groupChat` 字段配置响应策略：

```yaml
groupChat:
  groupPolicy: mention-only  # 钉钉推荐使用此模式
```

::: warning 平台限制
钉钉 Stream SDK（`TOPIC_ROBOT`）**仅投递 @mention 机器人的消息**，非 mention 的群消息不会发送给 bot 进程。这意味着：

- `mention-only` — 正常工作
- `smart` — 无法观察非 mention 消息，无法积累群上下文
- `always` — 行为等同于 `mention-only`（平台侧过滤）

建议钉钉用户使用 `mention-only` 模式。
:::

## 图片与文件

adapter 会自动下载收到的图片（图片 / 富文本消息）和文件附件，供 agent 读取：

- **图片**：保存到工作区并在 prompt 中附路径；多模态引擎可直接查看
- **文件**（PDF、HTML、代码等）：保存到工作区，agent 用文件工具读取

下载走钉钉的两步媒体 API（`downloadCode` → 临时链接 → 文件字节），需要机器人编码（robotCode）。企业内部机器人的 robotCode 与 Client ID 相同，会自动识别；如不一致可在频道配置中覆盖：

```yaml
channels:
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}
    robotCode: ${DINGTALK_ROBOT_CODE}  # 可选，默认取 clientId
```

## 说明

- Stream 模式使用出站 WebSocket — 可在 NAT/防火墙后运行
- 回复发送到每条消息提供的 session webhook URL
- 最大消息长度 4,000 字符；更长的回复会自动拆分
