const fs = require('node:fs');
const path = require('node:path');
const { validateSemanticReview, SEMANTIC_RUBRIC_VERSION } = require('../src/core/three-way-evaluator');

function inputPath(argv) {
  const index = argv.indexOf('--input');
  return index >= 0 && argv[index + 1] ? argv[index + 1] : argv[2];
}

function main() {
  const supplied = inputPath(process.argv);
  if (!supplied) {
    process.stderr.write('Usage: node scripts/validate-semantic-review.js --input <review.json>\n');
    process.exitCode = 2;
    return;
  }
  const resolved = path.resolve(supplied);
  let review;
  try {
    review = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    process.stderr.write(`Could not read semantic review JSON: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const result = validateSemanticReview(review);
  const output = { rubric_version: SEMANTIC_RUBRIC_VERSION, input: resolved, ...result };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  // An incomplete review is a truthful verification outcome, but it must not
  // pass a CI or handoff gate as if semantic quality had been established.
  process.exitCode = result.status === 'PASS' && result.scoring_allowed === true ? 0 : 2;
}

main();
