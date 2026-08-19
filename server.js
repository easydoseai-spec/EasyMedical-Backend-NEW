const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { URLSearchParams } = require('url');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Increase payload limit for image uploads (default is 100KB, we need 50MB+)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
    const { messages, hasMedicalContext } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    let systemPrompt = 'You are a health education assistant. Provide concise, clear health information (2-3 sentences max). Use plain text only - no markdown formatting, no #, **, -, or bullet points. Be helpful but remind users this is educational information only and not a substitute for professional medical advice.';

    // If medical context is provided, use a more personalized prompt
    if (hasMedicalContext) {
      systemPrompt = 'You are a health education assistant with access to the patient\'s medical records. Answer questions by referencing their specific records when relevant. Provide concise, clear health information (2-3 sentences max). Use plain text only - no markdown formatting, no #, **, -, or bullet points. Be helpful but remind users this is educational information only and not a substitute for professional medical advice. Always encourage the patient to discuss findings with their healthcare provider.';
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
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

// Epic OAuth authorize - returns authorization URL and state
app.get('/api/auth/epic/authorize', (req, res) => {
  try {
    const EPIC_OAUTH_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize';
    const state = Math.random().toString(36).substring(7);
    const redirectUri = `${process.env.BACKEND_URL || 'https://easymedical-backend-new-production.up.railway.app'}/api/auth/epic/callback`;

    const params = new URLSearchParams();
    params.append('client_id', process.env.EPIC_CLIENT_ID || '');
    params.append('response_type', 'code');
    params.append('redirect_uri', redirectUri);
    params.append('scope', 'openid fhirUser patient/Patient.read patient/Medication.read patient/Observation.read patient/Procedure.read patient/DiagnosticReport.read');
    params.append('state', state);

    const authUrl = `${EPIC_OAUTH_URL}?${params.toString()}`;
    console.log('✅ Authorization URL generated with state:', state);
    console.log('   Redirect URI:', redirectUri);
    console.log('   BACKEND_URL env:', process.env.BACKEND_URL || 'NOT SET (using default)');

    // Return both URL and state so frontend can manage the flow
    res.json({
      url: authUrl,
      state: state,
    });
  } catch (error) {
    console.error('OAuth error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

// Track processed authorization codes to prevent reuse
const processedCodes = new Set();

// Epic OAuth callback
app.get('/api/auth/epic/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    console.log('Callback received with code:', code ? 'yes' : 'no', 'state:', state ? 'yes' : 'no');

    if (!code || !state) {
      console.error('Missing code or state');
      return res.status(400).json({ error: 'Missing code or state' });
    }

    // Prevent authorization code reuse
    if (processedCodes.has(code)) {
      console.warn('⚠️ Authorization code already processed:', code.substring(0, 20) + '...');
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Already Processed</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #007AFF; margin: 0; }
            p { color: #666; margin: 12px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Already Authorized</h1>
            <p>Your Epic account has already been connected.</p>
            <p>You can close this window and return to the app.</p>
          </div>
        </body>
        </html>
      `);
    }

    processedCodes.add(code);

    const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
    const redirectUri = `${process.env.BACKEND_URL || 'https://easymedical-backend-new-production.up.railway.app'}/api/auth/epic/callback`;

    console.log('Exchanging code for token...');
    console.log('Redirect URI:', redirectUri);
    console.log('BACKEND_URL env var:', process.env.BACKEND_URL || 'NOT SET (using default)');
    console.log('Client ID (first 20 chars):', process.env.EPIC_CLIENT_ID ? process.env.EPIC_CLIENT_ID.substring(0, 20) + '...' : 'NOT SET');
    console.log('Client Secret (first 10 chars):', process.env.EPIC_CLIENT_SECRET ? process.env.EPIC_CLIENT_SECRET.substring(0, 10) + '...' : 'NOT SET');
    console.log('Authorization code (first 20 chars):', code ? code.substring(0, 20) + '...' : 'MISSING');
    console.log('State:', state);

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
    const idToken = tokenData.id_token;

    // Extract patient ID from response or id_token
    let patientId = null;
    if (tokenData.patient) {
      patientId = tokenData.patient;
      console.log('✅ Patient ID from response:', patientId);
    } else if (idToken) {
      try {
        const parts = idToken.split('.');
        if (parts.length === 3) {
          const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (decoded.fhirUser) {
            patientId = decoded.fhirUser.split('/').pop();
            console.log('✅ Patient ID from id_token fhirUser:', patientId);
          }
        }
      } catch (e) {
        console.warn('Could not decode id_token:', e.message);
      }
    }

    // Store token with state as key (file-based, survives restarts)
    const tokens = getTokenStorage();
    tokens[state] = {
      token: accessToken,
      tokenData: tokenData,
      patientId: patientId,
      timestamp: Date.now(),
    };
    saveTokenStorage(tokens);

    console.log('✅ Token stored with state:', state);
    console.log('   Patient ID stored:', patientId || 'Not available');

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
      patient: tokenEntry.patientId,
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
      prompt = `CRITICAL: Extract EVERY SINGLE lab test from this LabCorp report. There are typically 14+ tests in the CMP and 5+ in the Lipid Panel. DO NOT STOP until you've found them all.

Step 1: Find and extract the DATE COLLECTED
Step 2: Extract EVERY test from the Comp. Metabolic Panel table (look for rows with: Glucose, BUN, Creatinine, eGFR, Sodium, Potassium, Chloride, Calcium, Protein, Albumin, Globulin, Bilirubin, Phosphatase, AST, ALT, etc.)
Step 3: Extract EVERY test from the Lipid Panel table (look for: Cholesterol, Triglycerides, HDL, VLDL, LDL)
Step 4: Verify you found at least 14 CMP tests and 5 Lipid Panel tests (20+ total)

OUTPUT FORMAT:
Date Collected: MM/DD/YYYY
TEST_COUNT: XX (e.g., "TEST_COUNT: 22")
Glucose: 98 (70-99)
BUN: 18 (6-20)
Creatinine: 0.98 (0.76-1.27)
eGFR: 106 (>59)
BUN/Creatinine Ratio: 18 (9-20)
Sodium: 141 (134-144)
Potassium: 4.8 (3.5-5.2)
Chloride: 104 (96-106)
Carbon Dioxide, Total: 23 (20-29)
Calcium: 10.0 (8.7-10.2)
Protein, Total: 7.0 (6.0-8.5)
Albumin: 4.7 (4.3-5.2)
Globulin, Total: 2.3 (1.5-4.5)
Bilirubin, Total: 0.3 (0.0-1.2)
Alkaline Phosphatase: 57 (44-121)
AST (SGOT): 29 (0-40)
ALT (SGPT): 35 (0-44)
Cholesterol, Total: 215 (100-199)
Triglycerides: 104 (0-149)
HDL Cholesterol: 55 (>39)
VLDL Cholesterol: 18 (5-40)
LDL Chol Calc (NIH): 142 (0-99)

MUST HAVES:
- Always start with Date Collected
- Always include TEST_COUNT showing total tests extracted
- READ EVERY TABLE ROW COMPLETELY
- Do not stop after CMP - continue to Lipid Panel
- For each test: Name: Value (Reference Range)
- Reference ranges from the "Reference Interval" column
- Return at least 20 total tests
- If you find fewer than 15 tests, re-read the entire image again before responding`;
    } else {
      prompt = `CRITICAL: Extract EXACTLY this information from the medical record:

1. APPOINTMENT DATE: The date when the appointment/visit happened (MM/DD/YYYY format)
2. DOCTOR: The doctor's or provider's full name
3. REASON: Summarize the visit reason in exactly 3 words
4. SUMMARY: One paragraph summary of the visit/findings

Return in this EXACT format:
APPOINTMENT DATE: MM/DD/YYYY
DOCTOR: [name]
REASON: [3 words]
SUMMARY: [paragraph]
KEY POINTS: [list]

EXAMPLE:
APPOINTMENT DATE: 01/15/2026
DOCTOR: Dr. John Smith
REASON: Established patient visit
SUMMARY: 45-year-old male came for routine check-up. Vital signs normal. Patient reports no acute complaints.
KEY POINTS:
- Blood pressure: 120/80 (normal)
- Weight: stable
- No new medical concerns

Make sure to find and include the appointment date from the document header or top of the record.`;
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
    const { accessToken, patientId: providedPatientId } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token required' });
    }

    console.log('📥 Fetching patient data from Epic...');

    // Use provided patient ID or decode JWT to get patient ID from fhirUser or sub claim
    let patientId = providedPatientId || null;

    if (patientId) {
      console.log('✅ Using provided patient ID:', patientId);
    } else {
      // Only decode token if we don't have a provided patient ID
      try {
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          console.log('Token decoded:', JSON.stringify(decoded, null, 2));
          if (decoded.fhirUser) {
            // fhirUser is typically "Patient/12345"
            patientId = decoded.fhirUser.split('/')[1];
            console.log('✅ Extracted patient ID from fhirUser:', patientId);
          } else if (decoded.sub) {
            // Fallback to sub claim if fhirUser not available
            console.warn('⚠️ No fhirUser claim, using sub as patient ID:', decoded.sub);
            patientId = decoded.sub;
          } else {
            console.warn('⚠️ No fhirUser or sub claim found in token. Trying queries without patient filter.');
          }
        }
      } catch (e) {
        console.warn('Could not decode token:', e.message);
      }
    }

    const FHIR_SERVER_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/fhir+json',
      'Accept': 'application/fhir+json',
    };

    console.log('Making FHIR requests with headers:', {
      Authorization: 'Bearer ' + accessToken.substring(0, 30) + '...',
      'Content-Type': headers['Content-Type'],
      'Accept': headers['Accept'],
    });

    // Fetch patient data in parallel
    // Use patient ID from token if available, otherwise use queries without filter
    const patientQuery = patientId
      ? `${FHIR_SERVER_URL}/Patient/${patientId}`
      : `${FHIR_SERVER_URL}/Patient?_count=1`;

    const medQuery = patientId
      ? `${FHIR_SERVER_URL}/MedicationRequest?patient=${patientId}&status=active`
      : `${FHIR_SERVER_URL}/MedicationRequest?status=active`;

    const obsQuery = patientId
      ? `${FHIR_SERVER_URL}/Observation?patient=${patientId}&category=laboratory&_count=100`
      : `${FHIR_SERVER_URL}/Observation?category=laboratory&_count=100`;

    const procQuery = patientId
      ? `${FHIR_SERVER_URL}/Procedure?patient=${patientId}&_count=100`
      : `${FHIR_SERVER_URL}/Procedure?_count=100`;

    const diagQuery = patientId
      ? `${FHIR_SERVER_URL}/DiagnosticReport?patient=${patientId}&_count=100`
      : `${FHIR_SERVER_URL}/DiagnosticReport?_count=100`;

    console.log('Query URLs:', { patientQuery, medQuery, obsQuery, procQuery, diagQuery });
    console.log('Using patient ID:', patientId || 'None - using global queries');

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
      try {
        const medBundle = await medicationsRes.json();
        console.log('Medication bundle entries:', medBundle.entry?.length || 0);
        medications = medBundle.entry?.map(e => e.resource) || [];
      } catch (e) {
        console.error('❌ Failed to parse Medication response:', e.message);
      }
    } else if (medicationsRes) {
      const errorText = await medicationsRes.text();
      console.log(`❌ Medication query failed with ${medicationsRes.status}`);
      if (medicationsRes.status === 403) {
        console.log('   ⚠️ Access denied (403) - The access token may not have permission for Medications');
      }
      console.log('   Error body:', errorText.substring(0, 300));
      console.log('   Query URL:', medQuery);
      console.log('   Authorization header:', headers.Authorization ? 'Present' : 'Missing');
    }

    if (observationsRes?.ok) {
      const obsBundle = await observationsRes.json();
      console.log('Observation bundle:', JSON.stringify(obsBundle, null, 2));
      observations = obsBundle.entry?.map(e => e.resource) || [];
    } else if (observationsRes) {
      const errorText = await observationsRes.text();
      console.log(`❌ Observation query failed with ${observationsRes.status}:`, errorText);
    }

    if (proceduresRes?.ok) {
      const procBundle = await proceduresRes.json();
      console.log('Procedure bundle:', JSON.stringify(procBundle, null, 2));
      procedures = procBundle.entry?.map(e => e.resource) || [];
    } else if (proceduresRes) {
      const errorText = await proceduresRes.text();
      console.log(`❌ Procedure query failed with ${proceduresRes.status}:`, errorText);
    }

    if (diagnosticsRes?.ok) {
      const diagBundle = await diagnosticsRes.json();
      console.log('DiagnosticReport bundle:', JSON.stringify(diagBundle, null, 2));
      diagnostics = diagBundle.entry?.map(e => e.resource) || [];
    } else if (diagnosticsRes) {
      const errorText = await diagnosticsRes.text();
      console.log(`❌ DiagnosticReport query failed with ${diagnosticsRes.status}:`, errorText);
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
