import type { ChannelAdapter, ChannelMessage, FileAttachment, ImageAttachment, ReplyOptions } from '../channel.js';
import { importPeer } from '../peer-require.js';
import type { DingtalkChannelConfig } from '../workspace.js';

export class DingtalkAdapter implements ChannelAdapter {
  readonly name = 'dingtalk';
  readonly maxMessageLength = 4000;
  private config: DingtalkChannelConfig;
  private dwClient: any;
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;

  constructor(config: DingtalkChannelConfig) {
    this.config = config;
  }

  /**
   * Download an attachment referenced by a `downloadCode` from a robot message.
   *
   * DingTalk's downloadCode is NOT a URL — it must first be exchanged for a
   * temporary download URL via POST /v1.0/robot/messageFiles/download, and the
   * file is then fetched from that URL (two-step flow per DingTalk docs).
   */
  private async downloadByCode(
    downloadCode: string,
    robotCode: string,
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const accessToken = await this.dwClient?.getAccessToken?.();
      if (!accessToken) {
        console.error('[dingtalk] Cannot download attachment: no access token');
        return null;
      }
      const resp = await fetch('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': accessToken,
        },
        body: JSON.stringify({ downloadCode, robotCode }),
      });
      if (!resp.ok) {
        console.error(`[dingtalk] messageFiles/download failed: HTTP ${resp.status}`);
        return null;
      }
      const { downloadUrl } = (await resp.json()) as { downloadUrl?: string };
      if (!downloadUrl) {
        console.error('[dingtalk] messageFiles/download returned no downloadUrl');
        return null;
      }
      const fileResp = await fetch(downloadUrl);
      if (!fileResp.ok) {
        console.error(`[dingtalk] attachment download failed: HTTP ${fileResp.status}`);
        return null;
      }
      const data = Buffer.from(await fileResp.arrayBuffer());
      const ct = fileResp.headers.get('content-type') || 'application/octet-stream';
      return { data, mimeType: ct.split(';')[0] };
    } catch (e) {
      console.error('[dingtalk] Failed to download attachment:', (e as Error).message);
      return null;
    }
  }

  /** Download an image via downloadCode (two-step API) or a direct picURL. */
  private async downloadImage(
    downloadCode: string | undefined,
    picURL: string | undefined,
    robotCode: string,
  ): Promise<ImageAttachment | null> {
    if (downloadCode) {
      const result = await this.downloadByCode(downloadCode, robotCode);
      if (!result) return null;
      const mimeType = result.mimeType.startsWith('image/') ? result.mimeType : 'image/jpeg';
      return { mimeType, data: result.data };
    }
    if (picURL) {
      try {
        const resp = await fetch(picURL);
        if (!resp.ok) return null;
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = resp.headers.get('content-type') || 'image/jpeg';
        return { mimeType: ct.split(';')[0], data: buf };
      } catch (e) {
        console.error('[dingtalk] Failed to download image URL:', (e as Error).message);
        return null;
      }
    }
    return null;
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let sdk: any;
    try {
      sdk = await importPeer('dingtalk-stream');
    } catch {
      throw new Error('DingTalk adapter requires dingtalk-stream. Install it: npm install dingtalk-stream');
    }

    const { DWClient, TOPIC_ROBOT } = sdk;

    this.dwClient = new DWClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });

    this.dwClient.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
      // Deduplicate re-delivered events.
      const msgId: string | undefined = res.headers?.messageId || JSON.parse(res.data).msgId;
      if (msgId) {
        if (this.seenMsgIds.has(msgId)) {
          this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
          return;
        }
        this.seenMsgIds.add(msgId);
        if (this.seenMsgIds.size > DingtalkAdapter.MAX_SEEN) {
          const entries = [...this.seenMsgIds];
          this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
        }
      }

      const data = JSON.parse(res.data);
      const msgtype = data.msgtype;
      // For enterprise internal robots, robotCode == clientId. The callback
      // payload usually carries robotCode; config can override.
      const robotCode: string = this.config.robotCode || data.robotCode || this.config.clientId;
      let text = '';
      const images: ImageAttachment[] = [];
      const files: FileAttachment[] = [];

      if (msgtype === 'text' || !msgtype) {
        text = data.text?.content?.trim() || '';
      } else if (msgtype === 'picture') {
        const img = await this.downloadImage(data.content?.downloadCode, data.content?.picURL, robotCode);
        if (img) images.push(img);
        text = '(image)';
      } else if (msgtype === 'richText') {
        // Rich text may contain text + images
        const richText = data.content?.richText;
        if (Array.isArray(richText)) {
          for (const section of richText) {
            if (section.text) text += section.text;
            if (section.downloadCode || section.picURL) {
              const img = await this.downloadImage(section.downloadCode, section.picURL, robotCode);
              if (img) images.push(img);
            }
          }
          text = text.trim();
          if (!text && images.length > 0) text = '(image)';
        }
      } else if (msgtype === 'file') {
        const downloadCode = data.content?.downloadCode;
        const fileName = data.content?.fileName || 'attachment';
        const file = downloadCode ? await this.downloadByCode(downloadCode, robotCode) : null;
        if (!file) {
          // Download failed — skip rather than forwarding an empty placeholder
          console.error(`[dingtalk] Failed to download file "${fileName}", message skipped`);
          this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
          return;
        }
        files.push({ mimeType: file.mimeType, data: file.data, fileName });
        text = `(file: ${fileName})`;
      } else {
        // Unsupported message type — skip
        this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
        return;
      }

      if (!text && images.length === 0 && files.length === 0) return;

      const isGroup = data.conversationType === '2';

      const channelMsg: ChannelMessage = {
        channelType: 'dingtalk',
        senderId: data.senderStaffId || data.senderId || '',
        senderName: data.senderNick,
        chatId: data.conversationId || '',
        chatType: isGroup ? 'group' : 'dm',
        text,
        messageId: msgId,
        images: images.length > 0 ? images : undefined,
        files: files.length > 0 ? files : undefined,
        mentioned: isGroup ? true : undefined,
        raw: { ...data, _sessionWebhook: data.sessionWebhook },
      };

      onMessage(channelMsg);

      this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
    });

    await this.dwClient.connect();
    console.log(`[dingtalk] Stream connection established`);
  }

  async reply(msg: ChannelMessage, text: string, _options?: ReplyOptions): Promise<void> {
    const raw = msg.raw as { _sessionWebhook?: string; senderStaffId?: string };
    const webhook = raw?._sessionWebhook;
    if (!webhook) return;

    const body = {
      msgtype: 'text',
      text: { content: text },
    };

    const accessToken = await this.dwClient?.getAccessToken?.();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) {
      headers['x-acs-dingtalk-access-token'] = accessToken;
    }

    await fetch(webhook, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  async send(chatId: string, text: string): Promise<void> {
    const accessToken = await this.dwClient?.getAccessToken?.();
    if (!accessToken) return;

    await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify({
        msgParam: JSON.stringify({ content: text }),
        msgKey: 'sampleText',
        openConversationId: chatId,
      }),
    });
  }

  async stop(): Promise<void> {
    this.dwClient = null;
  }
}
