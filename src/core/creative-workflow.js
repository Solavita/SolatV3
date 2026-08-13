const crypto = require('node:crypto');
const {
  ContractError,
  createCreativeBrief,
  createCreativeDocument,
  createDesignSystem,
  createEmotionProfile,
  createNarrativePlan,
  createQualityReport,
} = require('./contracts');
const { ProviderError } = require('./provider');
const { SessionWorkspace } = require('./session-workspace');
const { composeDocument } = require('./layout-engine');

const MAX_SLIDES = 12;

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new ContractError('invalid_request', `${field} is required.`);
  return value.trim();
}

function normalizeSlideCount(value) {
  const count = value === undefined || value === null ? 8 : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_SLIDES) throw new ContractError('invalid_request', `slideCount must be an integer between 1 and ${MAX_SLIDES}.`);
  return count;
}

function parseAssetIds(assets) {
  if (assets === undefined || assets === null) return [];
  if (!Array.isArray(assets)) throw new ContractError('invalid_request', 'assets must be an array.');
  return assets.map((asset, index) => {
    const id = typeof asset === 'string' ? asset : asset?.asset_id;
    return requiredText(id, `assets[${index}].asset_id`);
  });
}

function buildStructuredPrompt(input, brief) {
  return [
    'You are the SOLAT structured creative planner.',
    'Return one JSON object only. Do not include markdown, hidden reasoning, invented facts, citations, or claims not present in the user input.',
    'Use the exact schema keys below. If a value is uncertain, state the uncertainty in conflicts/explanation instead of inventing a fact.',
    'Required top-level keys: emotion, narrative, design, document.',
    'emotion keys: primary_emotion, secondary_emotions, dimensions, influence, arc, confidence, locked_fields, inferred_fields, conflicts, explanation, provenance. Use [] for every omitted array. Every dimensions value, influence.narrative, influence.visual, influence.motion, influence.colour, confidence, arc.position, arc.energy, arc.tension, and slide intensity_target must be a number from 0 to 1 inclusive. emotion.arc is required and must be an array of one or more objects with numeric position, energy, and tension.',
    'narrative keys: arc and slides. narrative.arc must be an object. Each slide needs slide_id, communication_objective, audience_question, content_summary, evidence_needs, emotional_role, intensity_target, layout_family, asset_needs, speaker_note_intent, constraints, locks. All named list fields must be arrays, including secondary_emotions, locked_fields, inferred_fields, conflicts, evidence_needs, asset_needs, and locks.',
    'design keys: tokens, rules, accessibility, grammar.',
    'document keys: canvas and slides. canvas must be {"width":13.333,"height":7.5,"unit":"in"}. Each slide needs slide_id, role, elements. Each element needs element_id and a supported type: text, original_image, generated_image, shape, line, icon, table, chart, group, background, media_placeholder, or citation. Elements may omit box because SOLAT composes safe editable geometry.',
    'The document must remain editable and must preserve original asset IDs; never regenerate or replace an original asset.',
    'If user_input.assetIds is empty, document elements must not use original_image, generated_image, or media_placeholder. Use text, shape, line, icon, table, chart, group, background, or citation instead. If assetIds is non-empty, use only an exact supplied asset ID for original_image; never invent asset_id or asset_ref.',
    'For a plan without assets or external data, use only text, shape, line, icon, background, and citation elements. Do not use group, table, or chart unless all of their required nested data is explicitly present.',
    'Use this minimum shape exactly, replacing only the example values: {"emotion":{"primary_emotion":"focused","secondary_emotions":[],"dimensions":{"energy":0.5},"influence":{"mode":"balanced","narrative":0.5,"visual":0.5,"motion":0.5,"colour":0.5},"arc":[{"position":0,"energy":0.5,"tension":0.2}],"confidence":0.7,"locked_fields":[],"inferred_fields":[],"conflicts":[],"explanation":"", "provenance":{}},"narrative":{"arc":{},"slides":[{"slide_id":"s01","communication_objective":"explain","audience_question":"","content_summary":"","evidence_needs":[],"emotional_role":"opening","intensity_target":0.5,"layout_family":"editorial","asset_needs":[],"speaker_note_intent":"","constraints":{},"locks":[]}]},"design":{"tokens":{},"rules":{},"accessibility":{},"grammar":"clear"},"document":{"canvas":{"width":13.333,"height":7.5,"unit":"in"},"slides":[{"slide_id":"s01","role":"opening","elements":[{"element_id":"s01-title","type":"text","content":"","locked":false}]}]}}',
    JSON.stringify({ user_input: input, validated_brief: brief }),
  ].join('\n');
}

function checkDocument(document) {
  const findings = [];
  const seenSlides = new Set();
  const seenElements = new Set();
  for (const slide of document.slides) {
    if (seenSlides.has(slide.slide_id)) findings.push({ criterion: 'unique_slide_ids', status: 'FAIL', severity: 'error', slide_id: slide.slide_id });
    seenSlides.add(slide.slide_id);
    if (!slide.elements.length) findings.push({ criterion: 'non_empty_slide', status: 'FAIL', severity: 'error', slide_id: slide.slide_id });
    for (const element of slide.elements) {
      if (seenElements.has(element.element_id)) findings.push({ criterion: 'unique_element_ids', status: 'FAIL', severity: 'error', element_id: element.element_id });
      seenElements.add(element.element_id);
      if (element.type === 'group' && !Array.isArray(element.children)) {
        findings.push({ criterion: 'group_children', status: 'FAIL', severity: 'error', slide_id: slide.slide_id, element_id: element.element_id, detail: 'Group elements require a children array before export.' });
      }
    }
  }
  if (!findings.length) findings.push({ criterion: 'document_structure', status: 'PASS', severity: 'info', detail: 'All slide and element IDs are unique and every slide contains editable elements.' });
  return findings;
}

function removeModelGeometry(document) {
  return {
    ...document,
    slides: document.slides.map(slide => ({
      ...slide,
      elements: slide.elements.map(({ box: _box, ...element }) => element),
    })),
  };
}

class CreativeWorkflow {
  constructor({ provider, workspace, idFactory = crypto.randomUUID } = {}) {
    if (!provider || typeof provider.completeStructured !== 'function') throw new ContractError('capability_unavailable', 'The configured provider does not support structured creative planning.');
    this.provider = provider;
    this.workspace = workspace || new SessionWorkspace({ idFactory });
    this.idFactory = idFactory;
  }

  async createDeck({ sessionId, requestId, goal, audience, language = 'en', contentSources = [], songReference = '', assets, slideCount, outputFormat = 'editable_web', constraints = {}, userLocks = [], revisionOf = null, revisionInstruction = '' } = {}) {
    const normalizedGoal = requiredText(goal, 'goal');
    const normalizedAudience = requiredText(audience, 'audience');
    const normalizedSlideCount = normalizeSlideCount(slideCount);
    const assetIds = parseAssetIds(assets);
    const normalizedRevisionOf = revisionOf === null ? null : requiredText(revisionOf, 'revisionOf');
    const input = { goal: normalizedGoal, audience: normalizedAudience, language, contentSources, songReference, assetIds, slideCount: normalizedSlideCount, outputFormat, constraints, userLocks, revision_of: normalizedRevisionOf, revision_instruction: String(revisionInstruction || '').trim() };
    const started = this.workspace.beginJob({ sessionId, requestId, kind: 'music_to_deck' });
    if (started.replay) return started.response;
    const projectId = started.job.project_id;
    try {
      const brief = createCreativeBrief({
        projectId,
        goal: normalizedGoal,
        audience: normalizedAudience,
        language,
        contentSources: [...contentSources, ...(songReference ? [{ kind: 'music_reference', value: songReference }] : [])],
        outputRequirements: { format: outputFormat, slide_count: normalizedSlideCount },
        factualityRequirements: { do_not_invent: true },
        brandRules: constraints.brandRules || {},
        prohibitedStyles: constraints.prohibitedStyles || [],
        accessibilityNeeds: constraints.accessibilityNeeds || [],
        slideCount: normalizedSlideCount,
        outputFormat,
        assetIds,
        userLocks,
        riskFlags: songReference ? [] : ['music_reference_not_provided'],
        now: new Date(),
        idFactory: this.idFactory,
      });
      this.workspace.linkProject({ sessionId, briefId: brief.brief_id, assetIds, jobId: started.job.job_id });
      this.workspace.transitionProject({ sessionId, nextStatus: 'INPUT_VALIDATED' });

      const modelResult = await this.provider.completeStructured([
        { role: 'system', content: buildStructuredPrompt(input, brief) },
        { role: 'user', content: normalizedGoal },
      ], { schema_version: 'solat.creative-plan.v1' });
      const structured = modelResult?.data;
      if (!structured || typeof structured !== 'object' || !structured.emotion || !structured.narrative || !structured.design || !structured.document) {
        throw new ProviderError('malformed_response', 'The model did not return the complete creative plan.');
      }

      const emotion = createEmotionProfile({
        projectId,
        primaryEmotion: structured.emotion.primary_emotion,
        secondaryEmotions: structured.emotion.secondary_emotions,
        dimensions: structured.emotion.dimensions,
        influence: structured.emotion.influence,
        arc: structured.emotion.arc,
        confidence: structured.emotion.confidence,
        lockedFields: structured.emotion.locked_fields,
        inferredFields: structured.emotion.inferred_fields,
        conflicts: structured.emotion.conflicts,
        explanation: structured.emotion.explanation,
        provenance: structured.emotion.provenance,
        now: new Date(),
        idFactory: this.idFactory,
      });
      this.workspace.linkProject({ sessionId, emotionProfileId: emotion.profile_id });
      this.workspace.transitionProject({ sessionId, nextStatus: 'EMOTION_REVIEW' });

      const narrative = createNarrativePlan({ projectId, slides: structured.narrative.slides, arc: structured.narrative.arc, now: new Date(), idFactory: this.idFactory });
      this.workspace.linkProject({ sessionId, narrativePlanId: narrative.plan_id });
      this.workspace.transitionProject({ sessionId, nextStatus: 'OUTLINE_REVIEW' });

      const design = createDesignSystem({ projectId, tokens: structured.design.tokens, rules: structured.design.rules, accessibility: structured.design.accessibility, grammar: structured.design.grammar, now: new Date(), idFactory: this.idFactory });
      this.workspace.linkProject({ sessionId, designSystemId: design.design_system_id });
      this.workspace.transitionProject({ sessionId, nextStatus: 'DESIGN_PLANNED' });

      const rawDocument = createCreativeDocument({ projectId, designSystemId: design.design_system_id, canvas: structured.document.canvas, slides: structured.document.slides, now: new Date(), idFactory: this.idFactory });
      // Geometry is a deterministic system responsibility. Model-proposed
      // boxes can be malformed or overflow, so only semantic editable
      // elements cross this boundary into the layout engine.
      const layout = composeDocument(removeModelGeometry(rawDocument));
      const document = layout.document;
      this.workspace.linkProject({ sessionId, documentId: document.document_id });
      this.workspace.transitionProject({ sessionId, nextStatus: 'COMPOSING' });
      const findings = [...checkDocument(document), ...layout.diagnostics];
      const qualityReport = createQualityReport({ projectId, jobId: started.job.job_id, findings, warnings: ['Visual beauty and emotional quality require manual review.'], humanReviewRequired: true, evidence: [{ kind: 'deterministic_document_check', status: 'executed' }], now: new Date(), idFactory: this.idFactory });
      this.workspace.transitionProject({ sessionId, nextStatus: 'QUALITY_REVIEW' });
      const hasFailure = findings.some(finding => finding.status === 'FAIL');
      this.workspace.transitionProject({ sessionId, nextStatus: hasFailure ? 'PARTIALLY_READY' : 'READY_FOR_EDIT' });

      const response = {
        id: `creative_${this.idFactory()}`,
        sessionId,
        requestId,
        projectId,
        provider: modelResult.provider,
        model: modelResult.model,
        usage: modelResult.usage || null,
        status: hasFailure ? 'PARTIALLY_READY' : 'READY_FOR_EDIT',
        revisionOf: normalizedRevisionOf,
        artifacts: { brief, emotion, narrative, design, document, qualityReport },
        timestamp: new Date().toISOString(),
      };
      this.workspace.storeArtifact({ sessionId, kind: 'creative_result', artifactId: response.id, value: response });
      const completed = this.workspace.succeedJob({ sessionId, requestId, response });
      return { ...response, jobId: completed.job_id, traceId: completed.trace_id };
    } catch (error) {
      try {
        const current = this.workspace.getProject(sessionId);
        if (!['FAILED_RECOVERABLE', 'FAILED_TERMINAL', 'BLOCKED', 'ARCHIVED', 'DELETION_PENDING'].includes(current.status)) this.workspace.transitionProject({ sessionId, nextStatus: 'FAILED_RECOVERABLE' });
      } catch {
        // Preserve the original failure; transition errors are only diagnostic here.
      }
      this.workspace.failJob({ sessionId, requestId, error });
      if (error instanceof ContractError || error instanceof ProviderError) throw error;
      throw new ProviderError('workflow_error', 'The creative workflow failed.');
    }
  }
}

module.exports = { CreativeWorkflow, MAX_SLIDES, buildStructuredPrompt, checkDocument, removeModelGeometry };
