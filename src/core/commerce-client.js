class CommerceClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CommerceClientError';
    this.code = code;
    this.details = details;
  }
}

const READ_ACTIONS = new Set([
  'business_profile_get', 'business_audit', 'commerce_summary', 'commerce_alerts',
  'commerce_customers', 'commerce_products', 'commerce_orders', 'commerce_audit',
  'commerce_follow_ups', 'commerce_repeat_purchase_candidates', 'commerce_provider_readiness',
]);

const ACTION_PATHS = Object.freeze({
  business_profile_get: ['GET', '/api/v1/business/profile'],
  business_audit: ['GET', '/api/v1/business/audit'],
  commerce_summary: ['GET', '/api/v1/commerce/summary'],
  commerce_alerts: ['GET', '/api/v1/commerce/alerts'],
  commerce_customers: ['GET', '/api/v1/commerce/customers'],
  commerce_products: ['GET', '/api/v1/commerce/products'],
  commerce_orders: ['GET', '/api/v1/commerce/orders'],
  commerce_audit: ['GET', '/api/v1/commerce/audit'],
  commerce_follow_ups: ['GET', '/api/v1/commerce/follow-ups'],
  commerce_repeat_purchase_candidates: ['GET', '/api/v1/commerce/repeat-purchase-candidates'],
  commerce_provider_readiness: ['GET', '/api/v1/commerce/provider-readiness'],
  business_profile_save: ['PUT', '/api/v1/business/profile'],
  commerce_intake_text: ['POST', '/api/v1/commerce/intake/text'],
  commerce_create_customer: ['POST', '/api/v1/commerce/customers'],
  commerce_create_product: ['POST', '/api/v1/commerce/products'],
  commerce_create_order: ['POST', '/api/v1/commerce/orders'],
  commerce_create_draft: ['POST', '/api/v1/commerce/drafts'],
  commerce_approve_draft: ['POST', '/api/v1/commerce/drafts/{id}/approve'],
  commerce_order_update: ['PATCH', '/api/v1/commerce/orders/{id}'],
  commerce_order_transition: ['POST', '/api/v1/commerce/orders/{id}/transition'],
  commerce_verify_payment: ['POST', '/api/v1/commerce/orders/{id}/verify-payment'],
  commerce_create_shipment: ['POST', '/api/v1/commerce/orders/{id}/shipment'],
  commerce_create_follow_up: ['POST', '/api/v1/commerce/follow-ups'],
  commerce_complete_follow_up: ['POST', '/api/v1/commerce/follow-ups/{id}/complete'],
  commerce_create_quote: ['POST', '/api/v1/commerce/drafts/quote'],
  commerce_create_invoice: ['POST', '/api/v1/commerce/drafts/invoice'],
  commerce_send_draft: ['POST', '/api/v1/commerce/drafts/{id}/send'],
});

const WRITE_ACTIONS = new Set(Object.keys(ACTION_PATHS).filter(action => !READ_ACTIONS.has(action)));

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function safeBody(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommerceClientError('invalid_tool_arguments', 'Commerce payload must be an object.');
  }
  return value;
}

class CommerceClient {
  constructor({ baseUrl = '', userId = '', token = '', timeoutMs = 12000, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.userId = String(userId || '').trim();
    this.token = String(token || '').trim();
    this.timeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 12000;
    this.fetchImpl = fetchImpl;
  }

  status() {
    return Object.freeze({
      provider: 'solat_backend_commerce',
      enabled: Boolean(this.baseUrl),
      configured: Boolean(this.baseUrl && this.userId),
      baseHost: this.baseUrl ? (() => { try { return new URL(this.baseUrl).host; } catch { return null; } })() : null,
      capabilities: [...READ_ACTIONS].sort(),
      write_confirmation_required: [...WRITE_ACTIONS].sort(),
    });
  }

  toolDefinition() {
    return {
      type: 'function',
      function: {
        name: 'commerce',
        description: 'Read or manage the owner-scoped SOLAT business profile and commerce workspace. Read actions are safe to inspect. Any write, approval, or persistent change requires confirm=true; never claim payment or shipping success without a provider response.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: Object.keys(ACTION_PATHS) },
            id: { type: 'string' },
            payload: { type: 'object', additionalProperties: true },
            confirm: { type: 'boolean' },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    };
  }

  async execute(call) {
    if (!call || call.name !== 'commerce') throw new CommerceClientError('tool_not_allowed', 'Only the commerce tool is allowed.');
    const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
    const action = String(args.action || '').trim();
    const route = ACTION_PATHS[action];
    if (!route) throw new CommerceClientError('invalid_tool_arguments', 'Unknown commerce action.');
    if (!this.baseUrl || !this.userId) {
      return { status: 'unavailable', tool: 'commerce', action, error: { code: 'commerce_backend_not_configured', message: 'The business workspace is not connected in this desktop installation.' } };
    }
    if (WRITE_ACTIONS.has(action) && args.confirm !== true) {
      return { status: 'confirmation_required', tool: 'commerce', action, message: 'This action changes persistent business data. Ask the owner for explicit confirmation before retrying with confirm=true.' };
    }
    const body = safeBody(args.payload);
    let path = route[1];
    if (path.includes('{id}')) {
      const id = String(args.id || '').trim();
      if (!id) throw new CommerceClientError('invalid_tool_arguments', 'This commerce action requires an id.');
      path = path.replace('{id}', encodeURIComponent(id));
    }
    return this.request(route[0], path, body);
  }

  async request(method, path, body) {
    if (typeof this.fetchImpl !== 'function') throw new CommerceClientError('tool_unavailable', 'This runtime cannot reach the business workspace.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { Accept: 'application/json', 'X-User-ID': this.userId };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      let data = null;
      try { data = await response.json(); } catch { throw new CommerceClientError('malformed_response', 'The business workspace returned invalid JSON.'); }
      if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : 'The business workspace rejected the request.';
        throw new CommerceClientError(`backend_http_${response.status}`, detail, { status: response.status });
      }
      return { status: 'ready', tool: 'commerce', data };
    } catch (error) {
      if (error instanceof CommerceClientError) throw error;
      if (error?.name === 'AbortError') throw new CommerceClientError('timeout', 'The business workspace timed out.');
      throw new CommerceClientError('backend_unavailable', 'The business workspace could not be reached.');
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { CommerceClient, CommerceClientError, READ_ACTIONS, WRITE_ACTIONS };
