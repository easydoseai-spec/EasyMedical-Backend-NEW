import { VercelRequest, VercelResponse } from '@vercel/node';
import { URLSearchParams } from 'url';

const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const EPIC_CLIENT_ID = process.env.EPIC_CLIENT_ID;
const EPIC_CLIENT_SECRET = process.env.EPIC_CLIENT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'https://easymedical-backend.vercel.app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }

    // Exchange code for access token
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code as string);
    params.append('redirect_uri', `${BACKEND_URL}/api/auth/epic/callback`);
    params.append('client_id', EPIC_CLIENT_ID || '');
    params.append('client_secret', EPIC_CLIENT_SECRET || '');

    const tokenResponse = await fetch(EPIC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!tokenResponse.ok) {
      console.error('Epic token exchange failed:', tokenResponse.status);
      return res.status(400).json({ error: 'Failed to exchange authorization code' });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Redirect back to mobile app with token
    const redirectUrl = `easymedical://auth?token=${encodeURIComponent(accessToken)}`;
    return res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('Error in Epic callback:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
