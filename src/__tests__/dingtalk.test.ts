import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMessage } from '../channel.js';

// Mock dingtalk-stream SDK
const mockGetAccessToken = vi.fn().mockResolvedValue('mock-access-token');
const mockSocketCallBackResponse = vi.fn();
const mockConnect = vi.fn().mockResolvedValue(undefined);

/** Captured TOPIC_ROBOT callback — lets tests inject fake incoming messages. */
let robotCallback: ((res: { headers: { messageId: string }; data: string }) => Promise<void>) | null = null;

vi.mock('../peer-require.js', () => ({
  importPeer: vi.fn().mockResolvedValue({
    DWClient: class {
      getAccessToken = mockGetAccessToken;
      socketCallBackResponse = mockSocketCallBackResponse;
      connect = mockConnect;
      registerCallbackListener = vi.fn((_topic: string, cb: any) => {
        robotCallback = cb;
      });
    },
    TOPIC_ROBOT: 'TOPIC_ROBOT',
  }),
}));

// Must import after mock
const { DingtalkAdapter } = await import('../channels/dingtalk.js');

let msgIdCounter = 0;

/** Deliver a fake DingTalk stream message to the adapter's registered callback. */
async function deliver(data: Record<string, unknown>): Promise<void> {
  msgIdCounter++;
  await robotCallback!({
    headers: { messageId: `stream-msg-${msgIdCounter}` },
    data: JSON.stringify({
      msgId: `msg-${msgIdCounter}`,
      senderStaffId: 'staff-1',
      senderNick: 'alice',
      conversationId: 'conv-1',
      conversationType: '1',
      sessionWebhook: 'https://example.com/webhook',
      robotCode: 'robot-123',
      ...data,
    }),
  });
}

describe('DingtalkAdapter', () => {
  let adapter: InstanceType<typeof DingtalkAdapter>;

  beforeEach(() => {
    adapter = new DingtalkAdapter({ clientId: 'id', clientSecret: 'secret' });
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('calls DingTalk group message API with correct params', async () => {
      // Start the adapter to initialize dwClient
      await adapter.start(() => {});

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
      try {
        await adapter.send('conv-123', 'Hello from cron');

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, opts] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.dingtalk.com/v1.0/robot/groupMessages/send');
        expect(opts?.method).toBe('POST');
        expect(opts?.headers).toMatchObject({
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': 'mock-access-token',
        });

        const body = JSON.parse(opts?.body as string);
        expect(body.openConversationId).toBe('conv-123');
        expect(body.msgKey).toBe('sampleText');
        expect(JSON.parse(body.msgParam)).toEqual({ content: 'Hello from cron' });
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('does nothing when dwClient has no access token', async () => {
      // Adapter not started — dwClient is null
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
      try {
        await adapter.send('conv-123', 'test');
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  // ── Attachment download (issue #39) ─────────────────────────────────────
  //
  // DingTalk's downloadCode must be exchanged for a temporary URL via
  // POST /v1.0/robot/messageFiles/download before the file can be fetched.

  describe('attachment download', () => {
    const DOWNLOAD_API = 'https://api.dingtalk.com/v1.0/robot/messageFiles/download';
    const TEMP_URL = 'https://static.dingtalk.com/tmp/abc123';
    let received: ChannelMessage[];
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    /** Mock fetch: download API returns a temp URL; the temp URL returns bytes. */
    function mockTwoStepFetch(fileBytes: Buffer, contentType: string, opts: { apiFails?: boolean } = {}) {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url) === DOWNLOAD_API) {
          if (opts.apiFails) return new Response('server error', { status: 500 });
          return new Response(JSON.stringify({ downloadUrl: TEMP_URL }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (String(url) === TEMP_URL) {
          return new Response(new Uint8Array(fileBytes), {
            status: 200,
            headers: { 'Content-Type': contentType },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as any;
    }

    beforeEach(async () => {
      received = [];
      await adapter.start((msg) => {
        received.push(msg);
      });
    });

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it('picture message: exchanges downloadCode for temp URL then downloads bytes', async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      mockTwoStepFetch(jpeg, 'image/jpeg');

      await deliver({ msgtype: 'picture', content: { downloadCode: 'dl-code-1' } });

      // Step 1: POST to the download API with downloadCode + robotCode
      const apiCall = fetchSpy.mock.calls.find(([url]: [unknown, ...unknown[]]) => String(url) === DOWNLOAD_API);
      expect(apiCall).toBeDefined();
      const apiOpts = apiCall![1] as RequestInit;
      expect(apiOpts.method).toBe('POST');
      expect((apiOpts.headers as Record<string, string>)['x-acs-dingtalk-access-token']).toBe('mock-access-token');
      expect(JSON.parse(apiOpts.body as string)).toEqual({ downloadCode: 'dl-code-1', robotCode: 'robot-123' });

      // Step 2: bytes reach the ChannelMessage
      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('(image)');
      expect(received[0].images).toHaveLength(1);
      expect(received[0].images![0].mimeType).toBe('image/jpeg');
      expect(received[0].images![0].data).toEqual(jpeg);
    });

    it('file message: downloads via two-step API and fills files with fileName', async () => {
      const html = Buffer.from('<html><body>skill calls</body></html>');
      mockTwoStepFetch(html, 'text/html');

      await deliver({ msgtype: 'file', content: { downloadCode: 'dl-code-2', fileName: 'skill-calls.html' } });

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('(file: skill-calls.html)');
      expect(received[0].files).toHaveLength(1);
      expect(received[0].files![0].fileName).toBe('skill-calls.html');
      expect(received[0].files![0].mimeType).toBe('text/html');
      expect(received[0].files![0].data).toEqual(html);
    });

    it('richText message: extracts text and downloads inline images', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      mockTwoStepFetch(png, 'image/png');

      await deliver({
        msgtype: 'richText',
        content: { richText: [{ text: '看看这张图 ' }, { downloadCode: 'dl-code-3', type: 'picture' }] },
      });

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('看看这张图');
      expect(received[0].images).toHaveLength(1);
      expect(received[0].images![0].data).toEqual(png);
    });

    it('file download failure: message is skipped and acked, no empty placeholder forwarded', async () => {
      mockTwoStepFetch(Buffer.from(''), 'text/html', { apiFails: true });

      await deliver({ msgtype: 'file', content: { downloadCode: 'dl-bad', fileName: 'doc.pdf' } });

      expect(received).toHaveLength(0);
      expect(mockSocketCallBackResponse).toHaveBeenCalled();
    });

    it('picture download failure: message still forwarded with (image) placeholder', async () => {
      mockTwoStepFetch(Buffer.from(''), 'image/jpeg', { apiFails: true });

      await deliver({ msgtype: 'picture', content: { downloadCode: 'dl-bad' } });

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('(image)');
      expect(received[0].images).toBeUndefined();
    });

    it('config robotCode overrides the callback payload robotCode', async () => {
      const jpeg = Buffer.from([0xff, 0xd8]);
      mockTwoStepFetch(jpeg, 'image/jpeg');
      const customAdapter = new DingtalkAdapter({ clientId: 'id', clientSecret: 'secret', robotCode: 'custom-rc' });
      const customReceived: ChannelMessage[] = [];
      await customAdapter.start((msg) => {
        customReceived.push(msg);
      });

      await deliver({ msgtype: 'picture', content: { downloadCode: 'dl-code-4' } });

      const apiCall = fetchSpy.mock.calls.find(([url]: [unknown, ...unknown[]]) => String(url) === DOWNLOAD_API);
      expect(JSON.parse((apiCall![1] as RequestInit).body as string).robotCode).toBe('custom-rc');
      expect(customReceived).toHaveLength(1);
    });

    it('falls back to clientId as robotCode when payload has none', async () => {
      const jpeg = Buffer.from([0xff, 0xd8]);
      mockTwoStepFetch(jpeg, 'image/jpeg');

      await deliver({ msgtype: 'picture', content: { downloadCode: 'dl-code-5' }, robotCode: undefined });

      const apiCall = fetchSpy.mock.calls.find(([url]: [unknown, ...unknown[]]) => String(url) === DOWNLOAD_API);
      expect(JSON.parse((apiCall![1] as RequestInit).body as string).robotCode).toBe('id');
    });

    it('text message is unaffected by attachment handling', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        throw new Error('fetch should not be called for text messages');
      }) as any;

      await deliver({ msgtype: 'text', text: { content: 'hello' } });

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('hello');
      expect(received[0].images).toBeUndefined();
      expect(received[0].files).toBeUndefined();
    });
  });
});
