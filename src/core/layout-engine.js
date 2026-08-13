const { ContractError, deepFreeze } = require('./contracts');

const SAFE_MARGIN = 0.4;
const MIN_BOX_SIZE = 0.05;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function number(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new ContractError('layout_invalid', `${field} must be a finite number.`);
  return result;
}

function validateBox(box, canvas, field) {
  if (!box || typeof box !== 'object') throw new ContractError('layout_invalid', `${field}.box is required.`);
  const x = number(box.x, `${field}.box.x`);
  const y = number(box.y, `${field}.box.y`);
  const w = number(box.w, `${field}.box.w`);
  const h = number(box.h, `${field}.box.h`);
  if (w < MIN_BOX_SIZE || h < MIN_BOX_SIZE) throw new ContractError('layout_invalid', `${field}.box must have positive dimensions.`);
  if (x < SAFE_MARGIN || y < SAFE_MARGIN || x + w > canvas.width - SAFE_MARGIN || y + h > canvas.height - SAFE_MARGIN) {
    throw new ContractError('layout_overflow', `${field}.box exceeds the safe canvas area.`);
  }
  return { x, y, w, h };
}

function fallbackBox(type, index, canvas, elementCount = 1) {
  // Model output supplies semantics, not geometry. A three-column safe grid
  // keeps deterministic fallback placement inside the canvas for arbitrary
  // editable element counts instead of allowing tall placeholders to overflow.
  const columns = Math.max(1, Math.ceil(Math.sqrt(elementCount)));
  const rows = Math.max(1, Math.ceil(elementCount / columns));
  const gap = 0.18;
  const width = (canvas.width - SAFE_MARGIN * 2 - gap * (columns - 1)) / columns;
  const height = (canvas.height - SAFE_MARGIN * 2 - gap * (rows - 1) - 0.02) / rows;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return { x: SAFE_MARGIN + column * (width + gap), y: SAFE_MARGIN + row * (height + gap), w: width, h: height };
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function composeDocument(document) {
  if (!document || typeof document !== 'object' || !document.canvas) throw new ContractError('layout_invalid', 'A validated document with a canvas is required.');
  const canvas = { width: number(document.canvas.width, 'canvas.width'), height: number(document.canvas.height, 'canvas.height') };
  if (canvas.width <= SAFE_MARGIN * 2 || canvas.height <= SAFE_MARGIN * 2) throw new ContractError('layout_invalid', 'Canvas is too small for the safe margin.');
  const composed = clone(document);
  const diagnostics = [];
  for (const [slideIndex, slide] of composed.slides.entries()) {
    const occupied = [];
    for (const [elementIndex, element] of slide.elements.entries()) {
      const field = `slides[${slideIndex}].elements[${elementIndex}]`;
      const box = element.box || fallbackBox(element.type, elementIndex, canvas, slide.elements.length);
      const validated = validateBox(box, canvas, field);
      element.box = validated;
      const collision = occupied.find(item => intersects(item.box, validated));
      if (collision && element.type !== 'background' && collision.type !== 'background') {
        diagnostics.push({ criterion: 'no_unintended_overlap', status: 'FAIL', severity: 'error', slide_id: slide.slide_id, element_id: element.element_id, conflicts_with: collision.element_id });
      } else {
        diagnostics.push({ criterion: 'safe_geometry', status: 'PASS', severity: 'info', slide_id: slide.slide_id, element_id: element.element_id });
      }
      occupied.push({ element_id: element.element_id, type: element.type, box: validated });
    }
  }
  composed.layout_version = '1.0';
  composed.layout_diagnostics = diagnostics;
  return { document: deepFreeze(composed), diagnostics: deepFreeze(diagnostics) };
}

module.exports = { MIN_BOX_SIZE, SAFE_MARGIN, composeDocument, intersects, validateBox };
