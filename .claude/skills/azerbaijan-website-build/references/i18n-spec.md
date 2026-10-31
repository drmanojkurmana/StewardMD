# i18n Specification Reference -- Astro 5.x Trilingual Website

> **Languages:** Azerbaijani (az), Russian (ru), English (en)
> **Default language:** Azerbaijani (az)
> **Routing strategy:** Directory-based prefixes (`/az/`, `/ru/`, `/en/`)
> **Framework:** Astro 5.x with static site generation

---

## 1. Directory-Based Routing

### URL Structure

```
/           --> 302 redirect to /az/
/az/        --> Azerbaijani homepage
/ru/        --> Russian homepage
/en/        --> English homepage
/az/about   --> Azerbaijani about page
/ru/about   --> Russian about page
/en/about   --> English about page
```

### File Structure

```
src/
  pages/
    index.astro              <-- Root redirect to /az/
    az/
      index.astro
      about.astro
      services.astro
      services/
        [slug].astro
      contact.astro
      blog/
        index.astro
        [slug].astro
    ru/
      index.astro
      about.astro
      services.astro
      services/
        [slug].astro
      contact.astro
      blog/
        index.astro
        [slug].astro
    en/
      index.astro
      about.astro
      services.astro
      services/
        [slug].astro
      contact.astro
      blog/
        index.astro
        [slug].astro
  content/
    i18n/
      az.json
      ru.json
      en.json
  utils/
    i18n.ts
  components/
    LanguageSwitcher.astro
  layouts/
    BaseLayout.astro
```

### Root Redirect (`src/pages/index.astro`)

```astro
---
return Astro.redirect('/az/', 302);
---
```

This is the complete file. The frontmatter redirect fires before any rendering.

---

## 2. i18n Utility (`src/utils/i18n.ts`)

```typescript
// src/utils/i18n.ts

export type Lang = 'az' | 'ru' | 'en';

export const LANGUAGES: Lang[] = ['az', 'ru', 'en'];
export const DEFAULT_LANG: Lang = 'az';

export const LANGUAGE_NAMES: Record<Lang, string> = {
  az: 'Azərbaycanca',
  ru: 'Русский',
  en: 'English',
};

export const LANGUAGE_FLAGS: Record<Lang, string> = {
  az: '🇦🇿',
  ru: '🇷🇺',
  en: '🇬🇧',
};

// HTML lang attribute values (BCP 47)
export const HTML_LANG: Record<Lang, string> = {
  az: 'az',
  ru: 'ru',
  en: 'en',
};

/**
 * Extract language code from a URL path.
 * Falls back to DEFAULT_LANG if no valid prefix is found.
 */
export function getLang(url: string | URL): Lang {
  const pathname = typeof url === 'string' ? url : url.pathname;
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0] as Lang;
  return LANGUAGES.includes(first) ? first : DEFAULT_LANG;
}

/**
 * Load the JSON strings file for a given language.
 * Uses dynamic import so Astro can tree-shake unused languages at build time.
 */
export async function getStrings(lang: Lang): Promise<I18nStrings> {
  const modules: Record<Lang, () => Promise<{ default: I18nStrings }>> = {
    az: () => import('../content/i18n/az.json'),
    ru: () => import('../content/i18n/ru.json'),
    en: () => import('../content/i18n/en.json'),
  };
  const mod = await modules[lang]();
  return mod.default;
}

/**
 * Swap the language prefix in a URL path.
 * "/az/about" + "ru" --> "/ru/about"
 * "/" + "ru" --> "/ru/"
 */
export function switchLang(currentUrl: string | URL, targetLang: Lang): string {
  const pathname = typeof currentUrl === 'string' ? currentUrl : currentUrl.pathname;
  const segments = pathname.split('/').filter(Boolean);

  if (LANGUAGES.includes(segments[0] as Lang)) {
    segments[0] = targetLang;
  } else {
    segments.unshift(targetLang);
  }

  return '/' + segments.join('/') + (pathname.endsWith('/') ? '/' : '/');
}

/**
 * Generate alternate links for hreflang tags.
 * Returns an entry for each language plus x-default (pointing to /az/).
 */
export function getAlternateLinks(
  currentUrl: string | URL,
  baseUrl: string
): AlternateLink[] {
  const links: AlternateLink[] = LANGUAGES.map((lang) => ({
    lang,
    hreflang: lang,
    url: new URL(switchLang(currentUrl, lang), baseUrl).href,
  }));

  // x-default points to the Azerbaijani version
  links.push({
    lang: 'az',
    hreflang: 'x-default',
    url: new URL(switchLang(currentUrl, DEFAULT_LANG), baseUrl).href,
  });

  return links;
}

/**
 * Get the path portion without the language prefix.
 * "/az/about" --> "/about"
 * "/ru/services/web" --> "/services/web"
 */
export function getPathWithoutLang(url: string | URL): string {
  const pathname = typeof url === 'string' ? url : url.pathname;
  const segments = pathname.split('/').filter(Boolean);
  if (LANGUAGES.includes(segments[0] as Lang)) {
    segments.shift();
  }
  return '/' + segments.join('/');
}

// ---------------------
// Type Definitions
// ---------------------

export interface AlternateLink {
  lang: Lang;
  hreflang: string;
  url: string;
}

export interface I18nStrings {
  nav: {
    home: string;
    about: string;
    services: string;
    contact: string;
    blog: string;
  };
  ui: {
    readMore: string;
    getInTouch: string;
    learnMore: string;
    viewAll: string;
    sendMessage: string;
    submitForm: string;
    backToTop: string;
    loading: string;
    phone: string;
    email: string;
    address: string;
    followUs: string;
    shareOn: string;
    downloadPdf: string;
    searchPlaceholder: string;
    noResults: string;
    previous: string;
    next: string;
    pageOf: string;
  };
  footer: {
    copyright: string;
    allRightsReserved: string;
    privacyPolicy: string;
    termsOfService: string;
    madeWith: string;
  };
  meta: {
    homeTitle: string;
    homeDescription: string;
    aboutTitle: string;
    aboutDescription: string;
    servicesTitle: string;
    servicesDescription: string;
    contactTitle: string;
    contactDescription: string;
  };
  languages: {
    az: string;
    ru: string;
    en: string;
  };
  contact: {
    nameLabel: string;
    emailLabel: string;
    phoneLabel: string;
    messageLabel: string;
    namePlaceholder: string;
    emailPlaceholder: string;
    phonePlaceholder: string;
    messagePlaceholder: string;
    requiredField: string;
    invalidEmail: string;
    successMessage: string;
    errorMessage: string;
  };
}
```

---

## 3. JSON Strings Files

### Azerbaijani (`src/content/i18n/az.json`)

```json
{
  "nav": {
    "home": "Ana Səhifə",
    "about": "Haqqımızda",
    "services": "Xidmətlər",
    "contact": "Əlaqə",
    "blog": "Bloq"
  },
  "ui": {
    "readMore": "Daha çox oxu",
    "getInTouch": "Bizimlə əlaqə saxlayın",
    "learnMore": "Ətraflı məlumat",
    "viewAll": "Hamısına bax",
    "sendMessage": "Mesaj göndər",
    "submitForm": "Göndər",
    "backToTop": "Yuxarıya qayıt",
    "loading": "Yüklənir...",
    "phone": "Telefon",
    "email": "E-poçt",
    "address": "Ünvan",
    "followUs": "Bizi izləyin",
    "shareOn": "Paylaş:",
    "downloadPdf": "PDF yüklə",
    "searchPlaceholder": "Axtar...",
    "noResults": "Nəticə tapılmadı",
    "previous": "Əvvəlki",
    "next": "Növbəti",
    "pageOf": "səhifə {current} / {total}"
  },
  "footer": {
    "copyright": "Bütün hüquqlar qorunur",
    "allRightsReserved": "Bütün hüquqlar qorunur",
    "privacyPolicy": "Məxfilik Siyasəti",
    "termsOfService": "İstifadə Şərtləri",
    "madeWith": "Sevgi ilə hazırlanıb"
  },
  "meta": {
    "homeTitle": "Ana Səhifə",
    "homeDescription": "Azərbaycanda etibarlı xidmətlər. Peşəkar komandamızla tanış olun.",
    "aboutTitle": "Haqqımızda",
    "aboutDescription": "Şirkətimiz haqqında ətraflı məlumat, missiyamız və dəyərlərimiz.",
    "servicesTitle": "Xidmətlər",
    "servicesDescription": "Təklif etdiyimiz peşəkar xidmətlər haqqında məlumat alın.",
    "contactTitle": "Əlaqə",
    "contactDescription": "Bizimlə əlaqə saxlayın. Suallarınızı cavablandırmağa hazırıq."
  },
  "languages": {
    "az": "Azərbaycanca",
    "ru": "Русский",
    "en": "English"
  },
  "contact": {
    "nameLabel": "Adınız",
    "emailLabel": "E-poçt ünvanınız",
    "phoneLabel": "Telefon nömrəniz",
    "messageLabel": "Mesajınız",
    "namePlaceholder": "Ad və soyadınızı daxil edin",
    "emailPlaceholder": "E-poçt ünvanınızı daxil edin",
    "phonePlaceholder": "+994 XX XXX XX XX",
    "messagePlaceholder": "Mesajınızı yazın...",
    "requiredField": "Bu sahə mütləqdir",
    "invalidEmail": "Düzgün e-poçt ünvanı daxil edin",
    "successMessage": "Mesajınız uğurla göndərildi!",
    "errorMessage": "Xəta baş verdi. Zəhmət olmasa yenidən cəhd edin."
  }
}
```

### Russian (`src/content/i18n/ru.json`)

```json
{
  "nav": {
    "home": "Главная",
    "about": "О нас",
    "services": "Услуги",
    "contact": "Контакты",
    "blog": "Блог"
  },
  "ui": {
    "readMore": "Читать далее",
    "getInTouch": "Свяжитесь с нами",
    "learnMore": "Подробнее",
    "viewAll": "Смотреть все",
    "sendMessage": "Отправить сообщение",
    "submitForm": "Отправить",
    "backToTop": "Наверх",
    "loading": "Загрузка...",
    "phone": "Телефон",
    "email": "Эл. почта",
    "address": "Адрес",
    "followUs": "Мы в соцсетях",
    "shareOn": "Поделиться:",
    "downloadPdf": "Скачать PDF",
    "searchPlaceholder": "Поиск...",
    "noResults": "Ничего не найдено",
    "previous": "Назад",
    "next": "Далее",
    "pageOf": "страница {current} из {total}"
  },
  "footer": {
    "copyright": "Все права защищены",
    "allRightsReserved": "Все права защищены",
    "privacyPolicy": "Политика конфиденциальности",
    "termsOfService": "Условия использования",
    "madeWith": "Сделано с любовью"
  },
  "meta": {
    "homeTitle": "Главная",
    "homeDescription": "Надёжные услуги в Азербайджане. Познакомьтесь с нашей профессиональной командой.",
    "aboutTitle": "О нас",
    "aboutDescription": "Подробная информация о нашей компании, миссии и ценностях.",
    "servicesTitle": "Услуги",
    "servicesDescription": "Узнайте о профессиональных услугах, которые мы предлагаем.",
    "contactTitle": "Контакты",
    "contactDescription": "Свяжитесь с нами. Мы готовы ответить на ваши вопросы."
  },
  "languages": {
    "az": "Azərbaycanca",
    "ru": "Русский",
    "en": "English"
  },
  "contact": {
    "nameLabel": "Ваше имя",
    "emailLabel": "Ваш email",
    "phoneLabel": "Ваш телефон",
    "messageLabel": "Ваше сообщение",
    "namePlaceholder": "Введите ваше имя",
    "emailPlaceholder": "Введите ваш email",
    "phonePlaceholder": "+994 XX XXX XX XX",
    "messagePlaceholder": "Напишите ваше сообщение...",
    "requiredField": "Это обязательное поле",
    "invalidEmail": "Введите корректный email",
    "successMessage": "Ваше сообщение успешно отправлено!",
    "errorMessage": "Произошла ошибка. Пожалуйста, попробуйте ещё раз."
  }
}
```

### English (`src/content/i18n/en.json`)

```json
{
  "nav": {
    "home": "Home",
    "about": "About",
    "services": "Services",
    "contact": "Contact",
    "blog": "Blog"
  },
  "ui": {
    "readMore": "Read More",
    "getInTouch": "Get in Touch",
    "learnMore": "Learn More",
    "viewAll": "View All",
    "sendMessage": "Send Message",
    "submitForm": "Submit",
    "backToTop": "Back to Top",
    "loading": "Loading...",
    "phone": "Phone",
    "email": "Email",
    "address": "Address",
    "followUs": "Follow Us",
    "shareOn": "Share on",
    "downloadPdf": "Download PDF",
    "searchPlaceholder": "Search...",
    "noResults": "No results found",
    "previous": "Previous",
    "next": "Next",
    "pageOf": "page {current} of {total}"
  },
  "footer": {
    "copyright": "All rights reserved",
    "allRightsReserved": "All rights reserved",
    "privacyPolicy": "Privacy Policy",
    "termsOfService": "Terms of Service",
    "madeWith": "Made with love"
  },
  "meta": {
    "homeTitle": "Home",
    "homeDescription": "Reliable services in Azerbaijan. Meet our professional team.",
    "aboutTitle": "About Us",
    "aboutDescription": "Detailed information about our company, mission, and values.",
    "servicesTitle": "Services",
    "servicesDescription": "Learn about the professional services we offer.",
    "contactTitle": "Contact",
    "contactDescription": "Get in touch with us. We are ready to answer your questions."
  },
  "languages": {
    "az": "Azərbaycanca",
    "ru": "Русский",
    "en": "English"
  },
  "contact": {
    "nameLabel": "Your Name",
    "emailLabel": "Your Email",
    "phoneLabel": "Your Phone",
    "messageLabel": "Your Message",
    "namePlaceholder": "Enter your full name",
    "emailPlaceholder": "Enter your email address",
    "phonePlaceholder": "+994 XX XXX XX XX",
    "messagePlaceholder": "Write your message...",
    "requiredField": "This field is required",
    "invalidEmail": "Please enter a valid email address",
    "successMessage": "Your message has been sent successfully!",
    "errorMessage": "An error occurred. Please try again."
  }
}
```

---

## 4. LanguageSwitcher Component (`src/components/LanguageSwitcher.astro`)

```astro
---
import {
  getLang,
  switchLang,
  getAlternateLinks,
  LANGUAGES,
  LANGUAGE_NAMES,
  LANGUAGE_FLAGS,
  type Lang,
} from '../utils/i18n';

const currentUrl = Astro.url.pathname;
const currentLang = getLang(currentUrl);
const alternateLinks = getAlternateLinks(currentUrl, Astro.site?.href ?? '');
---

{/* Inject hreflang <link> tags into <head> via Astro's <slot> or direct in layout */}

<nav aria-label="Language switcher" class="flex items-center gap-1">
  {LANGUAGES.map((lang: Lang, index: number) => {
    const href = switchLang(currentUrl, lang);
    const isActive = lang === currentLang;
    return (
      <>
        <a
          href={href}
          aria-current={isActive ? 'true' : undefined}
          aria-label={`Switch to ${LANGUAGE_NAMES[lang]}`}
          hreflang={lang}
          class:list={[
            'inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium transition-colors duration-150',
            isActive
              ? 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100 pointer-events-none'
              : 'text-gray-600 hover:text-primary-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-primary-300 dark:hover:bg-gray-800',
          ]}
        >
          <span aria-hidden="true" class="text-base leading-none">
            {LANGUAGE_FLAGS[lang]}
          </span>
          <span class="uppercase tracking-wide">{lang}</span>
        </a>
        {index < LANGUAGES.length - 1 && (
          <span class="text-gray-300 dark:text-gray-600 select-none" aria-hidden="true">|</span>
        )}
      </>
    );
  })}
</nav>
```

### Compact Variant (for mobile headers)

If a more compact version is needed in a mobile menu, use this alternative:

```astro
<nav aria-label="Language switcher" class="flex items-center gap-2 md:gap-1">
  {LANGUAGES.map((lang: Lang) => {
    const href = switchLang(currentUrl, lang);
    const isActive = lang === currentLang;
    return (
      <a
        href={href}
        aria-current={isActive ? 'true' : undefined}
        aria-label={LANGUAGE_NAMES[lang]}
        hreflang={lang}
        class:list={[
          'uppercase text-xs font-bold tracking-widest px-1.5 py-0.5 rounded transition-colors',
          isActive
            ? 'bg-primary-700 text-white'
            : 'text-gray-500 hover:text-primary-600 dark:text-gray-400',
        ]}
      >
        {lang}
      </a>
    );
  })}
</nav>
```

---

## 5. BaseLayout.astro -- hreflang Setup

```astro
---
import { getLang, getAlternateLinks, HTML_LANG, type Lang } from '../utils/i18n';

interface Props {
  title: string;
  description: string;
  ogImage?: string;
}

const { title, description, ogImage } = Astro.props;
const lang: Lang = getLang(Astro.url);
const htmlLang = HTML_LANG[lang];
const alternateLinks = getAlternateLinks(Astro.url, Astro.site?.href ?? '');
---

<!doctype html>
<html lang={htmlLang} dir="ltr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <title>{title}</title>
    <meta name="description" content={description} />

    {/* ----- hreflang alternate links ----- */}
    {alternateLinks.map((link) => (
      <link rel="alternate" hreflang={link.hreflang} href={link.url} />
    ))}

    {/* ----- Canonical URL (self-referencing) ----- */}
    <link rel="canonical" href={new URL(Astro.url.pathname, Astro.site).href} />

    {/* ----- Open Graph with locale ----- */}
    <meta property="og:locale" content={htmlLang} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    {ogImage && <meta property="og:image" content={ogImage} />}

    {/* ----- Fonts: must support Latin Extended + Cyrillic ----- */}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&subset=latin,latin-ext,cyrillic,cyrillic-ext&display=swap"
      rel="stylesheet"
    />

    <slot name="head" />
  </head>
  <body>
    <slot />
  </body>
</html>
```

### Generated HTML Output Example

For the page `/ru/about`, the `<head>` will contain:

```html
<html lang="ru" dir="ltr">
<head>
  ...
  <link rel="alternate" hreflang="az" href="https://example.com/az/about/" />
  <link rel="alternate" hreflang="ru" href="https://example.com/ru/about/" />
  <link rel="alternate" hreflang="en" href="https://example.com/en/about/" />
  <link rel="alternate" hreflang="x-default" href="https://example.com/az/about/" />
  <link rel="canonical" href="https://example.com/ru/about/" />
  ...
</head>
```

---

## 6. Sitemap Configuration (`astro.config.mjs`)

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://example.com', // Replace with actual production domain
  integrations: [
    tailwind(),
    sitemap({
      i18n: {
        defaultLocale: 'az',
        locales: {
          az: 'az',
          ru: 'ru',
          en: 'en',
        },
      },
      filter: (page) => {
        // Exclude the root redirect page from the sitemap
        return page !== 'https://example.com/';
      },
    }),
  ],
  i18n: {
    defaultLocale: 'az',
    locales: ['az', 'ru', 'en'],
    routing: {
      prefixDefaultLocale: true, // All languages get prefixed: /az/, /ru/, /en/
    },
  },
});
```

### What This Produces

The sitemap plugin will emit `sitemap-index.xml` containing `sitemap-0.xml` with entries like:

```xml
<url>
  <loc>https://example.com/az/</loc>
  <xhtml:link rel="alternate" hreflang="az" href="https://example.com/az/" />
  <xhtml:link rel="alternate" hreflang="ru" href="https://example.com/ru/" />
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/" />
</url>
<url>
  <loc>https://example.com/ru/</loc>
  <xhtml:link rel="alternate" hreflang="az" href="https://example.com/az/" />
  <xhtml:link rel="alternate" hreflang="ru" href="https://example.com/ru/" />
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/" />
</url>
```

The `@astrojs/sitemap` integration automatically pairs pages across locales when the `i18n` option is set.

---

## 7. Page Template Example

### Shared Page Pattern

Every page under `/az/`, `/ru/`, `/en/` follows the same structure. The only differences are language-specific content and the imported strings.

#### Azerbaijani Homepage (`src/pages/az/index.astro`)

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Hero from '../../components/Hero.astro';
import Services from '../../components/Services.astro';
import CTA from '../../components/CTA.astro';
import { getLang, getStrings } from '../../utils/i18n';

const lang = getLang(Astro.url);
const t = await getStrings(lang);
---

<BaseLayout title={t.meta.homeTitle} description={t.meta.homeDescription}>
  <Hero
    lang={lang}
    headline="Azərbaycanda etibarlı tərəfdaşınız"
    subheadline="Peşəkar xidmətlər, müasir yanaşma"
    ctaText={t.ui.getInTouch}
    ctaHref={`/${lang}/contact/`}
  />
  <Services lang={lang} />
  <CTA
    lang={lang}
    title="Layihənizi müzakirə edək"
    buttonText={t.ui.getInTouch}
    buttonHref={`/${lang}/contact/`}
  />
</BaseLayout>
```

#### Russian Homepage (`src/pages/ru/index.astro`)

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Hero from '../../components/Hero.astro';
import Services from '../../components/Services.astro';
import CTA from '../../components/CTA.astro';
import { getLang, getStrings } from '../../utils/i18n';

const lang = getLang(Astro.url);
const t = await getStrings(lang);
---

<BaseLayout title={t.meta.homeTitle} description={t.meta.homeDescription}>
  <Hero
    lang={lang}
    headline="Ваш надёжный партнёр в Азербайджане"
    subheadline="Профессиональные услуги, современный подход"
    ctaText={t.ui.getInTouch}
    ctaHref={`/${lang}/contact/`}
  />
  <Services lang={lang} />
  <CTA
    lang={lang}
    title="Обсудим ваш проект"
    buttonText={t.ui.getInTouch}
    buttonHref={`/${lang}/contact/`}
  />
</BaseLayout>
```

#### English Homepage (`src/pages/en/index.astro`)

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Hero from '../../components/Hero.astro';
import Services from '../../components/Services.astro';
import CTA from '../../components/CTA.astro';
import { getLang, getStrings } from '../../utils/i18n';

const lang = getLang(Astro.url);
const t = await getStrings(lang);
---

<BaseLayout title={t.meta.homeTitle} description={t.meta.homeDescription}>
  <Hero
    lang={lang}
    headline="Your Trusted Partner in Azerbaijan"
    subheadline="Professional services, modern approach"
    ctaText={t.ui.getInTouch}
    ctaHref={`/${lang}/contact/`}
  />
  <Services lang={lang} />
  <CTA
    lang={lang}
    title="Let's discuss your project"
    buttonText={t.ui.getInTouch}
    buttonHref={`/${lang}/contact/`}
  />
</BaseLayout>
```

### Key Pattern: Shared Components, Language-Aware Content

- **Layout, components, and utilities** are shared across all three languages -- imported from `../../layouts/` and `../../components/`.
- **UI chrome strings** (button labels, nav items, form labels) come from JSON via `getStrings(lang)` and the `t` object.
- **Primary content** (headlines, paragraphs, descriptions) is written directly in each page file in the native language. This avoids awkward machine-translated phrasing.
- **The `lang` prop** is passed to shared components so they can render language-aware content (e.g., phone number formatting, date formatting, text direction if needed).

### Linking Between Pages

Internal links always include the language prefix:

```astro
<a href={`/${lang}/services/`}>{t.nav.services}</a>
<a href={`/${lang}/about/`}>{t.nav.about}</a>
```

Never hardcode a language prefix. Always use the `lang` variable.

---

## 8. Important Notes

### Text Length -- Russian Expansion

Russian text is typically 25-35% longer than equivalent English text. This has real layout implications:

| English | Russian | Expansion |
|---------|---------|-----------|
| Services | Услуги | ~0% |
| Read More | Читать далее | ~50% |
| Get in Touch | Свяжитесь с нами | ~40% |
| Privacy Policy | Политика конфиденциальности | ~100% |
| All rights reserved | Все права защищены | ~15% |

**Layout rules:**
- Never use fixed-width containers for text content.
- Buttons must use `px-4 py-2` minimum with `whitespace-nowrap` or allow wrapping gracefully.
- Navigation items should use `flex-wrap` or a hamburger menu that accommodates longer labels.
- Test all layouts with Russian text before shipping.
- Card grids should use `min-h-` rather than fixed `h-` to prevent overflow.

### Azerbaijani Special Characters

Azerbaijani uses the Latin script with these additional characters that are NOT in basic ASCII or standard Latin-1:

| Uppercase | Lowercase | Unicode |
|-----------|-----------|---------|
| Ə | ə | U+018F / U+0259 |
| Ğ | ğ | U+011E / U+011F |
| İ | i | U+0130 / U+0069 |
| I | ı | U+0049 / U+0131 |
| Ö | ö | U+00D6 / U+00F6 |
| Ü | ü | U+00DC / U+00FC |
| Ç | ç | U+00C7 / U+00E7 |
| Ş | ş | U+015E / U+015F |

**Critical note on I/i:** Azerbaijani distinguishes between dotted I (İ/i) and dotless I (I/ı). Standard `toUpperCase()` / `toLowerCase()` in JavaScript will produce wrong results. If case transformation is needed, use locale-aware methods:

```typescript
// WRONG: "istanbul".toUpperCase() --> "ISTANBUL"
// RIGHT for Azerbaijani:
"istanbul".toLocaleUpperCase('az') // --> "İSTANBUL"
"İSTANBUL".toLocaleLowerCase('az') // --> "istanbul"
```

### Font Requirements

All fonts used on the site must support **three character sets simultaneously**:
1. **Latin** -- English text
2. **Latin Extended** -- Azerbaijani characters (Ə, ə, Ğ, ğ, Ş, ş, etc.)
3. **Cyrillic** -- Russian text

**Recommended fonts (all support the required character sets):**
- **Inter** -- Modern, excellent Latin Extended + Cyrillic. Best for UI/body text.
- **Manrope** -- Geometric sans-serif with full coverage.
- **Nunito Sans** -- Rounded, friendly. Full coverage.
- **Roboto** -- Google's workhorse. Full coverage.
- **Noto Sans** -- Google's universal font. Covers every language.

When loading from Google Fonts, always request the subsets explicitly:

```
?family=Inter:wght@400;500;600;700&subset=latin,latin-ext,cyrillic,cyrillic-ext
```

**Do not use fonts that lack Latin Extended or Cyrillic support.** Missing glyphs will render as boxes or fall back to system fonts, creating a jarring visual experience.

### Content Authoring Guidelines

- **Write natively, do not translate word-for-word.** Each language version should read naturally to a native speaker. Sentence structure, idioms, and emphasis differ across languages.
- **Azerbaijani** is the primary language. Content should be authored in Azerbaijani first, then adapted (not translated) to Russian and English.
- **Russian** readers in Azerbaijan expect formal but accessible language. Avoid overly casual or slang-heavy copy.
- **English** content should be clear and professional -- this audience is likely international business contacts or expats.
- **Phone numbers** should use the local format: `+994 XX XXX XX XX`. Do not localize phone number formats per language.
- **Dates** should follow local conventions:
  - Azerbaijani: `1 aprel 2026` (day month year, month lowercase)
  - Russian: `1 апреля 2026 г.` (day month-genitive year)
  - English: `April 1, 2026` (month day, year)
- **Currency** is Azerbaijani Manat (AZN / &#8380;). Symbol: `₼`. Place after the number: `100 ₼`.

### SEO Considerations

- Every page must have unique `<title>` and `<meta name="description">` per language.
- hreflang tags must appear on every page, pointing to all three language versions plus `x-default`.
- `x-default` always points to the Azerbaijani (`/az/`) version.
- The root `/` must not appear in the sitemap -- it is only a redirect.
- Canonical URLs must be self-referencing (each language version canonicalizes to itself).
- Open Graph `og:locale` should be set to the BCP 47 language tag.

### Astro 5.x Specifics

- Astro 5's built-in `i18n` routing in `astro.config.mjs` handles the prefix logic at the framework level. The `prefixDefaultLocale: true` setting ensures even the default language (az) gets a prefix.
- The `Astro.currentLocale` property is available in components when the `i18n` config is set, but the `getLang()` utility function provides more explicit control and works identically in both SSR and SSG modes.
- JSON imports work natively in Astro 5. The `import('../content/i18n/az.json')` pattern enables tree-shaking.
- For content collections (blog posts, services), create separate directories per language or use a `lang` field in frontmatter to filter.

---

## Quick Reference: Adding a New Page

To add a new page (e.g., `/az/faq/`, `/ru/faq/`, `/en/faq/`):

1. Add strings to all three JSON files under a new key (e.g., `"faq": { ... }`).
2. Create `src/pages/az/faq.astro`, `src/pages/ru/faq.astro`, `src/pages/en/faq.astro`.
3. Each file imports `BaseLayout`, calls `getLang()` and `getStrings()`, and contains native-language content.
4. Add the nav link to the header component using `t.nav.faq` (after adding the key to the nav object in each JSON file).
5. Verify hreflang tags render correctly by checking the HTML output.
6. Test the language switcher preserves the new page path when switching.
