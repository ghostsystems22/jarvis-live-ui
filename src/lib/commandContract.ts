export const agents = [
  { id: 'jarvis', label: 'JARVIS', role: 'Executive orchestration', accent: 'cyan' },
  { id: 'ultron', label: 'ULTRON', role: 'Technical delivery', accent: 'cyan' },
  { id: 'atlas', label: 'ATLAS', role: 'Architecture', accent: 'violet' },
  { id: 'forge', label: 'FORGE', role: 'Implementation', accent: 'orange' },
  { id: 'sentinel', label: 'SENTINEL', role: 'Verification', accent: 'green' },
  { id: 'helios', label: 'HELIOS', role: 'Growth & content', accent: 'amber' },
  { id: 'nexus', label: 'NEXUS', role: 'Fiber operations', accent: 'blue' },
] as const;

export const models = [
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', vendor: 'OpenAI Codex' },
  { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI Codex' },
  { id: 'gpt-5.4', label: 'GPT-5.4', vendor: 'OpenAI Codex' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', vendor: 'OpenAI Codex' },
] as const;

export type AgentId = (typeof agents)[number]['id'];
export type ModelId = (typeof models)[number]['id'];

export function assertAllowedSelection(agentId: string, modelId: string): { agentId: AgentId; modelId: ModelId } {
  const agent = agents.find((candidate) => candidate.id === agentId);
  const model = models.find((candidate) => candidate.id === modelId);
  if (!agent || !model) throw new Error('Unsupported agent or model selection.');
  return { agentId: agent.id, modelId: model.id };
}
