// The demo's tests: the page must have a title and a version line. Exit 0 = lit, anything else = dark.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync('site/index.html', 'utf8');
assert.match(html, /<h1>[^<]+<\/h1>/, 'page needs an <h1>');
assert.match(html, /<p id="version">Version \d+<\/p>/, 'page needs a version line');
console.log('● lit');
