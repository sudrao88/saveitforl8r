#!/usr/bin/env node
/**
 * Generates version.json for OTA update checking.
 * Run as part of the build process to ensure version info is up-to-date.
 *
 * Usage: node scripts/generate-version.js [outputDir]
 *
 * The version is derived from the service worker CACHE_NAME in public/sw.js
 * to ensure consistency between the service worker cache version and the
 * version reported to native apps for OTA update checks.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Default output directory (can be overridden via command line)
const outputDir = process.argv[2] || join(projectRoot, 'dist');
const publicDir = join(projectRoot, 'public');

// Read the service worker to extract the current version
function extractVersionFromSW() {
  const swPath = join(projectRoot, 'public', 'sw.js');
  const swContent = readFileSync(swPath, 'utf8');

  // Extract CACHE_NAME value: const CACHE_NAME = 'saveitforl8r-v24';
  const match = swContent.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error('Could not extract CACHE_NAME from sw.js');
  }

  return match[1];
}

// Extract build number from version string (e.g., 'saveitforl8r-v24' -> 24)
function extractBuildNumber(version) {
  const match = version.match(/-v(\d+)$/);
  return match ? parseInt(match[1], 10) : 1;
}

// Read minNativeVersion from existing version.json if it exists
function getMinNativeVersion() {
  try {
    // Try to read from public/version.json first as it is the source
    const existingPath = join(publicDir, 'version.json');
    if (existsSync(existingPath)) {
        const existing = JSON.parse(readFileSync(existingPath, 'utf8'));
        return existing.minNativeVersion || '1.0.0';
    }
    return '1.0.0';
  } catch {
    return '1.0.0';
  }
}

// Read changelog from existing version.json or use default
function getChangelog() {
  try {
    const existingPath = join(publicDir, 'version.json');
    if (existsSync(existingPath)) {
        const existing = JSON.parse(readFileSync(existingPath, 'utf8'));
        return existing.changelog || 'Bug fixes and improvements';
    }
    return 'Bug fixes and improvements';
  } catch {
    return 'Bug fixes and improvements';
  }
}

function main() {
  try {
      const version = extractVersionFromSW();
      const buildNumber = extractBuildNumber(version);
      const minNativeVersion = getMinNativeVersion();
      const changelog = getChangelog();

      const versionInfo = {
        version,
        buildNumber,
        buildDate: new Date().toISOString(),
        minNativeVersion,
        changelog
      };

      // Ensure output directory exists
      mkdirSync(outputDir, { recursive: true });

      // Write to dist/version.json (for deployment)
      const outputPath = join(outputDir, 'version.json');
      writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2) + '\n');
      console.log(`[generate-version] Generated ${outputPath}`);

      // Write to public/version.json (for dev/source consistency)
      const publicPath = join(publicDir, 'version.json');
      writeFileSync(publicPath, JSON.stringify(versionInfo, null, 2) + '\n');
      console.log(`[generate-version] Updated ${publicPath}`);

      console.log(`[generate-version] Version: ${version} (build ${buildNumber})`);
  } catch (error) {
      console.error('[generate-version] Error:', error);
      process.exit(1);
  }
}

main();
