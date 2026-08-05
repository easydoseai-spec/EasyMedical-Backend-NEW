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
      max_tokens: 300,
      system: 'You are a health education assistant. Provide concise, clear health information (2-3 sentences max). Use plain text only - no markdown formatting, no #, **, -, or bullet points. Be helpful but remind users this is educational information only and not a substitute for professional medical advice.',
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
    console.log('Callback received with code:', code ? 'yes' : 'no', 'state:', state ? 'yes' : 'no');

    if (!code || !state) {
      console.error('Missing code or state');
      return res.status(400).json({ error: 'Missing code or state' });
    }

    const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
    const redirectUri = `${process.env.BACKEND_URL || 'https://easymedical-backend.vercel.app'}/api/auth/epic/callback`;

    console.log('Exchanging code for token...');
    console.log('Redirect URI:', redirectUri);
    console.log('Client ID:', process.env.EPIC_CLIENT_ID ? 'set' : 'NOT SET');
    console.log('Client Secret:', process.env.EPIC_CLIENT_SECRET ? 'set' : 'NOT SET');

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    params.append('client_id', process.env.EPIC_CLIENT_ID || '');
    params.append('client_secret', process.env.EPIC_CLIENT_SECRET || '');

    const tokenResponse = await fetch(EPIC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    console.log('Epic response status:', tokenResponse.status);
    const responseText = await tokenResponse.text();
    console.log('Epic response:', responseText);

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', responseText);
      return res.status(400).json({ error: 'Failed to exchange code', details: responseText });
    }

    const tokenData = JSON.parse(responseText);
    const redirectUrl = `easymedical://auth?token=${encodeURIComponent(tokenData.access_token)}`;
    console.log('Token exchange successful, redirecting to app');
    res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Vision analysis endpoints
app.post('/api/vision/analyze-medication', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image is required' });
    }

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: 'Please analyze this medication bottle and extract the following information in JSON format: { "name": "medication name", "dosage": "dosage amount", "frequency": "how often to take", "directions": "directions for use", "warnings": "any warnings or side effects noted" }. Be precise and only include information visible on the label.',
            },
          ],
        },
      ],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return res.status(500).json({ error: 'Unexpected response type' });
    }

    // Try to parse JSON from response
    let analysisData;
    try {
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      analysisData = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: textContent.text };
    } catch {
      analysisData = { raw: textContent.text };
    }

    res.json({
      success: true,
      analysis: analysisData,
      rawResponse: textContent.text,
    });
  } catch (error) {
    console.error('Medication analysis error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/vision/analyze-document', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image is required' });
    }

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: 'Please analyze this medical document and extract key information. Provide a structured summary including: type of document (prescription, test result, lab report, etc.), date, key findings/medications, and any important notes or results.',
            },
          ],
        },
      ],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return res.status(500).json({ error: 'Unexpected response type' });
    }

    res.json({
      success: true,
      analysis: textContent.text,
    });
  } catch (error) {
    console.error('Document analysis error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/vision/analyze-record', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image is required' });
    }

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: 'Please analyze this health record/result and extract key information. Provide a clear summary including: what type of record this is, important values or measurements, reference ranges if shown, and any abnormal findings or concerns.',
            },
          ],
        },
      ],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return res.status(500).json({ error: 'Unexpected response type' });
    }

    res.json({
      success: true,
      analysis: textContent.text,
    });
  } catch (error) {
    console.error('Record analysis error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'EasyMedical Backend API', routes: ['/api/chat', '/api/auth/epic/authorize', '/api/auth/epic/callback', '/api/vision/analyze-medication', '/api/vision/analyze-document', '/api/vision/analyze-record'] });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
