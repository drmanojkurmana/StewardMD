# Nano Banana Image Enhancement

When enhancing team/people photos, use the OpenRouter API with Nano Banana. Verify the current model string and endpoint format at docs.openrouter.ai before running.

## Template Script

```javascript
// enhance-team-photos.js
const fs = require('fs');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/images/generations';

async function enhancePhoto(imagePath, personName, businessContext) {
  const base64Image = fs.readFileSync(imagePath).toString('base64');
  const prompt = `Professional corporate headshot of ${personName}.
    Clean, modern, well-lit. Business context: ${businessContext}`;

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'stability/nano-banana',
      prompt,
      image: base64Image
    }),
  });

  const result = await response.json();
  // Save enhanced image to /public/images/team/
  return result;
}

module.exports = { enhancePhoto };
```

## Usage Notes

- Always verify the current model string at docs.openrouter.ai — it may have changed
- Save enhanced images to `/public/images/team/`
- Ensure OPENROUTER_API_KEY is set in environment variables
- Add the API key to `.env.local` (and ensure `.env.local` is in `.gitignore`)
