import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { DingtalkChannelConfig } from '../workspace.js';
export declare class DingtalkAdapter implements ChannelAdapter {
    readonly name = "dingtalk";
    readonly maxMessageLength = 4000;
    private config;
    private dwClient;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    constructor(config: DingtalkChannelConfig);
    /**
     * Download an attachment referenced by a `downloadCode` from a robot message.
     *
     * DingTalk's downloadCode is NOT a URL — it must first be exchanged for a
     * temporary download URL via POST /v1.0/robot/messageFiles/download, and the
     * file is then fetched from that URL (two-step flow per DingTalk docs).
     */
    private downloadByCode;
    /** Download an image via downloadCode (two-step API) or a direct picURL. */
    private downloadImage;
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    reply(msg: ChannelMessage, text: string, _options?: ReplyOptions): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=dingtalk.d.ts.map