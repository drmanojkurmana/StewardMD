# Logo Generation with NanoBanana 2 (Google Gemini API)

Reference for generating logos when a business does not have one. Uses Google's Gemini image generation model (NanoBanana 2).

---

## 1. API Setup

### Model

- **Model:** `gemini-3.1-flash-image-preview` (NanoBanana 2)
- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent`
- **Authentication:** `x-goog-api-key` header with `GEMINI_API_KEY` environment variable

### REST API Call Template

```bash
curl -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{
        "text": "YOUR_PROMPT_HERE"
      }]
    }],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"]
    }
  }'
```

The response contains a `candidates[0].content.parts` array. Image data is returned as a part with `inlineData.mimeType` (e.g., `image/png`) and `inlineData.data` (base64-encoded image bytes).

### Node.js Script Template

```javascript
#!/usr/bin/env node
/**
 * generate-logo.js
 *
 * Usage:
 *   GEMINI_API_KEY=your_key node generate-logo.js \
 *     --name "Caspian Cafe" \
 *     --industry "restaurant" \
 *     --style "minimal" \
 *     --output "./logo.png"
 */

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is not set.");
  process.exit(1);
}

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    parsed[key] = args[i + 1];
  }
  return parsed;
}

async function generateLogo({ name, industry, style, output }) {
  if (!name || !industry) {
    console.error("Error: --name and --industry are required.");
    process.exit(1);
  }

  const styleDirection = style || "minimal and modern";
  const outputPath = output || "./logo.png";

  const prompt = `Create a ${styleDirection} logo icon for "${name}", a ${industry} business in Baku, Azerbaijan. The logo should be clean, professional, and work well at small sizes. Output as a high-quality image on a white background. Do not include any text in the logo — icon/symbol only.`;

  console.log(`Generating logo for "${name}" (${industry})...`);
  console.log(`Style: ${styleDirection}`);
  console.log(`Prompt: ${prompt}\n`);

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-goog-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;

    if (!parts || parts.length === 0) {
      throw new Error("No content returned from API.");
    }

    // Find the image part in the response
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
    if (!imagePart) {
      console.log("Response parts:", JSON.stringify(parts.map((p) => Object.keys(p)), null, 2));
      throw new Error("No image found in API response.");
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
    const resolvedPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, imageBuffer);

    console.log(`Logo saved to: ${resolvedPath}`);
    console.log(`File size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);

    // Log any text part (model commentary)
    const textPart = parts.find((p) => p.text);
    if (textPart) {
      console.log(`\nModel notes: ${textPart.text}`);
    }

    return resolvedPath;
  } catch (error) {
    console.error(`Logo generation failed: ${error.message}`);
    process.exit(1);
  }
}

const args = parseArgs();
generateLogo(args);
```

### Python Script Template

```python
#!/usr/bin/env python3
"""
generate_logo.py

Usage:
    GEMINI_API_KEY=your_key python generate_logo.py \
        --name "Caspian Cafe" \
        --industry "restaurant" \
        --style "minimal" \
        --output "./logo.png"
"""

import argparse
import os
import sys
from pathlib import Path

from google import genai
from google.genai import types


def generate_logo(name: str, industry: str, style: str = "minimal and modern", output: str = "./logo.png") -> str:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    prompt = (
        f'Create a {style} logo icon for "{name}", a {industry} business in Baku, Azerbaijan. '
        f"The logo should be clean, professional, and work well at small sizes. "
        f"Output as a high-quality image on a white background. "
        f"Do not include any text in the logo — icon/symbol only."
    )

    print(f'Generating logo for "{name}" ({industry})...')
    print(f"Style: {style}")
    print(f"Prompt: {prompt}\n")

    try:
        response = client.models.generate_content(
            model="gemini-3.1-flash-image-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        # Extract image from response parts
        image_part = None
        text_note = None
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                image_part = part
            elif part.text:
                text_note = part.text

        if not image_part:
            print("Error: No image found in API response.", file=sys.stderr)
            sys.exit(1)

        output_path = Path(output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(image_part.inline_data.data)

        file_size_kb = len(image_part.inline_data.data) / 1024
        print(f"Logo saved to: {output_path}")
        print(f"File size: {file_size_kb:.1f} KB")

        if text_note:
            print(f"\nModel notes: {text_note}")

        return str(output_path)

    except Exception as e:
        print(f"Logo generation failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate a logo using Gemini NanoBanana 2")
    parser.add_argument("--name", required=True, help="Business name")
    parser.add_argument("--industry", required=True, help="Business industry")
    parser.add_argument("--style", default="minimal and modern", help="Style direction")
    parser.add_argument("--output", default="./logo.png", help="Output file path")
    args = parser.parse_args()

    generate_logo(args.name, args.industry, args.style, args.output)
```

---

## 2. Logo Generation Workflow

### Step 1: Gather Requirements

From `BUSINESS_PROFILE.md`, extract:
- **Business name** -- exact spelling and casing
- **Industry** -- e.g., restaurant, dental clinic, law firm, boutique hotel
- **Brand personality/tone** -- modern, traditional, luxury, friendly, bold
- **Color preferences** -- if the business already has brand colors, use them
- **Inspiration references** -- any existing branding, competitor logos, or stated preferences

### Step 2: Craft Prompts

Use the prompt template matching the brand personality. Always generate icon-only first (no text).

**Minimal / Modern:**
```
Create a minimal, modern logo for [BUSINESS_NAME], a [INDUSTRY] business in Baku, Azerbaijan. The logo should be clean, geometric, and work well at small sizes. Use [COLOR_PREFERENCES]. The design should feel premium and contemporary. Output as a vector-style image on a transparent or white background. Do not include any text in the logo — icon/symbol only.
```

**Elegant / Luxury:**
```
Design an elegant, luxury logo mark for [BUSINESS_NAME], a high-end [INDUSTRY] business. The logo should convey sophistication and quality with refined lines and balanced proportions. Style: upscale, timeless, polished. Use [COLOR_PREFERENCES] or default to gold/dark tones. Output as a clean image suitable for web use on a white background. Do not include any text — icon/symbol only.
```

**Friendly / Approachable:**
```
Create a friendly, approachable logo icon for [BUSINESS_NAME], a [INDUSTRY] business. The logo should feel warm, welcoming, and trustworthy. Use rounded shapes and soft edges. Colors: [COLOR_PREFERENCES] or default to warm, inviting tones. Output on a white background. Do not include any text in the logo — icon/symbol only.
```

**Traditional / Heritage:**
```
Design a logo mark for [BUSINESS_NAME], a [INDUSTRY] business with deep roots in Azerbaijani culture. The logo should blend traditional Azerbaijani design motifs (such as carpet patterns, pomegranate, or architectural elements) with a clean, modern execution. Use [COLOR_PREFERENCES] or classic tones. Output on a white background. Do not include any text — icon/symbol only.
```

**Bold / Dynamic:**
```
Create a bold, dynamic logo icon for [BUSINESS_NAME], a [INDUSTRY] business. The logo should feel energetic, confident, and forward-moving. Use strong angles, sharp shapes, or motion-inspired forms. Colors: [COLOR_PREFERENCES] or high-contrast, vibrant palette. Output on a white background. Do not include any text — icon/symbol only.
```

**Text Logo / Wordmark (use sparingly -- see notes):**
```
Create a stylish wordmark/text logo for "[BUSINESS_NAME]" using custom typography. The text should be in Latin script. Style: [modern/elegant/bold]. Make it distinctive and memorable. Use [COLOR_PREFERENCES]. Output on a white background.
```

### Step 3: Generate Options

Generate **3 different style variations** by running the API call 3 times with different style prompts (or slight prompt variations).

Review each generated logo for:
- **Small-size clarity** -- does it read well at favicon size (32x32)?
- **Color appropriateness** -- do the colors match the brand and look professional?
- **Cultural sensitivity** -- no inappropriate symbols for the Azerbaijani market
- **Text quality** -- if any text was included (even if not requested), check for gibberish or misspellings. If text is mangled, discard and prefer the icon-only version.
- **Light/dark compatibility** -- will it work on both light and dark backgrounds?
- **Clean rendering** -- no artifacts, blur, or odd distortions

### Step 4: Select and Save

1. Pick the best option from the 3 generated logos.
2. Save to:
   - `scraped/assets/logo.png` (source asset)
   - `site/public/images/logo.png` (build output)
3. For the **favicon**, either:
   - Use the same logo if it is simple enough at 32x32
   - Generate a separate, even simpler version with a prompt like: `"Create a very simple, recognizable icon suitable for a 32x32 pixel favicon for [BUSINESS_NAME], a [INDUSTRY] business. Minimal detail, bold shapes, single color."`
4. Save favicon to `site/public/favicon.png` or `site/public/favicon.svg`.

---

## 3. Important Notes

### Icon-only first
Always generate icon/symbol-only logos. Text in AI-generated logos frequently has spelling errors, garbled characters, or poor kerning. If a wordmark is needed, handle the text in CSS or SVG separately and pair it with the generated icon.

### Verify the output
AI image generation can produce unexpected results -- extra shapes, embedded gibberish text, cultural symbols used incorrectly, or just ugly logos. Always visually inspect every generated logo before using it in a build.

### Fallback strategy
If NanoBanana results are not acceptable after **3 generation attempts**, fall back to a simple typographic logo:
- Use the site's chosen display font
- Style the business name in CSS or create an SVG text element
- A clean, well-set typographic logo is always better than a bad AI-generated logo
- Example fallback: bold font weight, letter-spacing, accent color underline

### File format
- Save as **PNG** for web use (good balance of quality and compatibility)
- If SVG is needed later, the PNG would need to be vectorized/traced manually or in a tool like Figma
- Target file size: under 100 KB for the main logo, under 10 KB for favicon

### Transparent backgrounds
- Request transparent or white backgrounds in the prompt
- If the model returns a white background instead of transparent, post-process to remove it if needed (e.g., using sharp or Jimp in Node.js)
- White background is acceptable for most web use cases when placed on a white/light header

### Cost
- Google provides free tier credits for Gemini API usage
- Logo generation uses minimal credits (a few image generations per business)
- One generation call typically costs fractions of a cent

### API Key Management
- `GEMINI_API_KEY` must be set in the environment
- Add to `.env.local` in the project root
- Ensure `.env.local` is listed in `.gitignore` (never commit API keys)
- The key can be obtained from [Google AI Studio](https://aistudio.google.com/apikey)
