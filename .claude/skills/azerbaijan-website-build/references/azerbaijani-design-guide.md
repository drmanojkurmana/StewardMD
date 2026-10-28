# Azerbaijani Cultural Design Guide

Reference for building culturally appropriate websites for businesses in Azerbaijan.

---

## 1. Language & Typography Requirements

### Azerbaijani (Latin Extended)

The Azerbaijani alphabet includes these special characters that are **core letters, not optional diacritics**:

| Character | Name |
|-----------|------|
| Ə ə | Schwa — the most common vowel in Azerbaijani |
| Ğ ğ | Soft G |
| İ ı | Dotted I / Dotless I (note: Turkish-style I distinction) |
| Ö ö | Front rounded O |
| Ü ü | Front rounded U |
| Ç ç | Ch sound |
| Ş ş | Sh sound |

- These are NOT optional. Any font that does not render them correctly is **unusable**.
- Azerbaijani uses Latin script (switched from Cyrillic in 1991).
- Do not confuse Azerbaijani with Turkish. They share the same special characters but are distinct languages with different vocabulary and grammar.

### Russian (Cyrillic)

- Full Cyrillic character set is required for the Russian version of any site.
- Many Google Fonts include Cyrillic subsets but each must be verified before use.
- Cyrillic text runs approximately 30% longer than English equivalents. Account for this in layout, buttons, and navigation.

### Font Candidates (Verified for Both Latin Extended and Cyrillic)

**Body fonts (readable, professional):**

| Font | Notes |
|------|-------|
| DM Sans | Clean geometric sans-serif, excellent Cyrillic support |
| Manrope | Modern geometric, good Cyrillic coverage |
| Nunito Sans | Friendly, round letterforms, full Cyrillic |
| Outfit | Geometric variable font, Cyrillic support |
| Plus Jakarta Sans | Modern, professional — CHECK Cyrillic support before using |
| Montserrat | Versatile, full Cyrillic — but overused globally, use sparingly |

**Display/heading fonts:**

| Font | Notes |
|------|-------|
| Playfair Display | Elegant serif, full Cyrillic |
| Unbounded | Bold modern display, Cyrillic |
| Cormorant | Elegant serif, Cyrillic |
| Bitter | Slab serif, full Cyrillic |
| Alegreya | Humanist serif, Cyrillic |

### MANDATORY Font Verification Step

Before using ANY font, render this test string and visually inspect:

```
Azerbaijani: Əlaqə ucun bize zeng edin. Gebul saatlari: S. 09:00-18:00
Russian: Свяжитесь с нами. Часы приёма: Пн-Пт 09:00-18:00
```

Many fonts claiming "Latin Extended" support skip Azerbaijani-specific characters (especially Ə and Ş). If any character renders as a rectangle, fallback glyph, or wrong shape, reject the font.

### Google Fonts Import Pattern

When importing fonts, always request both `latin-ext` and `cyrillic` subsets:

```css
/* Example: DM Sans with both subsets */
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&subset=latin-ext,cyrillic&display=swap');
```

---

## 2. Cultural Design Considerations

### Color Psychology in Azerbaijan

| Color | Association | Usage Notes |
|-------|-------------|-------------|
| Blue / Teal | Trust, stability, professionalism | Widely used. One of the three Azerbaijan flag colors. Safe default for professional sites. |
| Red / Crimson | Energy, passion, progress | Flag color. Works well for CTAs and accent elements. |
| Green | Growth, nature, Islamic heritage | Flag color. Appropriate for health, nature, and growth-oriented businesses. |
| Gold / Amber | Luxury, prosperity, tradition | Strong resonance for premium positioning. Pairs well with dark backgrounds. |
| White | Clean, modern | Effective for layouts but avoid large empty white expanses — can feel cold or unfinished. |
| Dark Navy / Charcoal | Sophistication, authority | Excellent for professional services, law, finance. |

**Flag colors (blue, red, green with white crescent and star):** Use subtly as accent inspiration if relevant. Never use as the primary palette unless the context is explicitly patriotic or governmental.

### Design Sensibilities

- **Modern and aspirational.** Azerbaijani businesses generally prefer sleek, contemporary design over rustic or handmade aesthetics.
- **European influence.** Baku's aesthetic is heavily European. Reference points: Heydar Aliyev Center (Zaha Hadid), Flame Towers, the Boulevard, modern waterfront architecture.
- **Luxury is appreciated.** A premium feel resonates well even for small businesses. Use generous whitespace, refined typography, and quality imagery.
- **Balance tradition and modernity.** Honor cultural heritage (old city motifs, carpet patterns, mugham references) without making the design look dated. Subtle nods work better than overt traditional styling.
- **Photography style:** Bright, aspirational, warm tones. Natural light. Avoid cold, clinical, or overly corporate stock imagery.

### What to Avoid

- Overly Western/American design cliches (big grinning stock photo people who are obviously American)
- Imagery that does not match the region (wrong architecture, wrong landscape, wrong demographics)
- Religious imagery unless the business is explicitly religious in nature
- Political imagery or symbols of any kind
- Soviet-era aesthetics (unless the business is intentionally retro-themed)
- Cluttered or information-dense layouts reminiscent of older web conventions
- Generic "global business" stock photos with no regional connection

---

## 3. Image Selection Guidelines

### Unsplash / Stock Image Search Strategy

When sourcing images for Azerbaijani business websites:

**Location/Architecture:**
- Search: "Baku", "Baku skyline", "Azerbaijan", "Caspian Sea", "Icherisheher" (old city)
- For modern contexts: "Baku modern architecture", "Flame Towers Baku"
- For traditional contexts: "Baku old city", "Azerbaijan carpet", "Sheki"
- For nature/landscape: "Caucasus mountains", "Azerbaijan landscape"

**People:**
- Prefer diverse, Mediterranean / Middle Eastern / Caucasian-looking individuals
- Avoid obviously Northern European or American stock photo models
- Business attire in Baku trends European-formal
- For casual contexts: modern, urban, well-dressed

**Food Businesses:**
- Azerbaijani cuisine is distinct. Key dishes: plov (pilaf), dolma, kebab/kabab, qutab, lavangi, baklava, pakhlava
- Tea culture is central — search for "Azerbaijan tea", armudu glass (pear-shaped tea glass)
- Do NOT use generic "Middle Eastern food" images. Azerbaijani cuisine has its own visual identity.

**Interiors:**
- Baku restaurants and cafes have a distinct style — warm lighting, rich materials, European-modern meets local warmth
- For professional offices: clean, modern, well-lit

### Image Cultural Checks

Before using any stock image, verify:

1. Does this look like it could be in Azerbaijan? (architecture, signage, landscape, light quality)
2. Do the people look like they could be from the Caucasus region?
3. Is the food or product authentic to the actual business type?
4. Would an Azerbaijani person see this image and think "this represents us"?
5. Are there any visible signs, text, or symbols from a different country?

---

## 4. Content Tone by Language

### Azerbaijani (Primary Language)

- Warm, respectful, slightly formal for professional services
- Can be more casual and friendly for consumer-facing businesses (cafes, salons, shops)
- Use proper Azerbaijani — not Turkish. They are similar but distinct languages with different vocabulary, spelling conventions, and idioms.
- Honorifics and polite forms matter in formal contexts (medical, legal, educational)
- Common polite phrases: "Hoemtli musterilerimiz" (Dear customers), "Sizin ueuen" (For you)

### Russian

- More formal and structured than the Azerbaijani version
- Many Azerbaijanis are fluent in Russian and some prefer it for business contexts
- Professional, competent, clear tone
- Do not assume Russian speakers are non-Azerbaijani — many native Azerbaijanis prefer Russian

### English

- Clean, international, professional
- Target audience: tourists, expats, international business contacts
- Keep it simple and clear — avoid idioms or culturally specific references
- This version often serves as a credibility signal for the business

---

## 5. Common Business Types and Their Website Expectations

### Restaurants / Cafes
- Menu with photos (ideally real photos of their dishes, not stock)
- Location map (Google Maps embed)
- Reservation info or booking widget
- Atmosphere/interior photos
- Operating hours prominently displayed

### Beauty Salons / Barbers
- Services list with prices in AZN
- Gallery of completed work (hair, nails, treatments)
- Team photos with stylist names
- Online booking integration or WhatsApp contact
- Instagram feed integration (beauty businesses in Baku are heavily Instagram-driven)

### Medical / Dental Clinics
- Doctor profiles with credentials and photos
- Services list organized by specialty
- Certifications and accreditations prominently displayed
- Clean, professional, trustworthy design
- Contact and appointment booking

### Construction / Renovation
- Portfolio of completed projects with before/after imagery
- Services breakdown
- Client testimonials
- Contact form for quotes

### Education / Tutoring
- Programs and course offerings
- Teacher/tutor profiles
- Testimonials from students or parents
- Enrollment or registration information
- Schedule and pricing

### Legal / Consulting
- Team profiles with credentials
- Practice areas or service areas
- Professional, authoritative design — darker palettes work well
- Trust signals (years of experience, case count, certifications)

### Retail / Shops
- Product showcase or basic catalog
- Physical location with map
- Operating hours
- Possibly WhatsApp or phone ordering info

### Hotels / Tourism
- Room photos and categories
- Amenities list
- Location with nearby attractions
- Booking integration or contact for reservations
- Multilingual is especially critical for this category

---

## 6. Technical Considerations

### Text Direction
- RTL is NOT needed. Azerbaijani is LTR (Latin script). Russian is LTR (Cyrillic script).

### Date Format
- **DD.MM.YYYY** (European style with dots)
- Example: 15.03.2026

### Currency
- **AZN** (Azerbaijani Manat)
- Symbol: **₼**
- Placement: after the number with a space (e.g., "50 ₼" or "50 AZN")
- Decimal separator: comma (e.g., "49,99 ₼")
- Thousands separator: space or dot (e.g., "1 000 ₼" or "1.000 ₼")

### Phone Format
- Country code: +994
- Format: **+994 XX XXX XX XX**
- Baku city code: 12 (landlines: +994 12 XXX XX XX)
- Mobile prefixes: 50, 51, 55, 70, 77, 99

### Address Format
```
Street Name, Building Number
District/Neighborhood
City, Postal Code
Azerbaijan
```

Example:
```
Nizami kucesi 203
Nesimi rayonu
Baku, AZ1000
Azerbaijan
```

### WhatsApp Integration
- WhatsApp is extremely popular in Azerbaijan for business communication
- Always include a WhatsApp contact option where applicable
- Use `https://wa.me/994XXXXXXXXX` format for direct links

### Social Media Priorities
1. **Instagram** — dominant platform, especially for consumer businesses
2. **WhatsApp** — primary business communication tool
3. **Facebook** — still relevant, especially for older demographics
4. **TikTok** — growing rapidly among younger audiences
5. **Telegram** — used for channels and groups

### SEO Considerations
- Primary domain TLD: .az (for local businesses) or .com
- Google is the dominant search engine
- Yandex still has some usage among Russian-speaking users
- Local SEO via Google Business Profile is important
- Azerbaijani-language content should target az locale (lang="az")
- Russian content should target ru locale (lang="ru")

### Performance
- Internet infrastructure in Baku is generally good (fiber widely available)
- Outside Baku, mobile connections may be slower — optimize for mobile performance
- Serve images in modern formats (WebP/AVIF) with appropriate fallbacks
