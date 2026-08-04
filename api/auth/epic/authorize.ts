import { VercelRequest, VercelResponse } from '@vercel/node';
import { URLSearchParams } from 'url';

const EPIC_OAUTH_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize';
const EPIC_CLIENT_ID = process.env.EPIC_CLIENT_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'https://easymedical-backend.vercel.app';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Generate state parameter for CSRF protection
    const state = Math.random().toString(36).substring(7);

    const params = new URLSearchParams();
    params.append('client_id', EPIC_CLIENT_ID || '');
    params.append('response_type', 'code');
    params.append('redirect_uri', `${BACKEND_URL}/api/auth/epic/callback`);
    params.append('scope', 'openid fhirUser patient/Patient.read patient/MedicationRequest.read');
    params.append('state', state);

    // Store state in cookie for later verification
    res.setHeader('Set-Cookie', `epic_oauth_state=${state}; Path=/; HttpOnly; SameSite=Strict`);

    const authUrl = `${EPIC_OAUTH_URL}?${params.toString()}`;
    return res.redirect(302, authUrl);
  } catch (error) {
    console.error('Error initiating Epic OAuth:', error);
    return res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
}
