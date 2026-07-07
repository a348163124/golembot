import { afterEach, describe, expect, it, vi } from 'vitest';

const mockImportPeer = vi.hoisted(() => vi.fn());

vi.mock('../peer-require.js', () => ({
  importPeer: mockImportPeer,
}));

import { buildFeishuClientConfig, FeishuAdapter, resolveFeishuOpenApiBaseUrl } from '../channels/feishu.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockImportPeer.mockReset();
  vi.restoreAllMocks();
});

describe('resolveFeishuOpenApiBaseUrl', () => {
  it('defaults to Feishu China OpenAPI', () => {
    expect(resolveFeishuOpenApiBaseUrl()).toBe('https://open.feishu.cn');
    expect(resolveFeishuOpenApiBaseUrl('feishu')).toBe('https://open.feishu.cn');
  });

  it('supports Lark global OpenAPI', () => {
    expect(resolveFeishuOpenApiBaseUrl('lark')).toBe('https://open.larksuite.com');
    expect(resolveFeishuOpenApiBaseUrl('larksuite')).toBe('https://open.larksuite.com');
  });

  it('accepts full custom OpenAPI base URLs', () => {
    expect(resolveFeishuOpenApiBaseUrl('https://open.example.com/')).toBe('https://open.example.com');
  });

  it('rejects unsupported domain aliases', () => {
    expect(() => resolveFeishuOpenApiBaseUrl('global')).toThrow('Invalid channels.feishu.domain');
  });
});

describe('buildFeishuClientConfig', () => {
  it('passes the resolved domain into SDK config', () => {
    expect(buildFeishuClientConfig({ appId: 'cli_test', appSecret: 'secret', domain: 'lark' })).toEqual({
      appId: 'cli_test',
      appSecret: 'secret',
      domain: 'https://open.larksuite.com',
    });
  });
});

describe('FeishuAdapter domain', () => {
  it('uses the configured Lark domain for raw REST APIs', async () => {
    const adapter = new FeishuAdapter({ appId: 'cli_test', appSecret: 'secret', domain: 'lark' });
    (adapter as any).client = {
      tokenManager: {
        getTenantAccessToken: async () => 'tenant-token',
      },
    };

    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await adapter.listChats();

    expect(urls).toEqual(['https://open.larksuite.com/open-apis/im/v1/chats']);
  });
});

describe('FeishuAdapter WebSocket client', () => {
  function mockLarkSdk() {
    const constructorArgs: any[] = [];
    const start = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();

    class MockClient {
      tokenManager = {
        getTenantAccessToken: vi.fn().mockRejectedValue(new Error('skip bot info fetch')),
      };
    }

    class MockWSClient {
      constructor(opts: any) {
        constructorArgs.push(opts);
      }
      start = start;
      close = close;
    }

    class MockEventDispatcher {
      register(events: Record<string, unknown>) {
        return { events };
      }
    }

    mockImportPeer.mockResolvedValue({
      Client: MockClient,
      WSClient: MockWSClient,
      EventDispatcher: MockEventDispatcher,
      LoggerLevel: { info: 'info' },
    });

    return { constructorArgs, start, close };
  }

  it('passes the default ping timeout through WSClient wsConfig', async () => {
    const sdk = mockLarkSdk();
    const adapter = new FeishuAdapter({ appId: 'cli_test', appSecret: 'secret' });

    await adapter.start(() => {});

    expect(sdk.constructorArgs).toHaveLength(1);
    expect(sdk.constructorArgs[0]).toMatchObject({
      appId: 'cli_test',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn',
      loggerLevel: 'info',
      wsConfig: { pingTimeout: 30 },
    });
    expect(sdk.constructorArgs[0].onReady).toEqual(expect.any(Function));
    expect(sdk.constructorArgs[0].onReconnecting).toEqual(expect.any(Function));
    expect(sdk.constructorArgs[0].onReconnected).toEqual(expect.any(Function));
    expect(sdk.constructorArgs[0].onError).toEqual(expect.any(Function));
    expect(sdk.start).toHaveBeenCalledOnce();
  });

  it('passes a configured ping timeout through WSClient wsConfig', async () => {
    const sdk = mockLarkSdk();
    const adapter = new FeishuAdapter({ appId: 'cli_test', appSecret: 'secret', pingTimeout: 45 });

    await adapter.start(() => {});

    expect(sdk.constructorArgs[0].wsConfig).toEqual({ pingTimeout: 45 });
  });

  it('closes the WSClient on stop', async () => {
    const sdk = mockLarkSdk();
    const adapter = new FeishuAdapter({ appId: 'cli_test', appSecret: 'secret' });

    await adapter.start(() => {});
    await adapter.stop();

    expect(sdk.close).toHaveBeenCalledOnce();
  });
});
