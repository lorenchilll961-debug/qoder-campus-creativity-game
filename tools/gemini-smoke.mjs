import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error('Set GEMINI_API_KEY in your environment or .env.local before running this test.');
  process.exit(1);
}

const client = new GoogleGenAI({ apiKey });
const interaction = await client.interactions.create({
  model: process.env.GEMINI_MODEL || 'gemini-4-hydrogen',
  input: 'Explain how AI works in one short sentence.',
  store: false,
}, { maxRetries: 0, timeout: 60_000 });

console.log(interaction.output_text);
