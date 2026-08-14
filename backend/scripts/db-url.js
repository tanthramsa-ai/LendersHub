/* eslint-disable */
/**
 * Resolve DATABASE_URL for host-run maintenance scripts, and fail loudly on the
 * two traps that have actually bitten us in production:
 *
 * 1. backend/.env ships with placeholder credentials
 *    (postgres:change_me_strong_password). dotenv does NOT overwrite a variable
 *    that is already set, and backend/.env is loaded first — so it silently
 *    shadows the real credentials in the repo-root .env. The symptom is a bare
 *    "password authentication failed for user postgres", which looks like a
 *    permissions problem rather than the wrong file winning.
 *
 * 2. The root .env's DATABASE_URL points at host `db` (the Docker Compose
 *    service name). That resolves inside the Compose network but not from the
 *    VM host, where these scripts run — symptom is "getaddrinfo EAI_AGAIN db".
 *    From the host, the DB is reachable on the published port (localhost:5433).
 *
 * Always prints the resolved target with the password redacted, so which
 * database a script is about to touch is never a guess.
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
  try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (_) {}
  try { require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') }); } catch (_) {}
}

function redact(url) {
  return String(url).replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@');
}

const PLACEHOLDER = /change[_-]?me|your[_-]?password|xxxxx|placeholder/i;

/** True when running inside a container (Compose hostnames like `db` resolve there). */
function inContainer() {
  try { return fs.existsSync('/.dockerenv'); } catch (_) { return false; }
}

function resolveDatabaseUrl() {
  loadEnv();
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL is not set (checked env, backend/.env, and the repo-root .env).');
    console.error('Pass it explicitly:');
    console.error('  DATABASE_URL="postgresql://<user>:<pass>@localhost:5433/lendershub" node scripts/<script>.js');
    process.exit(1);
  }

  if (PLACEHOLDER.test(url)) {
    console.error(`DATABASE_URL looks like an unedited placeholder: ${redact(url)}`);
    console.error('');
    console.error('This almost certainly came from backend/.env, which dotenv loads BEFORE the');
    console.error('repo-root .env and which therefore shadows the real credentials there.');
    console.error('Either fix/delete backend/.env, or pass the real URL inline:');
    console.error('  DATABASE_URL="postgresql://<user>:<pass>@localhost:5433/lendershub" node scripts/<script>.js');
    process.exit(1);
  }

  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  if (host === 'db' && !inContainer()) {
    console.error(`DATABASE_URL points at host "db" (${redact(url)}), but this is not running inside a container.`);
    console.error('"db" is the Docker Compose service name — it only resolves between containers.');
    console.error('From the VM host, use the published port instead:');
    console.error('  DATABASE_URL="postgresql://<user>:<pass>@localhost:5433/lendershub" node scripts/<script>.js');
    process.exit(1);
  }

  console.log(`Database: ${redact(url)}`);
  return url;
}

module.exports = { resolveDatabaseUrl, redact };
