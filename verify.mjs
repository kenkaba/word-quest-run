import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const requiredFiles = ['index.html', 'game.js', 'words.js', 'sw.js', 'netlify.toml'];
const files = Object.fromEntries(
  await Promise.all(requiredFiles.map(async (name) => [name, await readFile(name, 'utf8')]))
);

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const name of ['game.js', 'words.js', 'sw.js']) {
  try {
    new vm.Script(files[name], { filename: name });
  } catch (error) {
    failures.push(`${name}: JavaScript syntax error: ${error.message}`);
  }
}

for (const asset of ['words.js', 'game.js', 'sw.js']) {
  check(files['index.html'].includes(asset), `index.html: missing ${asset} reference`);
}

check(
  /<meta name="wqr-build" content="[^"]+"\s*\/?>/.test(files['index.html']),
  'index.html: missing wqr-build release marker'
);
check(/var CACHE = 'wqr-v[^']+';/.test(files['sw.js']), 'sw.js: missing versioned cache name');
check(/publish\s*=\s*"\."/.test(files['netlify.toml']), 'netlify.toml: publish directory must remain repository root');
check(/window\.WORDS\s*=\s*\[/.test(files['words.js']), 'words.js: missing window.WORDS data');
check(/selftest=1/.test(files['game.js']), 'game.js: browser self-test entry point is missing');

if (failures.length) {
  console.error(`WORD QUEST RUN verification failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('WORD QUEST RUN verification passed.');
console.log(`Checked ${requiredFiles.length} production files, JavaScript syntax, release marker, cache version, and deploy config.`);

