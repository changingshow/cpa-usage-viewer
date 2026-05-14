export type Theme = 'white' | 'dark';

export interface ProviderKeyConfig {
  apiKey: string;
  prefix?: string;
  name?: string;
}

export type GeminiKeyConfig = ProviderKeyConfig;

export interface OpenAIApiKeyEntry {
  apiKey: string;
}

export interface OpenAIProviderConfig {
  name?: string;
  prefix?: string;
  apiKeyEntries?: OpenAIApiKeyEntry[];
}
