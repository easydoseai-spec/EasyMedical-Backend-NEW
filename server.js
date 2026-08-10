const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { URLSearchParams } = require('url');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// File-based token storage (survives container restarts on Railway)
const TOKEN_FILE = path.join('/tmp', 'epic_tokens.json');

const getTokenStorage = () => {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading token file:', error);
  }
  return {};
};

const saveTokenStorage = (tokens) => {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing token file:', error);
  }
};

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

// Epic OAuth authorize - returns HTML that redirects to Epic's OAuth endpoint
app.get('/api/auth/epic/authorize', (req, res) => {
  try {
    const EPIC_OAUTH_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize';
    const state = Math.random().toString(36).substring(7);

    const params = new URLSearchParams();
    params.append('client_id', process.env.EPIC_CLIENT_ID || '');
    params.append('response_type', 'code');
    params.append('redirect_uri', `${process.env.BACKEND_URL || 'https://easymedical-backend-new-production.up.railway.app'}/api/auth/epic/callback`);
    params.append('scope', 'openid fhirUser patient/Patient.read patient/Medication.read patient/Observation.read patient/Procedure.read patient/DiagnosticReport.read');
    params.append('state', state);

    console.log('✅ Authorization URL generated with state:', state);
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
    const accessToken = tokenData.access_token;

    // Store token with state as key (file-based, survives restarts)
    const tokens = getTokenStorage();
    tokens[state] = {
      token: accessToken,
      tokenData: tokenData,
      timestamp: Date.now(),
    };
    saveTokenStorage(tokens);

    console.log('✅ Token stored with state:', state);

    // Return HTML success page
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorization Successful</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .container { text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #007AFF; margin: 0; }
          p { color: #666; margin: 12px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ Authorization Successful!</h1>
          <p>Your Epic account has been connected.</p>
          <p>You can now close this window and return to the app.</p>
        </div>
      </body>
      </html>
    `;

    res.status(200).send(html);
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get Epic token by state
app.get('/api/auth/epic/token/:state', (req, res) => {
  try {
    const { state } = req.params;
    console.log('🔍 Retrieving token for state:', state);

    if (!state) {
      return res.status(400).json({ error: 'State parameter is required' });
    }

    const tokens = getTokenStorage();
    const tokenEntry = tokens[state];

    if (!tokenEntry) {
      console.log('❌ Token not found for state:', state);
      return res.status(404).json({ error: 'Token not found or expired' });
    }

    // Check if token has expired (5 minutes)
    if (Date.now() - tokenEntry.timestamp > 5 * 60 * 1000) {
      console.log('❌ Token expired for state:', state);
      delete tokens[state];
      saveTokenStorage(tokens);
      return res.status(410).json({ error: 'Token expired' });
    }

    console.log('✅ Token retrieved successfully');
    res.json({
      access_token: tokenEntry.token,
      token_type: tokenEntry.tokenData.token_type,
      expires_in: tokenEntry.tokenData.expires_in,
      scope: tokenEntry.tokenData.scope,
    });

    // Clean up token after retrieval
    delete tokens[state];
    saveTokenStorage(tokens);
  } catch (error) {
    console.error('Error retrieving token:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    const { images, recordType } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'At least one image is required' });
    }

    const isLab = recordType === 'lab';

    // Build content array with all images
    const content = [];
    images.forEach((image) => {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: image,
        },
      });
    });

    // Add different prompts based on record type
    let prompt;
    if (isLab) {
      prompt = `Please analyze these lab results and extract structured information including:
- Test name(s)
- All values and measurements
- Units
- Reference ranges
- Status (normal/abnormal)
- Any concerning findings

Format as a detailed technical summary.`;
    } else {
      prompt = `Please analyze these medical records and provide:
1. A short title (2-4 words) that summarizes the visit/record
2. A one-paragraph summary of the visit/findings
3. Key points or concerns identified

Format as:
TITLE: [title]
SUMMARY: [one paragraph summary]
KEY POINTS: [bullet points]`;
    }

    content.push({
      type: 'text',
      text: prompt,
    });

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: isLab ? 1000 : 500,
      messages: [
        {
          role: 'user',
          content: content,
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
      recordType: recordType,
    });
  } catch (error) {
    console.error('Record analysis error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Fetch patient data from Epic using the app's access token
app.post('/api/auth/epic/patient-data', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token required' });
    }

    console.log('📥 Fetching patient data from Epic...');

    // Decode JWT to get patient ID from fhirUser claim
    let patientId = null;
    try {
      const parts = accessToken.split('.');
      if (parts.length === 3) {
        const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        console.log('Token decoded:', JSON.stringify(decoded, null, 2));
        if (decoded.fhirUser) {
          // fhirUser is typically "Patient/12345"
          patientId = decoded.fhirUser.split('/')[1];
          console.log('Extracted patient ID from fhirUser:', patientId);
        } else {
          console.warn('⚠️ No fhirUser claim found in token. Trying queries without patient filter.');
        }
      }
    } catch (e) {
      console.warn('Could not decode token:', e.message);
    }

    const FHIR_SERVER_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/fhir+json',
    };

    // Fetch patient data in parallel
    // With patient/ scopes, Epic automatically filters to authenticated patient - no need for patient parameter
    const patientQuery = `${FHIR_SERVER_URL}/Patient?_count=1`;
    const medQuery = `${FHIR_SERVER_URL}/Medication?_count=100`;
    const obsQuery = `${FHIR_SERVER_URL}/Observation?_count=100`;
    const procQuery = `${FHIR_SERVER_URL}/Procedure?_count=100`;
    const diagQuery = `${FHIR_SERVER_URL}/DiagnosticReport?_count=100`;

    console.log('Query URLs:', { patientQuery, medQuery, obsQuery, procQuery, diagQuery });

    const [patientRes, medicationsRes, observationsRes, proceduresRes, diagnosticsRes] = await Promise.all([
      fetch(patientQuery, { headers }).catch(e => {
        console.warn('Failed to fetch Patient:', e);
        return null;
      }),
      fetch(medQuery, { headers }).catch(e => {
        console.warn('Failed to fetch Medication:', e);
        return null;
      }),
      fetch(obsQuery, { headers }).catch(e => {
        console.warn('Failed to fetch Observation:', e);
        return null;
      }),
      fetch(procQuery, { headers }).catch(e => {
        console.warn('Failed to fetch Procedure:', e);
        return null;
      }),
      fetch(diagQuery, { headers }).catch(e => {
        console.warn('Failed to fetch DiagnosticReport:', e);
        return null;
      }),
    ]);

    // Extract data from responses
    let patientData = null;
    let medications = [];
    let observations = [];
    let procedures = [];
    let diagnostics = [];

    if (patientRes?.ok) {
      const patientJson = await patientRes.json();
      // Handle both direct resource (when querying by ID) and bundle (when searching)
      if (patientJson.resourceType === 'Patient') {
        patientData = patientJson;
      } else if (patientJson.entry?.length > 0) {
        patientData = patientJson.entry[0].resource;
      }
    } else if (patientRes) {
      const errorText = await patientRes.text();
      console.log(`Patient query failed with ${patientRes.status}:`, errorText);
    }

    if (medicationsRes?.ok) {
      const medBundle = await medicationsRes.json();
      console.log('Medication bundle:', JSON.stringify(medBundle, null, 2));
      medications = medBundle.entry?.map(e => e.resource) || [];
    } else {
      console.log('Medication failed:', medicationsRes?.status);
    }

    if (observationsRes?.ok) {
      const obsBundle = await observationsRes.json();
      console.log('Observation bundle:', JSON.stringify(obsBundle, null, 2));
      observations = obsBundle.entry?.map(e => e.resource) || [];
    } else {
      console.log('Observation failed:', observationsRes?.status);
    }

    if (proceduresRes?.ok) {
      const procBundle = await proceduresRes.json();
      console.log('Procedure bundle:', JSON.stringify(procBundle, null, 2));
      procedures = procBundle.entry?.map(e => e.resource) || [];
    } else {
      console.log('Procedure failed:', proceduresRes?.status);
    }

    if (diagnosticsRes?.ok) {
      const diagBundle = await diagnosticsRes.json();
      console.log('DiagnosticReport bundle:', JSON.stringify(diagBundle, null, 2));
      diagnostics = diagBundle.entry?.map(e => e.resource) || [];
    } else {
      console.log('DiagnosticReport failed:', diagnosticsRes?.status);
    }

    console.log(`✅ Fetched Epic data:
      - Patient: ${patientData?.name?.[0]?.given?.[0] || 'Unknown'}
      - Medications: ${medications.length}
      - Observations: ${observations.length}
      - Procedures: ${procedures.length}
      - Diagnostics: ${diagnostics.length}`);

    res.json({
      patient: patientData,
      medications,
      observations,
      procedures,
      diagnostics,
    });
  } catch (error) {
    console.error('❌ Error fetching patient data:', error);
    res.status(500).json({ error: 'Failed to fetch patient data', details: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'EasyMedical Backend API', routes: ['/api/chat', '/api/auth/epic/authorize', '/api/auth/epic/callback', '/api/auth/epic/patient-data', '/api/vision/analyze-medication', '/api/vision/analyze-document', '/api/vision/analyze-record'] });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
