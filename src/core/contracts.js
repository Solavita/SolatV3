const crypto = require('node:crypto');

const DOMAIN_SCHEMA_VERSION = '1.0';
const EMOTION_SCHEMA_VERSION = '2.0';
const DOCUMENT_SCHEMA_VERSION = '1.0';

const PROJECT_STATUSES = Object.freeze([
  'DRAFT_INPUT',
  'INPUT_VALIDATED',
  'EMOTION_REVIEW',
  'OUTLINE_REVIEW',
  'DESIGN_PLANNED',
  'COMPOSING',
  'QUALITY_REVIEW',
  'READY_FOR_EDIT',
  'EXPORTING',
  'EXPORTED',
  'PARTIALLY_READY',
  'BLOCKED',
  'FAILED_RECOVERABLE',
  'FAILED_TERMINAL',
  'ARCHIVED',
  'DELETION_PENDING',
]);

const JOB_STATUSES = Object.freeze([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'CANCELLED',
]);

const PROJECT_TRANSITIONS = Object.freeze({
  DRAFT_INPUT: ['INPUT_VALIDATED', 'BLOCKED', 'DELETION_PENDING'],
  INPUT_VALIDATED: ['EMOTION_REVIEW', 'OUTLINE_REVIEW', 'PARTIALLY_READY', 'FAILED_RECOVERABLE', 'BLOCKED'],
  EMOTION_REVIEW: ['OUTLINE_REVIEW', 'INPUT_VALIDATED', 'FAILED_RECOVERABLE', 'BLOCKED'],
  OUTLINE_REVIEW: ['DESIGN_PLANNED', 'EMOTION_REVIEW', 'FAILED_RECOVERABLE', 'BLOCKED'],
  DESIGN_PLANNED: ['COMPOSING', 'OUTLINE_REVIEW', 'FAILED_RECOVERABLE', 'BLOCKED'],
  COMPOSING: ['QUALITY_REVIEW', 'FAILED_RECOVERABLE', 'FAILED_TERMINAL', 'BLOCKED'],
  QUALITY_REVIEW: ['READY_FOR_EDIT', 'COMPOSING', 'PARTIALLY_READY', 'FAILED_RECOVERABLE', 'BLOCKED'],
  READY_FOR_EDIT: ['EXPORTING', 'QUALITY_REVIEW', 'COMPOSING', 'ARCHIVED', 'DELETION_PENDING'],
  EXPORTING: ['EXPORTED', 'READY_FOR_EDIT', 'FAILED_RECOVERABLE', 'FAILED_TERMINAL'],
  EXPORTED: ['READY_FOR_EDIT', 'ARCHIVED', 'DELETION_PENDING'],
  PARTIALLY_READY: ['INPUT_VALIDATED', 'EMOTION_REVIEW', 'OUTLINE_REVIEW', 'DESIGN_PLANNED', 'QUALITY_REVIEW', 'BLOCKED'],
  BLOCKED: ['DRAFT_INPUT', 'INPUT_VALIDATED', 'FAILED_TERMINAL', 'DELETION_PENDING'],
  FAILED_RECOVERABLE: ['INPUT_VALIDATED', 'EMOTION_REVIEW', 'OUTLINE_REVIEW', 'DESIGN_PLANNED', 'COMPOSING', 'QUALITY_REVIEW', 'EXPORTING', 'FAILED_TERMINAL'],
  FAILED_TERMINAL: ['DRAFT_INPUT', 'DELETION_PENDING', 'ARCHIVED'],
  ARCHIVED: ['DELETION_PENDING'],
  DELETION_PENDING: [],
});

const JOB_TRANSITIONS = Object.freeze({
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  FAILED_RETRYABLE: ['QUEUED', 'RUNNING', 'FAILED_TERMINAL', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED_TERMINAL: [],
  CANCELLED: [],
});

const ASSET_CLASSES = Object.freeze([
  'ORIGINAL_USER_ASSET',
  'DERIVED_NON_GENERATIVE',
  'AI_GENERATED_ASSET',
  'AI_EDITED_ASSET',
  'EXTERNAL_LICENSED_ASSET',
  'SEARCH_REFERENCE_ONLY',
]);

const ELEMENT_TYPES = Object.freeze([
  'text',
  'original_image',
  'generated_image',
  'shape',
  'line',
  'icon',
  'table',
  'chart',
  'group',
  'background',
  'media_placeholder',
  'citation',
]);

class ContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isoNow(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new ContractError('contract_invalid', 'Timestamp must be a valid date.');
  return date.toISOString();
}

function makeId(prefix, idFactory = crypto.randomUUID) {
  const id = typeof idFactory === 'function' ? idFactory() : '';
  if (typeof id !== 'string' || !id.trim()) throw new ContractError('contract_invalid', `Unable to create ${prefix} id.`);
  return `${prefix}_${id}`;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContractError('contract_invalid', `${field} is required.`, { field });
  }
  return value.trim();
}

function optionalString(value, field, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new ContractError('contract_invalid', `${field} must be text.`, { field });
  return value.trim();
}

function boundedNumber(value, field, fallback = 0) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new ContractError('contract_invalid', `${field} must be between 0 and 1.`, { field });
  }
  return number;
}

function arrayOf(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ContractError('contract_invalid', `${field} must be an array.`, { field });
  return clone(value);
}

function assertProjectStatus(status) {
  if (!PROJECT_STATUSES.includes(status)) throw new ContractError('contract_invalid', `Unknown project status: ${status}.`);
}

function assertJobStatus(status) {
  if (!JOB_STATUSES.includes(status)) throw new ContractError('contract_invalid', `Unknown job status: ${status}.`);
}

function createProject({
  ownerId,
  sessionId = ownerId,
  title = 'Untitled project',
  purpose = '',
  audience = '',
  language = 'en',
  now,
  idFactory,
} = {}) {
  const createdAt = isoNow(now);
  return deepFreeze({
    schema_version: DOMAIN_SCHEMA_VERSION,
    project_id: makeId('prj', idFactory),
    owner_id: requiredString(ownerId, 'owner_id'),
    session_id: requiredString(sessionId, 'session_id'),
    title: requiredString(title, 'title'),
    purpose: optionalString(purpose, 'purpose'),
    audience: optionalString(audience, 'audience'),
    language: optionalString(language, 'language', 'en'),
    current_revision: 0,
    status: 'DRAFT_INPUT',
    brief_id: null,
    emotion_profile_id: null,
    narrative_plan_id: null,
    design_system_id: null,
    document_id: null,
    asset_ids: [],
    job_ids: [],
    retention: { state: 'active', deletion_requested_at: null },
    created_at: createdAt,
    updated_at: createdAt,
  });
}

function createCreativeBrief({ projectId, goal, audience, contentSources, language = 'en', outputRequirements, factualityRequirements, brandRules, prohibitedStyles, accessibilityNeeds, slideCount, outputFormat, assetIds, userLocks, riskFlags, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  return deepFreeze({
    schema_version: DOMAIN_SCHEMA_VERSION,
    brief_id: makeId('brief', idFactory),
    project_id: requiredString(projectId, 'project_id'),
    version: 1,
    goal: requiredString(goal, 'goal'),
    audience: requiredString(audience, 'audience'),
    language: optionalString(language, 'language', 'en'),
    content_sources: arrayOf(contentSources, 'content_sources'),
    constraints: { brand_rules: clone(brandRules || {}), prohibited_styles: arrayOf(prohibitedStyles, 'prohibited_styles'), accessibility_needs: arrayOf(accessibilityNeeds, 'accessibility_needs') },
    factuality_requirements: clone(factualityRequirements || {}),
    output_requirements: clone(outputRequirements || {}),
    slide_count: slideCount === undefined ? null : Number(slideCount),
    output_format: outputFormat === undefined ? null : optionalString(outputFormat, 'output_format', null),
    emotion_profile_id: null,
    asset_ids: arrayOf(assetIds, 'asset_ids'),
    user_locks: arrayOf(userLocks, 'user_locks'),
    risk_flags: arrayOf(riskFlags, 'risk_flags'),
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function createEmotionProfile({ projectId, primaryEmotion, secondaryEmotions, dimensions, influence, arc, confidence, provenance, lockedFields, inferredFields, conflicts, explanation, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  const normalizedDimensions = {};
  for (const [field, value] of Object.entries(dimensions || {})) normalizedDimensions[field] = boundedNumber(value, `dimensions.${field}`);
  const normalizedInfluence = {
    mode: optionalString(influence?.mode, 'influence.mode', 'balanced'),
    narrative: boundedNumber(influence?.narrative, 'influence.narrative', 0.5),
    visual: boundedNumber(influence?.visual, 'influence.visual', 0.5),
    motion: boundedNumber(influence?.motion, 'influence.motion', 0.5),
    colour: boundedNumber(influence?.colour, 'influence.colour', 0.5),
  };
  const normalizedArc = arrayOf(arc, 'arc').map((segment, index) => {
    if (!segment || typeof segment !== 'object') throw new ContractError('contract_invalid', `arc[${index}] must be an object.`);
    const position = boundedNumber(segment.position, `arc[${index}].position`);
    return { ...segment, position, energy: boundedNumber(segment.energy, `arc[${index}].energy`), tension: boundedNumber(segment.tension, `arc[${index}].tension`) };
  });
  return deepFreeze({
    schema_version: EMOTION_SCHEMA_VERSION,
    profile_id: makeId('emo', idFactory),
    project_id: requiredString(projectId, 'project_id'),
    version: 1,
    primary_emotion: requiredString(primaryEmotion, 'primary_emotion'),
    secondary_emotions: arrayOf(secondaryEmotions, 'secondary_emotions'),
    dimensions: normalizedDimensions,
    influence: normalizedInfluence,
    arc: normalizedArc,
    confidence: boundedNumber(confidence, 'confidence', 0),
    locked_fields: arrayOf(lockedFields, 'locked_fields'),
    inferred_fields: arrayOf(inferredFields, 'inferred_fields'),
    conflicts: arrayOf(conflicts, 'conflicts'),
    explanation: optionalString(explanation, 'explanation'),
    provenance: clone(provenance || {}),
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function createNarrativePlan({ projectId, slides, arc, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  if (!Array.isArray(slides) || slides.length === 0) throw new ContractError('contract_invalid', 'slides must contain at least one slide.');
  const normalizedSlides = slides.map((slide, index) => {
    if (!slide || typeof slide !== 'object') throw new ContractError('contract_invalid', `slides[${index}] must be an object.`);
    return {
      slide_id: requiredString(slide.slide_id, `slides[${index}].slide_id`),
      communication_objective: requiredString(slide.communication_objective, `slides[${index}].communication_objective`),
      audience_question: optionalString(slide.audience_question, `slides[${index}].audience_question`),
      content_summary: optionalString(slide.content_summary, `slides[${index}].content_summary`),
      evidence_needs: arrayOf(slide.evidence_needs, `slides[${index}].evidence_needs`),
      emotional_role: optionalString(slide.emotional_role, `slides[${index}].emotional_role`),
      intensity_target: boundedNumber(slide.intensity_target, `slides[${index}].intensity_target`, 0.5),
      previous_slide_id: slide.previous_slide_id ?? null,
      next_slide_id: slide.next_slide_id ?? null,
      layout_family: optionalString(slide.layout_family, `slides[${index}].layout_family`),
      asset_needs: arrayOf(slide.asset_needs, `slides[${index}].asset_needs`),
      speaker_note_intent: optionalString(slide.speaker_note_intent, `slides[${index}].speaker_note_intent`),
      constraints: clone(slide.constraints || {}),
      locks: arrayOf(slide.locks, `slides[${index}].locks`),
    };
  });
  return deepFreeze({ schema_version: DOMAIN_SCHEMA_VERSION, plan_id: makeId('narrative', idFactory), project_id: requiredString(projectId, 'project_id'), version: 1, arc: clone(arc || {}), slides: normalizedSlides, created_at: timestamp, updated_at: timestamp });
}

function createDesignSystem({ projectId, tokens, rules, accessibility, grammar, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  return deepFreeze({
    schema_version: DOMAIN_SCHEMA_VERSION,
    design_system_id: makeId('ds', idFactory),
    project_id: requiredString(projectId, 'project_id'),
    version: 1,
    tokens: clone(tokens || {}),
    rules: clone(rules || {}),
    accessibility: clone(accessibility || {}),
    grammar: optionalString(grammar, 'grammar'),
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function createCreativeDocument({ projectId, designSystemId, canvas = { width: 13.333, height: 7.5, unit: 'in' }, slides, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  if (!Array.isArray(slides) || slides.length === 0) throw new ContractError('contract_invalid', 'slides must contain at least one slide.');
  const normalizedSlides = slides.map((slide, index) => {
    if (!slide || typeof slide !== 'object') throw new ContractError('contract_invalid', `slides[${index}] must be an object.`);
    const elements = arrayOf(slide.elements, `slides[${index}].elements`).map((element, elementIndex) => {
      if (!element || typeof element !== 'object') throw new ContractError('contract_invalid', `slides[${index}].elements[${elementIndex}] must be an object.`);
      if (!ELEMENT_TYPES.includes(element.type)) throw new ContractError('contract_invalid', `Unsupported element type: ${element.type}.`);
      return { ...element, element_id: requiredString(element.element_id, `slides[${index}].elements[${elementIndex}].element_id`), locked: Boolean(element.locked) };
    });
    return { ...slide, slide_id: requiredString(slide.slide_id, `slides[${index}].slide_id`), elements };
  });
  return deepFreeze({ document_version: DOCUMENT_SCHEMA_VERSION, document_id: makeId('doc', idFactory), project_id: requiredString(projectId, 'project_id'), design_system_id: requiredString(designSystemId, 'design_system_id'), revision: 1, canvas: clone(canvas), slides: normalizedSlides, created_at: timestamp, updated_at: timestamp });
}

function createAsset({ projectId, ownerId, assetClass, mimeType, sizeBytes, hash, source, parentAssetId, transformations, permissions, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  if (!ASSET_CLASSES.includes(assetClass)) throw new ContractError('contract_invalid', `Unknown asset class: ${assetClass}.`);
  const size = Number(sizeBytes);
  if (!Number.isSafeInteger(size) || size < 0) throw new ContractError('contract_invalid', 'size_bytes must be a non-negative integer.');
  return deepFreeze({
    schema_version: DOMAIN_SCHEMA_VERSION,
    asset_id: makeId('asset', idFactory),
    project_id: requiredString(projectId, 'project_id'),
    owner_id: requiredString(ownerId, 'owner_id'),
    asset_class: assetClass,
    mime_type: requiredString(mimeType, 'mime_type'),
    size_bytes: size,
    hash: requiredString(hash, 'hash'),
    source: clone(source || {}),
    parent_asset_id: parentAssetId ?? null,
    transformations: arrayOf(transformations, 'transformations'),
    permissions: clone(permissions || {}),
    immutable_original: assetClass === 'ORIGINAL_USER_ASSET',
    retention: { state: 'active', deletion_requested_at: null },
    created_at: timestamp,
  });
}

function createJob({ projectId, ownerId, kind, idempotencyKey, retryBudget = 0, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  const budget = Number(retryBudget);
  if (!Number.isSafeInteger(budget) || budget < 0) throw new ContractError('contract_invalid', 'retry_budget must be a non-negative integer.');
  return deepFreeze({
    schema_version: DOMAIN_SCHEMA_VERSION,
    job_id: makeId('job', idFactory),
    project_id: requiredString(projectId, 'project_id'),
    owner_id: requiredString(ownerId, 'owner_id'),
    kind: requiredString(kind, 'kind'),
    idempotency_key: requiredString(idempotencyKey, 'idempotency_key'),
    status: 'QUEUED',
    progress: 0,
    attempts: 0,
    retry_budget: budget,
    errors: [],
    outputs: [],
    trace_id: makeId('trace', idFactory),
    created_at: timestamp,
    updated_at: timestamp,
    started_at: null,
    finished_at: null,
  });
}

function createQualityReport({ projectId, jobId, findings, repairs, warnings, humanReviewRequired = true, evidence, now, idFactory } = {}) {
  const timestamp = isoNow(now);
  return deepFreeze({
    schema_version: DOMAIN_SCHEMA_VERSION,
    report_id: makeId('quality', idFactory),
    project_id: requiredString(projectId, 'project_id'),
    job_id: jobId ?? null,
    findings: arrayOf(findings, 'findings'),
    repairs: arrayOf(repairs, 'repairs'),
    warnings: arrayOf(warnings, 'warnings'),
    human_review_required: Boolean(humanReviewRequired),
    evidence: arrayOf(evidence, 'evidence'),
    created_at: timestamp,
  });
}

function transitionProject(project, nextStatus, { now } = {}) {
  if (!project || typeof project !== 'object') throw new ContractError('contract_invalid', 'Project is required.');
  assertProjectStatus(nextStatus);
  assertProjectStatus(project.status);
  if (project.status !== nextStatus && !PROJECT_TRANSITIONS[project.status].includes(nextStatus)) {
    throw new ContractError('invalid_transition', `Project cannot move from ${project.status} to ${nextStatus}.`, { from: project.status, to: nextStatus });
  }
  return deepFreeze({ ...clone(project), status: nextStatus, updated_at: isoNow(now) });
}

function transitionJob(job, nextStatus, { now, error, outputs } = {}) {
  if (!job || typeof job !== 'object') throw new ContractError('contract_invalid', 'Job is required.');
  assertJobStatus(nextStatus);
  assertJobStatus(job.status);
  if (job.status !== nextStatus && !JOB_TRANSITIONS[job.status].includes(nextStatus)) {
    throw new ContractError('invalid_transition', `Job cannot move from ${job.status} to ${nextStatus}.`, { from: job.status, to: nextStatus });
  }
  const next = { ...clone(job), status: nextStatus, updated_at: isoNow(now) };
  if (nextStatus === 'RUNNING') { next.attempts += 1; next.started_at = next.started_at || next.updated_at; }
  if (nextStatus === 'SUCCEEDED' || nextStatus === 'FAILED_TERMINAL' || nextStatus === 'CANCELLED') next.finished_at = next.updated_at;
  if (nextStatus === 'SUCCEEDED') {
    next.progress = 1;
    if (!Array.isArray(outputs) || outputs.length === 0) throw new ContractError('missing_output', 'A successful job must include at least one output.');
    next.outputs = clone(outputs);
  }
  if (nextStatus.startsWith('FAILED')) {
    if (!error || typeof error !== 'object') throw new ContractError('contract_invalid', 'A failed job must include a structured error.');
    next.errors.push(clone(error));
  }
  if (nextStatus === 'CANCELLED') next.progress = Math.min(next.progress, 1);
  if (nextStatus === 'QUEUED' && job.status === 'FAILED_RETRYABLE' && job.attempts > job.retry_budget) throw new ContractError('retry_budget_exceeded', 'The job retry budget has been exhausted.');
  return deepFreeze(next);
}

function validateProject(project) {
  if (!project || typeof project !== 'object') throw new ContractError('contract_invalid', 'Project must be an object.');
  requiredString(project.project_id, 'project_id');
  requiredString(project.owner_id, 'owner_id');
  requiredString(project.session_id, 'session_id');
  requiredString(project.title, 'title');
  assertProjectStatus(project.status);
  if (!Number.isInteger(project.current_revision) || project.current_revision < 0) throw new ContractError('contract_invalid', 'current_revision must be a non-negative integer.');
  return true;
}

function validateJob(job) {
  if (!job || typeof job !== 'object') throw new ContractError('contract_invalid', 'Job must be an object.');
  requiredString(job.job_id, 'job_id');
  requiredString(job.project_id, 'project_id');
  requiredString(job.owner_id, 'owner_id');
  requiredString(job.idempotency_key, 'idempotency_key');
  assertJobStatus(job.status);
  if (!Number.isInteger(job.attempts) || job.attempts < 0) throw new ContractError('contract_invalid', 'attempts must be a non-negative integer.');
  if (!Number.isInteger(job.retry_budget) || job.retry_budget < 0) throw new ContractError('contract_invalid', 'retry_budget must be a non-negative integer.');
  return true;
}

module.exports = {
  ASSET_CLASSES,
  ContractError,
  DOMAIN_SCHEMA_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  ELEMENT_TYPES,
  EMOTION_SCHEMA_VERSION,
  JOB_STATUSES,
  PROJECT_STATUSES,
  createAsset,
  createCreativeBrief,
  createCreativeDocument,
  createDesignSystem,
  createEmotionProfile,
  createJob,
  createNarrativePlan,
  createProject,
  createQualityReport,
  deepFreeze,
  transitionJob,
  transitionProject,
  validateJob,
  validateProject,
};
