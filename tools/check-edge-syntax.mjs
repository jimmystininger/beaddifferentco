import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

const functionsDirectory = path.resolve('supabase/functions');
const files = fs.readdirSync(functionsDirectory, { recursive: true })
  .filter((file) => file.endsWith('.ts'));
let failed = false;

for (const file of files) {
  const sourcePath = path.join(functionsDirectory, file);
  try {
    const source = stripTypeScriptTypes(fs.readFileSync(sourcePath, 'utf8'), { mode: 'transform' });
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: source,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      failed = true;
      process.stderr.write(`${file}: ${result.stderr}`);
    }
  } catch (error) {
    failed = true;
    process.stderr.write(`${file}: ${error.message}\n`);
  }
}

if (failed) process.exitCode = 1;
else process.stdout.write(`Edge Function syntax passed: ${files.length} TypeScript files.\n`);
