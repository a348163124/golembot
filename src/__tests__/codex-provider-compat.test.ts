import { describe, expect, it } from 'vitest';
import { assessCodexProviderCompatibility, codexProviderWarningFingerprint } from '../codex-provider-compat.js';

describe('assessCodexProviderCompatibility', () => {
  it('returns undefined when no custom provider routing is configured', () => {
    expect(assessCodexProviderCompatibility(undefined)).toBeUndefined();
    expect(assessCodexProviderCompatibility({ apiKey: 'test-key' })).toBeUndefined();
  });

  it('flags chat completions endpoints as likely incompatible', () => {
    expect(
      assessCodexProviderCompatibility({
        baseUrl: 'https://example.com/v1/chat/completions',
      }),
    ).toMatchObject({
      likelyIncompatible: true,
      detail: expect.stringContaining('/chat/completions'),
    });
  });

  it('flags Anthropic-style endpoints as likely incompatible', () => {
    expect(
      assessCodexProviderCompatibility({
        baseUrl: 'https://api.anthropic.com/v1/messages',
      }),
    ).toMatchObject({
      likelyIncompatible: true,
      detail: expect.stringContaining('Anthropic-compatible'),
    });
  });

  it('accepts explicit Codex Responses mode as guidance-only', () => {
    expect(
      assessCodexProviderCompatibility({
        codexProviderId: 'minimax',
        codexWireApi: 'responses',
      }),
    ).toMatchObject({
      likelyIncompatible: false,
      detail: expect.stringContaining('codexWireApi=responses'),
    });
  });
});

describe('codexProviderWarningFingerprint', () => {
  it('includes the fields that affect warning deduplication', () => {
    expect(
      codexProviderWarningFingerprint({
        baseUrl: 'https://openrouter.ai/api/v1',
        codexProfile: 'custom',
        codexProviderId: 'openrouter',
        codexWireApi: 'responses',
      }),
    ).toBe(
      JSON.stringify({
        baseUrl: 'https://openrouter.ai/api/v1',
        codexProfile: 'custom',
        codexProviderId: 'openrouter',
        codexWireApi: 'responses',
      }),
    );
  });
});
