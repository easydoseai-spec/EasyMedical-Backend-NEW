import Anthropic from '@anthropic-ai/sdk';
import { VercelRequest, VercelResponse } from '@vercel/node';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: messages,
    });

    const assistantMessage = response.content[0];

    if (assistantMessage.type !== 'text') {
      return res.status(500).json({ error: 'Unexpected response type' });
    }

    return res.status(200).json({
      content: assistantMessage.text,
      usage: response.usage,
    });
  } catch (error) {
    console.error('Chatbot API error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
