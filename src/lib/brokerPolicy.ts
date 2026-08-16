export const brokerPolicies = {
  jarvis: { modelId: 'gpt-5.6-terra', toolsets: 'safe', capability: 'read_only' },
  ultron: { modelId: 'gpt-5.6-terra', toolsets: 'safe', capability: 'read_only' },
  atlas: { modelId: 'gpt-5.5', toolsets: 'safe', capability: 'read_only' },
  forge: { modelId: 'gpt-5.5', toolsets: 'safe', capability: 'read_only' },
  sentinel: { modelId: 'gpt-5.5', toolsets: 'safe', capability: 'read_only' },
  helios: { modelId: 'gpt-5.5', toolsets: 'safe', capability: 'read_only' },
  nexus: { modelId: 'gpt-5.5', toolsets: 'safe', capability: 'read_only' },
} as const;

export type BrokerAgentId = keyof typeof brokerPolicies;

export function resolveBrokerPolicy(agentId: string, requestedModelId?: string) {
  const policy = brokerPolicies[agentId as BrokerAgentId];
  if (!policy) throw new Error('Agent is not allowlisted.');
  if (requestedModelId && requestedModelId !== policy.modelId) {
    throw new Error('This profile is pinned to its configured model.');
  }
  return policy;
}
