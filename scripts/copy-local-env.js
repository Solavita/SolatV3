const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, '.env');
const target = path.join(projectRoot, 'dist', 'win-unpacked', '.env');

if (!fs.existsSync(source)) {
  console.log('No local .env found; packaged SOLAT will show its configuration guidance until one is supplied.');
  process.exit(0);
}

fs.copyFileSync(source, target);
console.log('Copied the local provider configuration beside the packaged SOLAT executable. Do not share this .env file.');
