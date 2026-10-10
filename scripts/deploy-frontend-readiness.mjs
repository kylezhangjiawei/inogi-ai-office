import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// Verify the files Nginx actually serves, not merely the root user's disk access.
// The published frontend can legitimately retain an older version on API-only releases.
async function verifyFrontend(site, directory) {
  const base = new URL(site);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('DEPLOY_FRONTEND_URL must be an HTTP(S) site root without credentials, query or fragment');
  }
  const root = resolve(directory);
  const signal = AbortSignal.timeout(30_000);
  async function verifyFile(url, relativePath, acceptedTypes) {
    const path = resolve(root, relativePath);
    if (!path.startsWith(root + sep)) throw new Error(`Asset path escapes WEB_ROOT: ${url.pathname}`);
    const expected = await readFile(path);
    if (!expected.length) throw new Error(`Empty published file: ${relativePath}`);
    const response = await fetch(url, { redirect: 'error', signal, headers: { 'Cache-Control': 'no-cache' } });
    if (response.status !== 200) throw new Error(`${url.pathname}: HTTP ${response.status}`);
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!acceptedTypes.includes(type)) throw new Error(`${url.pathname}: unexpected Content-Type ${type}`);
    if (!Buffer.from(await response.arrayBuffer()).equals(expected)) {
      throw new Error(`${url.pathname}: served content differs from published file`);
    }
    return expected;
  }

  const html = (await verifyFile(base, 'index.html', ['text/html'])).toString('utf8');
  const version = JSON.parse((await verifyFile(new URL('version.json', base), 'version.json', ['application/json'])).toString('utf8'));
  if (typeof version.release !== 'string' || !version.release.trim()
      || typeof version.git_sha !== 'string' || !version.git_sha.trim()) {
    throw new Error('version.json must contain release and git_sha');
  }
  const assets = new Map();
  let entryScripts = 0;
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
    const script = tag[1].toLowerCase() === 'script';
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
    const css = !script && rel.includes('stylesheet');
    if (!script && !css && !rel.includes('modulepreload')) continue;
    const reference = script ? attrs.src : attrs.href;
    if (!reference) continue;
    const url = new URL(reference.replaceAll('&amp;', '&'), base);
    // External fonts/CDNs are not files from this release and are outside this gate.
    if (url.origin !== base.origin) continue;
    const relativePath = decodeURIComponent(url.pathname).slice(1);
    assets.set(url.href, { url, relativePath, css });
    if (script) entryScripts++;
  }
  if (!entryScripts) throw new Error('index.html has no local JavaScript entry');
  for (const { url, relativePath, css } of assets.values()) {
    await verifyFile(url, relativePath, css ? ['text/css'] : ['application/javascript', 'text/javascript']);
  }
  console.log(`Frontend ready: ${version.release} (${version.git_sha}), ${assets.size} local assets verified`);
}

try {
  const [site, directory] = process.argv.slice(2);
  if (!site || !directory) throw new Error('usage: deploy-frontend-readiness.mjs <site-root-url> <web-root>');
  await verifyFrontend(site, directory);
} catch (error) {
  console.error(`Frontend readiness failed: ${error.message}`);
  process.exitCode = 1;
}
