import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvLocal } from './env.js';

loadEnvLocal();

export const BASE_URL = process.env.LEARN_BASE_URL ?? 'https://learn.uwaterloo.ca';

// Resolve auth.json relative to the project root so the server works no matter
// what cwd the desktop app launches it with. This file lives in src/ (or dist/
// after compilation), so the root is one level up either way.
const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, '..');
export const AUTH_FILE = process.env.LEARN_AUTH_FILE ?? path.join(PROJECT_ROOT, 'auth.json');
export const OUTLINE_CACHE_DIR = process.env.LEARN_OUTLINE_CACHE_DIR ?? path.join(PROJECT_ROOT, 'cache', 'outlines');
export const GOOGLE_DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY;
export const GOOGLE_DRIVE_ACCESS_TOKEN = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
export const GOOGLE_DRIVE_FOLDER_IDS = (
  process.env.GOOGLE_DRIVE_FOLDER_IDS ?? '1yYicgQ3n8z-DutH3-kVtatmAcxpHK3cf'
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

export const LOGIN_HELP =
  `No valid LEARN session. Run \`npm run login\` in ${PROJECT_ROOT} to open a browser, ` +
  `sign in with your WatIAM credentials, approve the Duo push, and save a fresh session to auth.json.`;
