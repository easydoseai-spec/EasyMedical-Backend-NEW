const { URLSearchParams } = require('url');

const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const EPIC_CLIENT_ID = process.env.EPIC_CLIENT_ID;
const EPIC_CLIENT_SECRET = process.env.EPIC_CLIENT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'https://easymedical-backend.vercel.app';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', `${BACKEND_URL}/api/auth/epic/callback`);

    // Create Basic Auth header for confidential clients
    const authHeader = 'Basic ' + Buffer.from(`${EPIC_CLIENT_ID}:${EPIC_CLIENT_SECRET}`).toString('base64');

    const tokenResponse = await fetch(EPIC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': authHeader,
      },
      body: params.toString(),
    });

    if (!tokenResponse.ok) {
      console.error('Epic token exchange failed:', tokenResponse.status);
      return res.status(400).json({ error: 'Failed to exchange authorization code' });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    console.log('✅ Token received, saving to Epic service...');

    // Save token to backend session/storage (implement based on your backend setup)
    // For now, we'll store it in memory or database
    // Then return HTML that tries to redirect to deep link

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Redirecting...</title>
      </head>
      <body>
        <script>
          // Try to open the deep link
          const deepLink = 'easymedical://auth?token=${encodeURIComponent(accessToken)}';
          console.log('Attempting to redirect to: ' + deepLink);

          // Method 1: Try window.location
          window.location.href = deepLink;

          // Method 2: If that doesn't work, show success message
          setTimeout(() => {
            document.body.innerHTML = '<h1>Authorization Successful!</h1><p>You can close this window. Returning to app...</p>';
            console.log('Deep link may have failed, showing fallback message');
          }, 1500);
        </script>
      </body>
      </html>
    `;

    return res.status(200).send(html);
  } catch (error) {
    console.error('Error in Epic callback:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
