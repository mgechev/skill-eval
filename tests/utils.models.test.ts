import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLatestGeminiModel,
  fetchLatestOpenAIModel,
  fetchLatestAnthropicModel,
  resolveGeminiModel,
  resolveAnthropicModel,
  resolveOpenAIModel,
} from '../src/utils/models';

describe('models utility', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = vi.fn();
    // Clear relevant environment variables
    delete process.env.GEMINI_MODEL;
    delete process.env.INIT_GEMINI_MODEL;
    delete process.env.OPENAI_MODEL;
    delete process.env.INIT_OPENAI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.INIT_ANTHROPIC_MODEL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe('fetchLatestGeminiModel', () => {
    it('returns the highest version of flash models', async () => {
      const mockResponse = {
        models: [
          {
            name: 'models/gemini-1.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.0-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.5-pro',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const model = await fetchLatestGeminiModel('mock-key');
      expect(model).toBe('gemini-2.5-flash');
    });

    it('falls back to other models if no flash model is found', async () => {
      const mockResponse = {
        models: [
          {
            name: 'models/gemini-2.0-pro',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const model = await fetchLatestGeminiModel('mock-key');
      expect(model).toBe('gemini-2.0-pro');
    });

    it('throws error if fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      await expect(fetchLatestGeminiModel('mock-key')).rejects.toThrow('Network error');
    });

    it('throws error if no suitable models found', async () => {
      const mockResponse = {
        models: [],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);
      await expect(fetchLatestGeminiModel('mock-key')).rejects.toThrow('No suitable Gemini models found');
    });
  });

  describe('fetchLatestOpenAIModel', () => {
    it('returns the newest flash-equivalent mini model', async () => {
      const mockResponse = {
        data: [
          { id: 'gpt-4o', created: 1000 },
          { id: 'gpt-4o-mini', created: 2000 },
          { id: 'gpt-5.4-mini', created: 3000 },
          { id: 'gpt-5.4-nano', created: 2500 },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const model = await fetchLatestOpenAIModel('mock-key');
      expect(model).toBe('gpt-5.4-mini');
    });

    it('falls back to other chat models if no mini model is found', async () => {
      const mockResponse = {
        data: [
          { id: 'gpt-4o', created: 1000 },
          { id: 'gpt-5.0', created: 3000 },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const model = await fetchLatestOpenAIModel('mock-key');
      expect(model).toBe('gpt-5.0');
    });

    it('throws error if fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      await expect(fetchLatestOpenAIModel('mock-key')).rejects.toThrow('Network error');
    });

    it('throws error if no suitable models found', async () => {
      const mockResponse = {
        data: [],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);
      await expect(fetchLatestOpenAIModel('mock-key')).rejects.toThrow('No suitable OpenAI models found');
    });
  });

  describe('fetchLatestAnthropicModel', () => {
    it('returns the newest haiku model', async () => {
      const mockResponse = {
        data: [
          { id: 'claude-3-5-sonnet', created_at: '2024-06-20T00:00:00Z' },
          { id: 'claude-3-5-haiku-20241022', created_at: '2024-10-22T00:00:00Z' },
          { id: 'claude-haiku-4-5', created_at: '2025-10-15T00:00:00Z' },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const model = await fetchLatestAnthropicModel('mock-key');
      expect(model).toBe('claude-haiku-4-5');
    });

    it('falls back to other Claude models if no haiku model is found', async () => {
      const mockResponse = {
        data: [
          { id: 'claude-3-5-sonnet', created_at: '2024-06-20T00:00:00Z' },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const model = await fetchLatestAnthropicModel('mock-key');
      expect(model).toBe('claude-3-5-sonnet');
    });

    it('throws error if fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      await expect(fetchLatestAnthropicModel('mock-key')).rejects.toThrow('Network error');
    });

    it('throws error if no suitable models found', async () => {
      const mockResponse = {
        data: [],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);
      await expect(fetchLatestAnthropicModel('mock-key')).rejects.toThrow('No suitable Anthropic models found');
    });
  });

  describe('resolution logic', () => {
    it('resolves using environment variable when set', async () => {
      process.env.GEMINI_MODEL = 'custom-gemini';
      process.env.INIT_GEMINI_MODEL = 'custom-init-gemini';

      // Grader context
      let resolved = await resolveGeminiModel('key');
      expect(resolved).toBe('custom-gemini');

      // Init context
      resolved = await resolveGeminiModel('key', process.env, 'init');
      expect(resolved).toBe('custom-init-gemini');
    });

    it('resolves using general env var in init context if init env var not set', async () => {
      process.env.GEMINI_MODEL = 'custom-gemini';

      const resolved = await resolveGeminiModel('key', process.env, 'init');
      expect(resolved).toBe('custom-gemini');
    });

    it('resolves via dynamic lookup when no env var is set', async () => {
      const mockResponse = {
        models: [
          {
            name: 'models/gemini-2.0-flash',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const resolved = await resolveGeminiModel('key');
      expect(resolved).toBe('gemini-2.0-flash');
    });

    it('throws error when both env and dynamic lookup fail', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      await expect(resolveGeminiModel('key')).rejects.toThrow('Network error');
    });

    it('throws error if no API key is provided and no env vars set', async () => {
      await expect(resolveGeminiModel(undefined)).rejects.toThrow('Missing GEMINI_API_KEY');
    });

    it('resolves Anthropic correctly', async () => {
      process.env.ANTHROPIC_MODEL = 'env-claude';
      let resolved = await resolveAnthropicModel(undefined);
      expect(resolved).toBe('env-claude');

      process.env.INIT_ANTHROPIC_MODEL = 'init-claude';
      resolved = await resolveAnthropicModel(undefined, process.env, 'init');
      expect(resolved).toBe('init-claude');
    });

    it('resolves OpenAI correctly', async () => {
      process.env.OPENAI_MODEL = 'env-openai';
      let resolved = await resolveOpenAIModel(undefined);
      expect(resolved).toBe('env-openai');

      process.env.INIT_OPENAI_MODEL = 'init-openai';
      resolved = await resolveOpenAIModel(undefined, process.env, 'init');
      expect(resolved).toBe('init-openai');
    });
  });
});
