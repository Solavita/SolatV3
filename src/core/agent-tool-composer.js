function composeAgentTools(...groups) {
  const active = groups.filter(Boolean);
  const registry = {};
  const definitions = [];
  const executors = new Map();
  for (const group of active) {
    for (const [name, definition] of Object.entries(group.registry || {})) {
      if (registry[name]) throw new Error(`Duplicate agent tool: ${name}`);
      registry[name] = definition;
      executors.set(name, group.executeTool);
    }
    for (const definition of group.definitions || []) definitions.push(definition);
  }
  return {
    registry,
    definitions,
    async executeTool(context) {
      const executor = executors.get(context?.tool);
      if (!executor) return { status: 'failed', error: { code: 'unauthorized_tool', message: 'Tool is not registered.' } };
      return executor(context);
    },
  };
}

module.exports = { composeAgentTools };
