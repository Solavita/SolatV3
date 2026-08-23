const HINTS_SCHEMA_VERSION = 'solat.intent-hints.v1';
const { buildInstructionPlan } = require('./instruction-plan-contract');
const THAI_SEARCH_TERMS = /(?:\u0e04\u0e49\u0e19\u0e2b\u0e32|\u0e40\u0e2a\u0e34\u0e23\u0e4c\u0e0a|\u0e2b\u0e32\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25|\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14|\u0e41\u0e2b\u0e25\u0e48\u0e07\u0e17\u0e35\u0e48\u0e21\u0e32|\u0e27\u0e34\u0e01\u0e34|\u0e15\u0e34\u0e4a\u0e01\u0e15\u0e47\u0e2d\u0e01|\u0e1e\u0e34\u0e19\u0e40\u0e17\u0e2d\u0e40\u0e23\u0e2a\u0e15\u0e4c)/u;
const THAI_SOCIAL_TERMS = /(?:\u0e15\u0e34\u0e4a\u0e01\u0e15\u0e47\u0e2d\u0e01|\u0e1e\u0e34\u0e19\u0e40\u0e17\u0e2d\u0e40\u0e23\u0e2a\u0e15\u0e4c|\u0e2d\u0e34\u0e19\u0e2a\u0e15\u0e32\u0e41\u0e01\u0e23\u0e21|\u0e40\u0e1f\u0e0b\u0e1a\u0e38\u0e4a\u0e01)/u;
const THAI_VIDEO_TERMS = /\u0e22\u0e39\u0e17\u0e39\u0e1a/u;
const THAI_MANHWA_CONTEXT = /(?:\u0e21\u0e31\u0e07\u0e2e\u0e27\u0e32|\u0e15\u0e31\u0e27\u0e25\u0e30\u0e04\u0e23)/u;
const THAI_MUSIC_CONTEXT = /(?:\u0e19\u0e31\u0e01\u0e23\u0e49\u0e2d\u0e07|\u0e40\u0e1e\u0e25\u0e07|\u0e2d\u0e31\u0e25\u0e1a\u0e31\u0e49\u0e21)/u;
const THAI_INTERROGATIVE_TERMS = /(?:\u0e04\u0e37\u0e2d|\u0e2d\u0e30\u0e44\u0e23|\u0e43\u0e04\u0e23|\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e44\u0e23|\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e44\u0e23|\u0e17\u0e33\u0e44\u0e21|\u0e17\u0e35\u0e48\u0e44\u0e2b\u0e19)/u;
const THAI_LATEST_TERMS = /(?:\u0e23\u0e32\u0e04\u0e32|\u0e27\u0e31\u0e19\u0e19\u0e35\u0e49|\u0e15\u0e2d\u0e19\u0e19\u0e35\u0e49|\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14|\u0e02\u0e48\u0e32\u0e27|\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14)/u;
const THAI_GENERAL_CONVERSATION_TERMS = /(?:\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35|\u0e02\u0e2d\u0e1a\u0e04\u0e38\u0e13|\u0e0a\u0e48\u0e27\u0e22|\u0e04\u0e34\u0e14|\u0e44\u0e2d\u0e40\u0e14\u0e35\u0e22|\u0e04\u0e38\u0e22|\u0e44\u0e14\u0e49\u0e44\u0e2b\u0e21|\u0e17\u0e31\u0e01\u0e17\u0e32\u0e22|\u0e15\u0e2d\u0e1a|\u0e40\u0e02\u0e35\u0e22\u0e19|\u0e2a\u0e23\u0e38\u0e1b|\u0e41\u0e1b\u0e25|\u0e04\u0e33\u0e19\u0e27\u0e13)/u;
const GEMINI_TERMS = /\b(?:gemini|ai\s+overview|google\s+ai)\b/iu;
const FACTUAL_QUERY_TERMS = /\b(?:who|what|where|when)\s+(?:is|are|was|were)\b|\btell\s+me\s+about\b|\bexplain\b|(?:\u0e43\u0e04\u0e23\u0e04\u0e37\u0e2d|\u0e2d\u0e30\u0e44\u0e23\u0e04\u0e37\u0e2d|\u0e40\u0e01\u0e35\u0e48\u0e22\u0e27\u0e01\u0e31\u0e1a)/iu;
const CORRECTION_TERMS = /\b(?:actually|correction|i\s+mean|not\s+that|rather)\b|(?:\u0e44\u0e21\u0e48\u0e43\u0e0a\u0e48|\u0e09\u0e31\u0e19\u0e2b\u0e21\u0e32\u0e22\u0e16\u0e36\u0e07|\u0e1c\u0e21\u0e2b\u0e21\u0e32\u0e22\u0e16\u0e36\u0e07|\u0e41\u0e01\u0e49\u0e40\u0e1b\u0e47\u0e19|\u0e17\u0e35\u0e48\u0e08\u0e23\u0e34\u0e07)/iu;
const NAMED_LOOKUP_STOPWORDS = new Set(['hi', 'hello', 'hey', 'thanks', 'thank', 'ok', 'okay', 'yes', 'no', 'please', 'help', 'solat']);
// Use Unicode escapes for Thai terms so the router is stable across Windows
// console/file encodings; the original user message remains untouched.
const DIRECT_TRANSFORM_TERMS = /(?:สร้าง\s+query|build\s+(?:a\s+)?query|query\s+carefully|คำเว้นวรรค|spacing|keep\s+the\s+thai\s+name\s+unchanged|ตรวจคำพิมพ์ผิด|\btypo\b|เริ่มค้นข้อมูลจากอะไร)/iu;
const COMMERCE_TERMS = /(?:business|company|store|shop|customer|product|inventory|stock|order|sales|payment|shipping|follow[- ]?up|crm|\u0e18\u0e38\u0e23\u0e01\u0e34\u0e08|\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17|\u0e23\u0e49\u0e32\u0e19\u0e04\u0e49\u0e32|\u0e23\u0e49\u0e32\u0e19|\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32|\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32|\u0e2a\u0e15\u0e47\u0e2d\u0e01|\u0e2d\u0e2d\u0e40\u0e14\u0e2d\u0e23\u0e4c|\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e0b\u0e37\u0e49\u0e2d|\u0e22\u0e2d\u0e14\u0e02\u0e32\u0e22|\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19|\u0e08\u0e31\u0e14\u0e2a\u0e48\u0e07|\u0e15\u0e34\u0e14\u0e15\u0e32\u0e21\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32|\u0e42\u0e1b\u0e23\u0e44\u0e1f\u0e25\u0e4c\u0e18\u0e38\u0e23\u0e01\u0e34\u0e08|\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e18\u0e38\u0e23\u0e01\u0e34\u0e08)/iu;

const SEARCH_TERMS = /\b(search|find|look\s*up|latest|current|news|source|wikipedia|tiktok|pinterest|instagram|youtube|facebook)\b|ค้นหา|เสิร์ช|ล่าสุด|แหล่งที่มา|วิกิ|ติ๊กต็อก|พินเทอเรสต์/iu;
const FILE_TERMS = /\b(file|pdf|document|attachment|image|screenshot|spreadsheet)\b|ไฟล์|เอกสาร|รูปภาพ|ภาพหน้าจอ/iu;
const CREATIVE_TERMS = /\b(slide|slides|deck|presentation|design|creative|image generation)\b|สไลด์|พรีเซ็น|ออกแบบ|สร้างภาพ/iu;
const ACTION_TERMS = /\b(delete|send|publish|buy|pay|upload|change|install|run)\b|ลบ|ส่ง|เผยแพร่|ซื้อ|จ่าย|อัปโหลด|เปลี่ยน|ติดตั้ง/iu;
const CLARIFICATION_TERMS = /\b(what do you mean|which one|unclear|ambiguous|compare)\b|หมายถึงอะไร|อันไหน|กำกวม|เปรียบเทียบ/iu;

function countWords(value) {
  return String(value || '').trim().split(/\s+/u).filter(Boolean).length;
}

function score(signals, name) {
  return signals.includes(name) ? 0.78 : 0.18;
}

function unique(values) {
  return [...new Set(values)];
}

function explicitEntityAliases(value) {
  const text = String(value || '');
  const aliases = [];
  const seen = new Set();
  const add = (left, right, syntax) => {
    const forms = [left, right].map(item => String(item || '').trim().replace(/\s+/gu, ' '));
    if (forms.some(item => item.length < 2 || item.length > 80) || forms[0] === forms[1]) return;
    const hasThai = forms.some(item => /[\u0e00-\u0e7f]/u.test(item));
    const hasLatin = forms.some(item => /[A-Za-z]/u.test(item));
    if (!hasThai || !hasLatin) return;
    const key = forms.map(item => item.normalize('NFKC').toLocaleLowerCase()).sort().join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    aliases.push({
      forms,
      source: 'explicit_user_alias',
      syntax,
      equivalence_status: 'unverified_candidate',
      policy: 'retain_both_forms_and_verify_before_merging',
    });
  };
  // Only retain cross-script forms that the user visibly placed together.
  // SOLAT does not transliterate or assert identity from spelling similarity.
  for (const match of text.matchAll(/([\p{L}\p{M}][\p{L}\p{M}\p{N}' .-]{1,78}?)\s*\(([\p{L}\p{M}][\p{L}\p{M}\p{N}' .-]{1,78})\)/gu)) {
    add(match[1], match[2], 'parenthetical');
  }
  for (const match of text.matchAll(/([\p{L}\p{M}][\p{L}\p{M}\p{N}' .-]{1,78}?)\s*\/\s*([\p{L}\p{M}][\p{L}\p{M}\p{N}' .-]{1,78})/gu)) {
    add(match[1], match[2], 'slash');
  }
  return aliases.slice(0, 4);
}

function looksLikeNamedLookup(value) {
  const text = String(value || '').trim().replace(/[?!.]+$/u, '').replace(/\s+/gu, ' ');
  if (!text || text.length > 80) return false;
  if (THAI_GENERAL_CONVERSATION_TERMS.test(text)) return false;
  const tokens = text.split(' ').filter(Boolean);
  if (tokens.length < 1 || tokens.length > 4) return false;
  if (tokens.some(token => NAMED_LOOKUP_STOPWORDS.has(token.toLocaleLowerCase()))) return false;
  if (tokens.some(token => /^(?:search|find|look|lookup|what|who|how|why|when|where|compare|tell|explain)$/iu.test(token))) return false;
  return tokens.some(token => /^[A-Z][\p{L}\p{N}'-]{2,}$/u.test(token))
    || tokens.some(token => /[\u0e00-\u0e7f]/u.test(token) && token.length >= 3);
}

const CONTEXT_SUBJECT_STOPWORDS = new Set([
  'about', 'and', 'current', 'find', 'for', 'from', 'info', 'information',
  'latest', 'look', 'lookup', 'news', 'on', 'search', 'source', 'sources',
  'the', 'this', 'today', 'up', 'what', 'with', 'wikipedia', 'youtube',
  '\u0e04\u0e49\u0e19\u0e2b\u0e32', '\u0e40\u0e2a\u0e34\u0e23\u0e4c\u0e0a', '\u0e2b\u0e32',
]);

function bareContextSubject(value) {
  const text = String(value || '').trim().replace(/[.?!]+$/u, '').replace(/\s+/gu, ' ');
  if (!text || text.length > 120 || !text.includes(' ')) return null;
  const tokens = text.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (tokens.some(token => CONTEXT_SUBJECT_STOPWORDS.has(token.toLocaleLowerCase()))) return null;
  // Thai vowels and tone marks are Unicode marks (\p{M}), not letters. Without
  // them a valid Thai name would be rejected before reference resolution.
  if (!tokens.every(token => /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'-]*$/u.test(token))) return null;
  return text;
}

function contextSubjectFromUserTurn(value) {
  const text = String(value || '').trim();
  // Thai search verbs are frequently followed directly by a mixed-language
  // name, so \s* is intentional here. The extracted subject remains bounded
  // by bareContextSubject below; this only makes the command syntax visible.
  const match = text.match(/^(?:(?:search|find|look\s*up|lookup|query)\s+|(?:\u0e04\u0e49\u0e19\u0e2b\u0e32|\u0e40\u0e2a\u0e34\u0e23\u0e4c\u0e0a|\u0e2b\u0e32)\s*)(.+)$/iu);
  if (!match) {
    const direct = bareContextSubject(text);
    if (direct) return direct;
    // A pasted romanized name is often written without a space (for example
    // "ParkDayoung"). It is still safe to retain as a *candidate* only when it
    // already satisfies the conservative named-lookup check. We never guess a
    // correction or turn ordinary prose into a hidden subject.
    return looksLikeNamedLookup(text) && /^[\p{L}\p{M}\p{N}'-]{3,80}$/u.test(text) ? text : null;
  }
  const subject = match[1]
    .replace(/^(?:for\s+)?(?:a\s+)?(?:reliable\s+)?(?:source|information|info)\s+(?:about|on)\s+/iu, '')
    .replace(/\s+(?:on|from)\s+(?:wikipedia|tiktok|pinterest|instagram|facebook|youtube)\b.*$/iu, '')
    // Keep a Thai lookup subject separate from its search location/domain.
    // This lets "ค้นหา ฮัน นารี จากมังฮวา" resolve a later "เขา" to
    // "ฮัน นารี", not to the whole search instruction.
    .replace(/\s+(?:\u0e08\u0e32\u0e01|\u0e43\u0e19|\u0e1a\u0e19)\s*(?:\u0e21\u0e31\u0e07\u0e2e\u0e27\u0e32|\u0e40\u0e27\u0e47\u0e1a\u0e15\u0e39\u0e19|\u0e15\u0e34\u0e4a\u0e01\u0e15\u0e47\u0e2d\u0e01|\u0e22\u0e39\u0e17\u0e39\u0e1a|\u0e1e\u0e34\u0e19\u0e40\u0e17\u0e2d\u0e40\u0e23\u0e2a\u0e15\u0e4c).*$/iu, '')
    .trim();
  return bareContextSubject(subject)
    || (looksLikeNamedLookup(subject) && /^[\p{L}\p{M}\p{N}'-]{3,80}$/u.test(subject) ? subject : null);
}

function comparisonEntities(value) {
  const original = String(value || '').trim();
  const hasComparisonSignal = /^\s*compare\b/iu.test(original)
    || /^\s*เปรียบ/iu.test(original)
    || /\b(?:vs\.?|versus)\b/iu.test(original)
    || /เปรียบเทียบกับ/iu.test(original);
  // Plain "A and B" often enumerates platforms or topics; it is not enough
  // to treat the message as an entity comparison without a comparison cue.
  const thaiConnector = original.match(/^\s*(.+?)\s+\u0e01\u0e31\u0e1a\s+(.+?)\s*$/u);
  const excludedThaiSubjects = /^(?:\u0e09\u0e31\u0e19|\u0e04\u0e38\u0e13|\u0e40\u0e23\u0e32|\u0e40\u0e02\u0e32|\u0e40\u0e18\u0e2d|\u0e21\u0e31\u0e19|\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07|\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25|\u0e01\u0e32\u0e23)/u;
  const looksLikeThaiEntityPair = Boolean(thaiConnector
    && thaiConnector[1].trim().length >= 2
    && thaiConnector[2].trim().length >= 2
    && !excludedThaiSubjects.test(thaiConnector[1].trim())
    && !excludedThaiSubjects.test(thaiConnector[2].trim()));
  const hasThaiComparisonSignal = /^\s*\u0e40\u0e1b\u0e23\u0e35\u0e22\u0e1a/u.test(original) || looksLikeThaiEntityPair;
  if (!(hasComparisonSignal || hasThaiComparisonSignal)) return { detected: false, entities: [] };
  const thaiMatch = original.match(/^\s*(?:\u0e40\u0e1b\u0e23\u0e35\u0e22\u0e1a\u0e40\u0e17\u0e35\u0e22\u0e1a\s*)?(.+?)\s+(?:\u0e01\u0e31\u0e1a|\u0e41\u0e25\u0e30)\s+(.+)$/u);
  const match = String(value || '').trim().match(/^(.+?)\s+(?:and|&|vs\.?|versus|กับ|และ|เทียบกับ|เปรียบเทียบกับ)\s+(.+)$/iu);
  const selectedMatch = thaiMatch || match;
  if (!selectedMatch) return { detected: false, entities: [] };
  const entities = [selectedMatch[1], selectedMatch[2]].map(raw => {
    // A follow-up question can begin after the comparison sentence. Keep the
    // candidate name clean for downstream evidence alignment rather than
    // treating "Han Nari. Are they ..." as a literal entity name.
    const firstSentence = String(raw || '').replace(/\s*[.?!]\s+.*$/u, '');
    raw = firstSentence;
    const clean = raw.trim().replace(/^(?:compare|เปรียบเทียบ)\s+/iu, '').replace(/^['"“”]+|['"“”]+$/gu, '').trim();
    const canonical = clean.replace(/^\u0e40\u0e1b\u0e23\u0e35\u0e22\u0e1a\u0e40\u0e17\u0e35\u0e22\u0e1a\s*/u, '').trim();
    const compact = canonical.replace(/[\s-]+/gu, '').toLowerCase();
    return { raw: canonical, normalized: canonical.toLowerCase(), variants: unique([canonical, compact]) };
  }).filter(entity => entity.raw);
  return { detected: entities.length === 2, entities };
}

function contextEntities(history) {
  const found = [];
  const seen = new Set();
  const canonicalEntityKey = value => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\u002D\u2010-\u2015]+/gu, '');
  const firstVisible = new Map();
  const add = value => {
    const entity = String(value || '').trim();
    // Treat harmless punctuation/spacing variants as the same context entity
    // while retaining the first user-visible spelling for the query. This
    // prevents "Park-Dayoung" and "Park Dayoung" from becoming two competing
    // pronoun candidates in a follow-up turn.
    const key = canonicalEntityKey(entity);
    if (!entity || seen.has(key)) return;
    seen.add(key);
    found.push(firstVisible.get(key) || entity);
  };
  const recent = [];
  let scannedCharacters = 0;
  // Search a bounded long-context window instead of only four turns. User
  // turns are considered before assistant prose so a model-mentioned name
  // cannot displace the user's own subject. Turns themselves are newest-first,
  // while entity order inside a comparison remains unchanged for ordinals.
  for (let index = (Array.isArray(history) ? history.length : 0) - 1; index >= 0 && recent.length < 24; index -= 1) {
    const turn = history[index];
    const text = String(turn?.content || '');
    if (!text.trim()) continue;
    if (scannedCharacters + text.length > 24000) continue;
    recent.push(turn);
    scannedCharacters += text.length;
  }
  const ordered = [
    ...recent.filter(turn => turn?.role === 'user'),
    ...recent.filter(turn => turn?.role !== 'user'),
  ];
  // Keep the first user-visible spelling even though relevance is evaluated
  // newest-first. This avoids silently rewriting Park-Dayoung to a later
  // spacing variant while still preferring the latest subject.
  for (const turn of [...recent].reverse()) {
    const text = String(turn?.content || '');
    const candidates = [
      ...comparisonEntities(text).entities.map(entity => entity.raw),
      ...[...text.matchAll(/\b([A-Z][\p{L}\p{N}'-]{1,50}\s+[A-Z][\p{L}\p{N}'-]{1,50})\b/gu)].map(match => match[1].trim()),
      ...(turn?.role === 'user' ? [contextSubjectFromUserTurn(text)] : []),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const key = canonicalEntityKey(candidate);
      if (key && !firstVisible.has(key)) firstVisible.set(key, candidate);
    }
  }
  for (const turn of ordered) {
    const text = String(turn?.content || '');
    for (const entity of comparisonEntities(text).entities) add(entity.raw);
    for (const match of text.matchAll(/\b([A-Z][\p{L}\p{N}'-]{1,50}\s+[A-Z][\p{L}\p{N}'-]{1,50})\b/gu)) {
      const entity = match[1].trim();
      // Sentence openers are not entity candidates. This makes “We were
      // discussing …” yield the person/topic rather than “We were”.
      if (/^(?:We Were|I Can|It Was|The User|This Is)$/u.test(entity)) continue;
      add(entity);
    }
    // Preserve a short, user-entered lowercase subject such as
    // "park dayoung" for a pronoun follow-up. This is intentionally limited
    // to two-to-four lexical tokens and user turns so ordinary assistant
    // prose or long queries cannot become hidden context.
    if (turn?.role === 'user') add(contextSubjectFromUserTurn(text));
    if (found.length >= 4) return found.slice(0, 4);
  }
  return found.slice(0, 4);
}

function referenceOrdinal(value) {
  const text = String(value || '');
  if (/\b(?:first|former|1st)\b/iu.test(text) || /(?:\u0e04\u0e19\u0e41\u0e23\u0e01|\u0e2d\u0e31\u0e19\u0e41\u0e23\u0e01|\u0e15\u0e31\u0e27\u0e41\u0e23\u0e01)/u.test(text)) return 0;
  if (/\b(?:second|latter|2nd)\b/iu.test(text) || /(?:\u0e04\u0e19\u0e17\u0e35\u0e48?\u0e2a\u0e2d\u0e07|\u0e2d\u0e31\u0e19\u0e17\u0e35\u0e48?\u0e2a\u0e2d\u0e07|\u0e15\u0e31\u0e27\u0e17\u0e35\u0e48?\u0e2a\u0e2d\u0e07)/u.test(text)) return 1;
  return null;
}

function referenceResolution(value, history) {
  // Keep the user text intact, but recognize common Thai follow-up forms as
  // well as English pronouns. The resolution is advisory and only succeeds
  // when a single recent named entity is available.
  const hasReference = /\b(it|this|that|these|those|they|them|he|she|her|him|his|its|there|one|former|latter|earlier|before|previous|previously|originally)\b/iu.test(String(value || ''))
    || /(?:\u0e21\u0e31\u0e19|\u0e2d\u0e31\u0e19\u0e19\u0e35\u0e49|\u0e2d\u0e31\u0e19\u0e19\u0e31\u0e49\u0e19|\u0e40\u0e02\u0e32|\u0e40\u0e18\u0e2d|\u0e2a\u0e34\u0e48\u0e07\u0e19\u0e35\u0e49|\u0e04\u0e19\u0e19\u0e35\u0e49|\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e19\u0e35\u0e49|\u0e15\u0e31\u0e27\u0e19\u0e35\u0e49|\u0e01\u0e48\u0e2d\u0e19\u0e2b\u0e19\u0e49\u0e32|\u0e40\u0e14\u0e34\u0e21)/u.test(String(value || ''));
  const candidates = contextEntities(history);
  const ordinal = referenceOrdinal(value);
  const resolvedOrdinal = ordinal !== null && Boolean(candidates[ordinal]);
  return {
    has_reference: hasReference,
    candidates,
    ordinal,
    recommended_query: resolvedOrdinal ? candidates[ordinal] : hasReference && candidates.length === 1 ? candidates[0] : null,
    status: resolvedOrdinal ? 'resolved_ordinal_context' : hasReference ? (candidates.length === 1 ? 'resolved_from_context' : candidates.length ? 'ambiguous_context' : 'unresolved') : 'not_applicable',
  };
}

function contextQualifiers(history) {
  const turns = Array.isArray(history) ? history : [];
  const recent = turns.slice(-24).reverse();
  // Prefer the latest user-stated domain, especially after a correction. An
  // assistant's earlier interpretation is only a fallback when the user has
  // never supplied a domain qualifier.
  const ordered = [
    ...recent.filter(turn => turn?.role === 'user'),
    ...recent.filter(turn => turn?.role !== 'user'),
  ];
  for (const turn of ordered) {
    const text = String(turn?.content || '').toLocaleLowerCase();
    const qualifiers = [];
    const rejectsManhwa = /\b(?:not|isn't|isnt)\s+(?:the\s+|an?\s+)?(?:manhwa|manga|webtoon|character|anime)\b/iu.test(text)
      || /\u0e44\u0e21\u0e48\u0e43\u0e0a\u0e48\s*(?:\u0e40\u0e1b\u0e47\u0e19\s*)?(?:\u0e21\u0e31\u0e07\u0e2e\u0e27\u0e32|\u0e15\u0e31\u0e27\u0e25\u0e30\u0e04\u0e23)/u.test(text);
    const rejectsMusic = /\b(?:not|isn't|isnt)\s+(?:the\s+|an?\s+)?(?:singer|song|album|music|artist)\b/iu.test(text)
      || /\u0e44\u0e21\u0e48\u0e43\u0e0a\u0e48\s*(?:\u0e40\u0e1b\u0e47\u0e19\s*)?(?:\u0e19\u0e31\u0e01\u0e23\u0e49\u0e2d\u0e07|\u0e40\u0e1e\u0e25\u0e07|\u0e28\u0e34\u0e25\u0e1b\u0e34\u0e19)/u.test(text);
    if (!rejectsManhwa && (/\b(?:manhwa|manga|webtoon|character|anime)\b/iu.test(text) || THAI_MANHWA_CONTEXT.test(text))) qualifiers.push('manhwa character');
    if (!rejectsMusic && (/\b(?:singer|song|album|music|artist)\b/iu.test(text) || THAI_MUSIC_CONTEXT.test(text))) qualifiers.push('music artist');
    if (qualifiers.length) return qualifiers;
  }
  return [];
}

function disambiguationHints(value, history) {
  const comparison = comparisonEntities(value);
  const compact = String(value || '').trim().replace(/[\s-]+/gu, '').toLowerCase();
  // A bare name may need clarification, but an explicit search/source
  // request already tells us the user's action. Do not mistake a complete
  // request such as “find a current source about Ada Lovelace” for a bare
  // ambiguous label and suppress the bounded search recovery path.
  const hasExplicitSearchLanguage = SEARCH_TERMS.test(String(value || '')) || THAI_SEARCH_TERMS.test(String(value || ''));
  const explicitClarification = CLARIFICATION_TERMS.test(String(value || ''));
  const likelyAmbiguous = !comparison.detected && !hasExplicitSearchLanguage && compact.length > 0 && compact.length < 80
    && (explicitClarification || (!/\b(what|who|how|why|when|where|is|are)\b/iu.test(String(value || ''))
      && !THAI_INTERROGATIVE_TERMS.test(String(value || ''))));
  const prior = Array.isArray(history) ? history.slice(-4).map(turn => String(turn?.content || '').trim()).filter(Boolean) : [];
  return {
    comparison: comparison.detected,
    candidate_entities: comparison.entities,
    likely_ambiguous: likelyAmbiguous,
    context_candidates: prior.slice(-2),
    policy: comparison.detected ? 'compare_candidates_before_answering' : likelyAmbiguous ? 'ask_if_search_evidence_cannot_resolve' : 'answer_or_search_normally',
    clarification_question: likelyAmbiguous ? 'Which person, character, work, or topic do you mean? I can search the approved sources after you specify.' : null,
  };
}

function searchQueryVariants(value, disambiguation, reference, qualifiers = []) {
  const original = String(value || '').trim();
  const variants = [];
  const add = (query, reason) => {
    const normalized = String(query || '').trim().replace(/\s+/gu, ' ');
    if (!normalized || variants.some(item => item.query.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return;
    variants.push({ query: normalized, reason });
  };
  add(original, 'original_user_message');
  if (disambiguation.comparison) {
    for (const entity of disambiguation.candidate_entities) {
      add(entity.raw, 'comparison_candidate');
      const dehyphenatedEntity = entity.raw.replace(/(?<=\p{L})-(?=\p{L})/gu, ' ');
      if (dehyphenatedEntity !== entity.raw) add(dehyphenatedEntity, 'comparison_candidate_hyphen_spacing_variant');
    }
    for (const qualifier of qualifiers) {
      for (const entity of disambiguation.candidate_entities) {
        add(`${entity.raw} ${qualifier}`, 'comparison_candidate_with_context');
        const dehyphenatedEntity = entity.raw.replace(/(?<=\p{L})-(?=\p{L})/gu, ' ');
        if (dehyphenatedEntity !== entity.raw) add(`${dehyphenatedEntity} ${qualifier}`, 'comparison_candidate_hyphen_spacing_with_context');
      }
    }
  }
  const dehyphenated = original.replace(/(?<=\p{L})-(?=\p{L})/gu, ' ');
  if (dehyphenated !== original) add(dehyphenated, 'hyphen_spacing_variant');
  // Preserve the original spelling, but make a conservative query variant for
  // a commonly pasted TitleCase name such as "ParkDayoung". We never invent
  // a spelling correction for a fully lowercase unknown word.
  const splitTitleCase = original.replace(/([\p{Ll}])([\p{Lu}])/gu, '$1 $2');
  if (splitTitleCase !== original) add(splitTitleCase, 'titlecase_spacing_variant');
  if (disambiguation.likely_ambiguous && /^[\p{L}\p{N} ]{3,80}$/u.test(original) && original.includes(' ')) {
    add(original.replace(/\s+/gu, '-'), 'hyphenated_name_variant');
  }
  if (reference?.recommended_query) add(reference.recommended_query, 'resolved_context_reference');
  // Keep the list bounded, but preserve one context-qualified variant for
  // each comparison candidate. Five slots are not enough when a name also
  // needs a hyphen-spacing variant; eight keeps the router advisory without
  // creating an unbounded search plan.
  return variants.slice(0, 8);
}

function analyzeIntent({ content, history = [], attachments = [] } = {}) {
  const original = String(content ?? '');
  const normalized = original.trim();
  const prior = Array.isArray(history) ? history : [];
  const correctionDetected = CORRECTION_TERMS.test(normalized);
  const entityAliases = explicitEntityAliases(normalized);
  let disambiguation = disambiguationHints(normalized, prior);
  const reference = referenceResolution(normalized, prior);
  // A pronoun-only follow-up is ambiguous only until the recent context
  // resolves it. Keep the original message unchanged, but tell the model that
  // it may use the resolved entity instead of asking the user to repeat it.
  if (reference.status === 'resolved_from_context' || reference.status === 'resolved_ordinal_context') {
    disambiguation = Object.freeze({
      ...disambiguation,
      likely_ambiguous: false,
      policy: 'use_resolved_context_reference',
      clarification_question: null,
    });
  }
  const unresolvedReference = reference.has_reference
    && !['resolved_from_context', 'resolved_ordinal_context', 'not_applicable'].includes(reference.status);
  // Include the current user turn so a correction such as "not the singer,
  // the manhwa character" immediately overrides stale domain context.
  const qualifiers = contextQualifiers([...prior, { role: 'user', content: normalized }]);
  const signals = [];
  const directTransform = DIRECT_TRANSFORM_TERMS.test(normalized);
  const selfReferential = /\b(?:you|your|we|our|i|my)\b/iu.test(normalized);
  if (!directTransform && (SEARCH_TERMS.test(normalized) || THAI_SEARCH_TERMS.test(normalized) || (FACTUAL_QUERY_TERMS.test(normalized) && !selfReferential))) signals.push('web_search');
  if (COMMERCE_TERMS.test(normalized)) signals.push('commerce');
  if (!directTransform && looksLikeNamedLookup(normalized)) signals.push('web_search', 'named_lookup');
  if (disambiguation.comparison) signals.push('web_search', 'clarification_candidate');
  if (FILE_TERMS.test(normalized) || attachments.length) signals.push('file_analysis');
  if (CREATIVE_TERMS.test(normalized)) signals.push('creative_workflow');
  if (ACTION_TERMS.test(normalized)) signals.push('external_action');
  if (CLARIFICATION_TERMS.test(normalized) || countWords(normalized) <= 3) signals.push('clarification_candidate');

  const candidates = [];
  if (signals.includes('web_search')) candidates.push({ intent: 'web_search', confidence: score(signals, 'web_search'), reason: 'The message contains a current-information, source, or search signal.' });
  if (signals.includes('file_analysis')) candidates.push({ intent: 'file_analysis', confidence: score(signals, 'file_analysis'), reason: 'The message refers to an attached or file-like input.' });
  if (signals.includes('creative_workflow')) candidates.push({ intent: 'creative_workflow', confidence: score(signals, 'creative_workflow'), reason: 'The message asks for a creative or presentation workflow.' });
  if (signals.includes('external_action')) candidates.push({ intent: 'external_action', confidence: score(signals, 'external_action'), reason: 'The message may request a state-changing action.' });
  if (signals.includes('commerce')) candidates.push({ intent: 'commerce', confidence: 0.9, reason: 'The message asks about the owner-scoped business workspace or commerce data.' });
  if (signals.includes('clarification_candidate')) candidates.push({ intent: 'clarification', confidence: 0.62, reason: 'The message may be short, ambiguous, or comparison-oriented.' });
  if (!candidates.length) candidates.push({ intent: 'general_chat', confidence: 0.78, reason: 'No reliable tool signal was found; let the model answer directly.' });
  candidates.sort((left, right) => right.confidence - left.confidence);

  const top = candidates[0];
  const ambiguous = candidates.length > 1 && Math.abs(candidates[0].confidence - candidates[1].confidence) < 0.18;
  const needsLatest = /\b(latest|today|now|current|recent)\b/iu.test(normalized) || THAI_LATEST_TERMS.test(normalized);
  const lower = normalized.toLowerCase();
  const visualDiscoveryContext = /\b(?:manhwa|manga|webtoon|character|fanart|fandom)\b/iu.test(normalized) || THAI_MANHWA_CONTEXT.test(normalized);
  const hasExplicitSourceScope = /\bwikipedia\b|\bencyclopedi|\bpinterest\b|\btiktok\b|\binstagram\b|\bfacebook\b|\byoutube\b|\bvideo\b/iu.test(lower) || GEMINI_TERMS.test(normalized) || THAI_SOCIAL_TERMS.test(normalized) || THAI_VIDEO_TERMS.test(normalized);
  const sourceScopeCandidates = unique([
    /\bwikipedia\b|encyclopedi/iu.test(lower) ? 'encyclopedic' : null,
    /\bpinterest\b|\btiktok\b|\binstagram\b|\bfacebook\b/iu.test(lower) || THAI_SOCIAL_TERMS.test(normalized) || visualDiscoveryContext || qualifiers.includes('manhwa character') ? 'social' : null,
    /\byoutube\b|\bvideo\b/iu.test(lower) || THAI_VIDEO_TERMS.test(normalized) ? 'video' : null,
    GEMINI_TERMS.test(normalized) ? 'ai_summary' : null,
    (disambiguation.comparison || signals.includes('named_lookup')) && !hasExplicitSourceScope ? 'encyclopedic' : null,
    'auto',
  ].filter(Boolean));
  // Candidate scopes are advisory. Only an explicit platform/source request
  // becomes a required scope; contextual hints such as "manhwa" must not
  // silently force the model into a social-only search.
  const requestedSourceScopes = unique([
    /\bwikipedia\b|encyclopedi/iu.test(lower) ? 'encyclopedic' : null,
    /\bpinterest\b|\btiktok\b|\binstagram\b|\bfacebook\b/iu.test(lower) || THAI_SOCIAL_TERMS.test(normalized) ? 'social' : null,
    /\byoutube\b|\bvideo\b/iu.test(lower) || THAI_VIDEO_TERMS.test(normalized) ? 'video' : null,
    GEMINI_TERMS.test(normalized) ? 'ai_summary' : null,
  ].filter(Boolean));
  const sourceScopePriority = unique([
    ...requestedSourceScopes,
    (visualDiscoveryContext || qualifiers.includes('manhwa character')) ? 'social' : null,
    (disambiguation.comparison || signals.includes('named_lookup') || visualDiscoveryContext || qualifiers.includes('manhwa character')) && requestedSourceScopes.length === 0 ? 'encyclopedic' : null,
    ...sourceScopeCandidates,
  ].filter(Boolean));
  const allowedTools = [];
  if (signals.includes('web_search')) {
    // Page reading is a dependent follow-up tool: the model may use it only
    // after an approved search result supplies a URL. Expose that capability
    // in the advisory hints so tool selection can distinguish discovery from
    // evidence reading without making either one a hard gate.
    allowedTools.push('web_search', 'web_read_page');
  }
  if (signals.includes('file_analysis')) allowedTools.push('file_reader');
  if (signals.includes('creative_workflow')) allowedTools.push('creative_planner');
  if (signals.includes('commerce')) allowedTools.push('commerce');
  const safetyConstraints = ['do_not_expose_secrets', 'do_not_claim_unverified_facts', 'require_confirmation_for_state_change'];
  if (signals.includes('external_action')) safetyConstraints.push('external_action_requires_explicit_confirmation');

  return Object.freeze({
    schema_version: HINTS_SCHEMA_VERSION,
    original_message: original,
    candidate_intents: candidates,
    top_intent: top.intent,
    confidence: top.confidence,
    ambiguous,
    conversational_context: {
      prior_turn_count: prior.length,
      has_follow_up_context: prior.length > 0,
      preserve_full_history: true,
      correction_detected: correctionDetected,
      correction_policy: correctionDetected ? 'prefer_latest_user_correction' : 'not_applicable',
    },
    task: {
      instruction_plan: buildInstructionPlan(original),
      direct_transformation: directTransform,
      direct_response_required: directTransform,
      needs_latest_information: needsLatest,
      goals: unique(signals),
      sequence: signals.includes('web_search') ? [disambiguation.comparison ? 'compare_candidates' : 'understand_intent', disambiguation.likely_ambiguous || unresolvedReference ? 'resolve_ambiguity' : 'search_if_needed', 'let_model_synthesize'] : ['understand_intent', 'let_model_respond'],
      source_scope_candidates: sourceScopeCandidates,
      source_scope_priority: sourceScopePriority,
      requested_source_scopes: requestedSourceScopes,
      search_query_variants: searchQueryVariants(normalized, disambiguation, reference, qualifiers),
      context_entity_candidates: reference.candidates,
      entity_alias_candidates: entityAliases,
      context_qualifiers: qualifiers,
    },
    allowed_tools: allowedTools,
    disambiguation,
    reference_resolution: reference,
    safety_constraints: safetyConstraints,
    routing: {
      mode: ambiguous || top.intent === 'general_chat' || top.intent === 'clarification' ? 'model_first' : 'model_first_with_tool_hints',
      hard_gate: false,
      direct_transformation: directTransform,
      model_may_choose_tools: true,
      ask_clarification_if_unresolved: disambiguation.likely_ambiguous || unresolvedReference,
    },
  });
}

module.exports = { HINTS_SCHEMA_VERSION, analyzeIntent, contextEntities, contextQualifiers, explicitEntityAliases, referenceOrdinal, referenceResolution, searchQueryVariants };
