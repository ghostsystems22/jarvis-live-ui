export type ApiRecord<T extends Record<string, unknown> = Record<string, unknown>> = { id: string; createdTime?: string; fields: T };
export type TaskFields = { name?: string; type?: string; status?: string; priority?: string; deadlineMode?: string; notes?: string; estimatedHours?: number; legacyEstimateHours?: number; loggedHours?: number; dueDate?: string; startNotBefore?: string; completedAt?: string; displayOrder?: number; tags?: string[]; project?: string[]; parent?: string[]; children?: string[]; blockedBy?: string[]; blocks?: string[]; milestone?: string[]; phase?: string[]; pinnedDay?: string; capacityExempt?: boolean };
export type Bootstrap = { Projects: ApiRecord[]; Phases: ApiRecord[]; Tasks: ApiRecord<TaskFields>[]; Milestones: ApiRecord[]; 'Day Capacity': ApiRecord[]; 'Capacity Template': ApiRecord[]; Settings: ApiRecord[] };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/cadence${path}`, { headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? `Cadence API ${response.status}`);
  return response.json() as Promise<T>;
}

export const cadenceApi = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  update: (table: string, id: string, fields: Record<string, unknown>) => request<ApiRecord>(`/${encodeURIComponent(table)}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields }) }),
  upsert: (table: string, records: { id?: string; fields: Record<string, unknown> }[], fieldsToMergeOn?: string[]) => request<{ records: ApiRecord[] }>(`/${encodeURIComponent(table)}`, { method: 'PATCH', body: JSON.stringify({ records, ...(fieldsToMergeOn ? { performUpsert: { fieldsToMergeOn } } : {}) }) }),
  remove: (table: string, id: string) => request<{ id: string; deleted: boolean }>(`/${encodeURIComponent(table)}/${id}`, { method: 'DELETE' }),
};
