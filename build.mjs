// Copies site/ to dist/ and stamps the commit sha. Relative links only, so it works under /c/<sha>/ and at /.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('site', 'dist', { recursive: true });
const sha = process.env.GITHUB_SHA || 'local';
writeFileSync('dist/index.html', readFileSync('dist/index.html', 'utf8').replaceAll('__SHA__', sha));
