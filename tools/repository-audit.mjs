import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const isExternal = (value) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value.trim());
const localTarget = (value) => {
  const raw = value.trim();
  if (!raw || isExternal(raw)) return null;
  const withoutQuery = raw.split(/[?#]/, 1)[0];
  if (!withoutQuery) return null;
  let decoded;
  try { decoded = decodeURIComponent(withoutQuery); } catch { decoded = withoutQuery; }
  return path.resolve(repoRoot, decoded.replace(/^[/\\]+/, '').replace(/^\.\//, ''));
};

const htmlFiles = fs.readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
  .map((entry) => entry.name)
  .sort();

for (const fileName of htmlFiles) {
  const filePath = path.join(repoRoot, fileName);
  const source = fs.readFileSync(filePath, 'utf8');
  const references = [...source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)];
  for (const [, reference] of references) {
    const target = localTarget(reference);
    if (!target) continue;
    const relative = path.relative(repoRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      failures.push(`${fileName}: local reference escapes repository: ${reference}`);
    } else if (!fs.existsSync(target)) {
      failures.push(`${fileName}: missing local reference: ${reference}`);
    }
  }
}

const forbiddenRootArtifacts = fs.readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:js|html|css|json|sql)$/i.test(entry.name))
  .map((entry) => entry.name)
  .filter((name) => /(?:^|[-_.])(backup|hotfix|patch|replacement|temporary|tmp|fixed|v2)(?:[-_.]|\.)/i.test(name));
for (const artifact of forbiddenRootArtifacts) failures.push(`parallel implementation artifact: ${artifact}`);

if (fs.existsSync(path.join(repoRoot, '.vercel', 'output'))) {
  failures.push('stale generated output exists: .vercel/output');
}

if (failures.length) {
  console.error('Repository audit failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Repository audit passed: ${htmlFiles.length} HTML routes, local links/assets resolved, no parallel artifacts, and no stale .vercel/output.`);
}
