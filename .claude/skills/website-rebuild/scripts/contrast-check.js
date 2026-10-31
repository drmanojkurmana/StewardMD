#!/usr/bin/env node
/**
 * Contrast Ratio Checker
 *
 * Usage: node contrast-check.js [--tokens path/to/tokens.css]
 *
 * Reads CSS custom property definitions and computes WCAG contrast ratios
 * for all text/background color pairs. Outputs a report showing pass/fail
 * status for WCAG AA and AAA levels.
 *
 * Can also be used standalone:
 *   node contrast-check.js --check "#111827" "#FFFFFF"
 */

const fs = require('fs');

// Relative luminance calculation per WCAG 2.1
function sRGBtoLinear(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function hexToRGB(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16)
  };
}

function contrastRatio(hex1, hex2) {
  const rgb1 = hexToRGB(hex1);
  const rgb2 = hexToRGB(hex2);
  const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function wcagLevel(ratio, isLargeText = false) {
  if (isLargeText) {
    if (ratio >= 4.5) return 'AAA PASS';
    if (ratio >= 3.0) return 'AA PASS';
    return 'FAIL';
  }
  if (ratio >= 7.0) return 'AAA PASS';
  if (ratio >= 4.5) return 'AA PASS';
  return 'FAIL';
}

// Parse CSS file for custom properties with color values
function extractColorsFromCSS(cssContent) {
  const colors = {};
  const regex = /--([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  let match;
  while ((match = regex.exec(cssContent)) !== null) {
    colors[`--${match[1]}`] = match[2];
  }
  return colors;
}

// Main
const args = process.argv.slice(2);

if (args[0] === '--check' && args.length === 3) {
  // Quick single-pair check
  const ratio = contrastRatio(args[1], args[2]);
  console.log(`\nContrast: ${args[1]} on ${args[2]}`);
  console.log(`Ratio: ${ratio.toFixed(2)}:1`);
  console.log(`Normal text: ${wcagLevel(ratio, false)}`);
  console.log(`Large text:  ${wcagLevel(ratio, true)}`);
  process.exit(ratio >= 4.5 ? 0 : 1);
}

if (args[0] === '--tokens' && args[1]) {
  // Full token audit
  const cssContent = fs.readFileSync(args[1], 'utf-8');
  const colors = extractColorsFromCSS(cssContent);
  const colorNames = Object.keys(colors);

  if (colorNames.length === 0) {
    console.log('No CSS custom property colors found in file.');
    process.exit(1);
  }

  console.log(`\nFound ${colorNames.length} color tokens.\n`);
  console.log('='.repeat(90));
  console.log('CONTRAST RATIO AUDIT');
  console.log('='.repeat(90));

  // Identify text colors (containing 'text', 'fg', 'foreground') and bg colors
  const textColors = colorNames.filter(n => /text|fg|foreground|heading|body|link|label/i.test(n));
  const bgColors = colorNames.filter(n => /bg|background|surface|card|hero|section/i.test(n));

  // If we can't classify, test all pairs
  const fgList = textColors.length > 0 ? textColors : colorNames;
  const bgList = bgColors.length > 0 ? bgColors : colorNames;

  let failures = 0;
  const results = [];

  for (const fg of fgList) {
    for (const bg of bgList) {
      if (fg === bg) continue;
      const ratio = contrastRatio(colors[fg], colors[bg]);
      const normalLevel = wcagLevel(ratio, false);
      const largeLevel = wcagLevel(ratio, true);
      const passed = normalLevel.includes('PASS');
      if (!passed) failures++;
      results.push({ fg, bg, fgHex: colors[fg], bgHex: colors[bg], ratio, normalLevel, largeLevel, passed });
    }
  }

  // Print results
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const indicator = r.passed ? '  ' : '!!';
    console.log(`${indicator} ${r.fg} (${r.fgHex}) on ${r.bg} (${r.bgHex})`);
    console.log(`   Ratio: ${r.ratio.toFixed(2)}:1 | Normal: ${r.normalLevel} | Large: ${r.largeLevel}`);
  }

  console.log('\n' + '='.repeat(90));
  console.log(`Total pairs checked: ${results.length}`);
  console.log(`Passing (AA normal): ${results.length - failures}`);
  console.log(`Failing: ${failures}`);
  console.log('='.repeat(90));

  process.exit(failures > 0 ? 1 : 0);
}

// Usage
console.log('Usage:');
console.log('  node contrast-check.js --check "#foreground" "#background"');
console.log('  node contrast-check.js --tokens path/to/globals.css');
