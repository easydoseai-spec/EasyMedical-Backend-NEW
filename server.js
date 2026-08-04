const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { URLSearchParams } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: messages,
    });

    const assistantMessage = response.content[0];
    if (assistantMessage.type !== 'text') {
      return res.status(500).json({ error: 'Unexpected response type' });
    }

    res.json({ content: assistantMessage.text, usage: response.usage });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Epic OAuth authorize
app.get('/api/auth/epic/authorize', (req, res) => {
  try {
    const EPIC_OAUTH_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize';
    const state = Math.random().toString(36).substring(7);

    const params = new URLSearchParams();
    params.append('client_id', process.env.EPIC_CLIENT_ID || '');
    params.append('response_type', 'code');
    params.append('redirect_uri', `${process.env.BACKEND_URL || 'https://easymedical-backend.vercel.app'}/api/auth/epic/callback`);
    params.append('scope', 'openid fhirUser patient/Patient.read patient/MedicationRequest.read');
    params.append('state', state);

    res.setHeader('Set-Cookie', `epic_oauth_state=${state}; Path=/; HttpOnly; SameSite=Strict`);
    res.redirect(302, `${EPIC_OAUTH_URL}?${params.toString()}`);
  } catch (error) {
    console.error('OAuth error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

// Epic OAuth callback
app.get('/api/auth/epic/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', `${process.env.BACKEND_URL || 'https://easymedical-backend.vercel.app'}/api/auth/epic/callback`);
    params.append('client_id', process.env.EPIC_CLIENT_ID || '');
    params.append('client_secret', process.env.EPIC_CLIENT_SECRET || '');

    const tokenResponse = await fetch(EPIC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenResponse.ok) {
      return res.status(400).json({ error: 'Failed to exchange code' });
    }

    const tokenData = await tokenResponse.json();
    const redirectUrl = `easymedical://auth?token=${encodeURIComponent(tokenData.access_token)}`;
    res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'EasyMedical Backend API', routes: ['/api/chat', '/api/auth/epic/authorize', '/api/auth/epic/callback'] });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
