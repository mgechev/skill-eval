/**
 * Fetch latest models from Gemini API.
 */
export async function fetchLatestGeminiModel(apiKey: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Gemini API returned status ${res.status}`);
  }
  const data = await res.json() as any;
  if (!data.models || !Array.isArray(data.models)) {
    throw new Error('Invalid response from Gemini API models endpoint');
  }

  let filtered = data.models.filter((m: any) =>
    m.name &&
    m.supportedGenerationMethods &&
    m.supportedGenerationMethods.includes('generateContent') &&
    m.name.includes('gemini-') &&
    m.name.includes('-flash')
  );

  if (filtered.length === 0) {
    filtered = data.models.filter((m: any) =>
      m.name &&
      m.supportedGenerationMethods &&
      m.supportedGenerationMethods.includes('generateContent') &&
      m.name.includes('gemini-')
    );
  }

  const models = filtered
    .map((m: any) => {
      const cleanName = m.name.replace(/^models\//, '');
      const match = cleanName.match(/gemini-([\d.]+)-/);
      const version = match ? parseFloat(match[1]) : 0;
      return { name: cleanName, version };
    })
    .filter((m: any) => m.version > 0)
    .sort((a: any, b: any) => b.version - a.version);

  if (models.length > 0) {
    return models[0].name;
  }
  throw new Error('No suitable Gemini models found from the API');
}

/**
 * Fetch latest models from OpenAI API.
 */
export async function fetchLatestOpenAIModel(apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API returned status ${res.status}`);
  }
  const data = await res.json() as any;
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid response from OpenAI API models endpoint');
  }

  let filtered = data.data.filter((m: any) => {
    const id = m.id;
    const isSuitable = id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o2') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o5');
    const isFlashEquivalent = id.includes('mini') || id.includes('nano') || id.includes('flash');
    const isAuxiliary = id.includes('instruct') || id.includes('realtime') || id.includes('search') || id.includes('transcribe') || id.includes('tts') || id.includes('embedding') || id.includes('moderation') || id.includes('audio') || id.includes('vision');
    return isSuitable && isFlashEquivalent && !isAuxiliary;
  });

  if (filtered.length === 0) {
    filtered = data.data.filter((m: any) => {
      const id = m.id;
      const isSuitable = id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o2') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o5');
      const isAuxiliary = id.includes('instruct') || id.includes('realtime') || id.includes('search') || id.includes('transcribe') || id.includes('tts') || id.includes('embedding') || id.includes('moderation') || id.includes('audio') || id.includes('vision');
      return isSuitable && !isAuxiliary;
    });
  }

  const sorted = filtered.sort((a: any, b: any) => b.created - a.created);

  if (sorted.length > 0) {
    return sorted[0].id;
  }
  throw new Error('No suitable OpenAI models found from the API');
}

/**
 * Fetch latest models from Anthropic API.
 */
export async function fetchLatestAnthropicModel(apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API returned status ${res.status}`);
  }
  const data = await res.json() as any;
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid response from Anthropic API models endpoint');
  }

  let filtered = data.data.filter((m: any) => {
    const id = m.id;
    const isSuitable = id.startsWith('claude-');
    const isFlashEquivalent = id.includes('haiku') || id.includes('flash');
    const isAuxiliary = id.includes('search') || id.includes('embedding') || id.includes('moderation');
    return isSuitable && isFlashEquivalent && !isAuxiliary;
  });

  if (filtered.length === 0) {
    filtered = data.data.filter((m: any) => {
      const id = m.id;
      const isSuitable = id.startsWith('claude-');
      const isAuxiliary = id.includes('search') || id.includes('embedding') || id.includes('moderation');
      return isSuitable && !isAuxiliary;
    });
  }

  const sorted = filtered.sort((a: any, b: any) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return timeB - timeA;
  });

  if (sorted.length > 0) {
    return sorted[0].id;
  }
  throw new Error('No suitable Anthropic models found from the API');
}

/**
 * Resolve Gemini Model based on environment variables or dynamic lookup.
 */
export async function resolveGeminiModel(
  apiKey: string | undefined,
  env: Record<string, string | undefined> = process.env,
  context: 'init' | 'grader' = 'grader'
): Promise<string> {
  if (context === 'init') {
    if (env.INIT_GEMINI_MODEL) return env.INIT_GEMINI_MODEL;
  }
  if (env.GEMINI_MODEL) return env.GEMINI_MODEL;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Cannot dynamically resolve the latest Gemini model without an API key.');
  }

  return await fetchLatestGeminiModel(apiKey);
}

/**
 * Resolve Anthropic Model based on environment variables or dynamic lookup.
 */
export async function resolveAnthropicModel(
  apiKey: string | undefined,
  env: Record<string, string | undefined> = process.env,
  context: 'init' | 'grader' = 'grader'
): Promise<string> {
  if (context === 'init') {
    if (env.INIT_ANTHROPIC_MODEL) return env.INIT_ANTHROPIC_MODEL;
  }
  if (env.ANTHROPIC_MODEL) return env.ANTHROPIC_MODEL;

  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY. Cannot dynamically resolve the latest Anthropic model without an API key.');
  }

  return await fetchLatestAnthropicModel(apiKey);
}

/**
 * Resolve OpenAI Model based on environment variables or dynamic lookup.
 */
export async function resolveOpenAIModel(
  apiKey: string | undefined,
  env: Record<string, string | undefined> = process.env,
  context: 'init' | 'grader' = 'grader'
): Promise<string> {
  if (context === 'init') {
    if (env.INIT_OPENAI_MODEL) return env.INIT_OPENAI_MODEL;
  }
  if (env.OPENAI_MODEL) return env.OPENAI_MODEL;

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY. Cannot dynamically resolve the latest OpenAI model without an API key.');
  }

  return await fetchLatestOpenAIModel(apiKey);
}
