import { describe, it, expect, vi } from 'vitest';
import { buildStoredModelConfig } from './model-config-shared';

describe('buildStoredModelConfig', () => {
  it('encrypts the api key and never stores it in plaintext', () => {
    const encrypt = vi.fn().mockReturnValue('iv:tag:ct');
    const out = buildStoredModelConfig(
      { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-secret' },
      encrypt,
    );
    expect(encrypt).toHaveBeenCalledWith({ apiKey: 'sk-secret' });
    expect(out).toEqual({
      provider: 'anthropic',
      model: 'claude-x',
      baseUrl: undefined,
      apiKeyEncrypted: 'iv:tag:ct',
    });
    // Integrity: the raw key must not appear anywhere in what gets persisted.
    expect(JSON.stringify(out)).not.toContain('sk-secret');
  });

  it('omits apiKeyEncrypted when no key is given (e.g. Ollama)', () => {
    const encrypt = vi.fn();
    const out = buildStoredModelConfig(
      { provider: 'ollama', model: 'qwen2.5-coder', baseUrl: 'http://localhost:11434' },
      encrypt,
    );
    expect(encrypt).not.toHaveBeenCalled();
    expect(out.apiKeyEncrypted).toBeUndefined();
  });

  it('trims blank optional fields to undefined', () => {
    const out = buildStoredModelConfig(
      { provider: 'gemini', model: '  ', baseUrl: '', apiKey: '   ' },
      () => 'x',
    );
    expect(out.model).toBeUndefined();
    expect(out.baseUrl).toBeUndefined();
    expect(out.apiKeyEncrypted).toBeUndefined();
  });

  it('throws on an unsupported provider', () => {
    expect(() => buildStoredModelConfig({ provider: 'openai' }, () => 'x')).toThrow(
      'Unsupported provider',
    );
  });
});
