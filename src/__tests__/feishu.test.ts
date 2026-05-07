import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFeishuClientConfig, FeishuAdapter, resolveFeishuOpenApiBaseUrl } from '../channels/feishu.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
