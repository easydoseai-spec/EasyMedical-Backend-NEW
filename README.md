# EasyMedical Backend API

Backend for the EasyMedical mobile app's chatbot feature using Vercel and the Anthropic API.

## Setup

### Prerequisites
- Node.js 18+
- A Vercel account (free at https://vercel.com)
- Your Anthropic API key

### Local Development

1. Clone or create this project:
```bash
cd EasyMedical-Backend
npm install
```

2. Create a `.env.local` file:
```bash
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

3. Run the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000/api/chat`

### Deploy to Vercel

1. Push this code to a GitHub repository
2. Go to https://vercel.com and sign in
3. Click "New Project" and import your GitHub repository
4. Add environment variable:
   - Name: `ANTHROPIC_API_KEY`
   - Value: Your Anthropic API key
5. Click "Deploy"

Once deployed, you'll get a URL like `https://your-project.vercel.app`

### Update Mobile App

After deployment, update `.env` in your EasyMedical mobile app:

```
EXPO_PUBLIC_BACKEND_URL=https://your-project.vercel.app
```

## API Endpoint

**POST** `/api/chat`

Request:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "What are symptoms of a cold?"
    }
  ]
}
```

Response:
```json
{
  "content": "A cold typically presents with...",
  "usage": {
    "input_tokens": 100,
    "output_tokens": 200
  }
}
```

## Files

- `api/chat.ts` - Main chat endpoint using Anthropic SDK
- `vercel.json` - Vercel configuration
- `tsconfig.json` - TypeScript configuration
- `package.json` - Dependencies

## Cost

- Vercel: Free tier includes 100GB bandwidth/month
- Anthropic API: Charged per token (very affordable for chatbot usage)
