export type PlanState = 'scheduled' | 'pinned' | 'deferred' | 'late' | 'split' | 'unplannable';
export type PlanPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'urgent' | 'important' | 'normal' | 'low';

export interface PlanSettings { defaultDayHours: number; defaultTaskHours: number; spillHorizonDays: number }
export interface PlanTask { id: string; name: string; status: string; priority: PlanPriority; estimatedHours?: number; loggedHours?: number; pinnedDay?: string; dueDate?: string; createdAt?: string; displayOrder?: number; capacityExempt?: boolean; isGroup?: boolean }
export interface PlanItem { taskId: string; costHours: number; totalCostHours: number; state: PlanState; segmentIndex?: number; segmentCount?: number; originalDay?: string; dueDate?: string; isUnestimated?: boolean }
export interface DayPlan { day: string; capacityHours: number; committedHours: number; ratio: number; state: 'closed' | 'ok' | 'tight' | 'over'; items: PlanItem[] }

const priorityRank: Record<string, number> = { P0: 0, urgent: 0, P1: 1, important: 1, P2: 2, normal: 2, P3: 3, low: 3 };
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, amount: number) => { const date = new Date(`${day}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + amount); return iso(date); };
const weekday = (day: string) => new Date(`${day}T00:00:00.000Z`).getUTCDay();
const positive = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function costOf(task: PlanTask, settings: PlanSettings): { hours: number; isUnestimated: boolean } {
  if (task.capacityExempt) return { hours: 0, isUnestimated: false };
  if (positive(task.estimatedHours) > 0) return { hours: Math.max(0.25, positive(task.estimatedHours) - positive(task.loggedHours)), isUnestimated: false };
  return { hours: settings.defaultTaskHours, isUnestimated: true };
}

export function buildPlan(tasks: PlanTask[], dayCapacity: Record<string, number>, template: number[], settings: PlanSettings, today: string): DayPlan[] {
  const horizon = Math.max(0, Math.floor(settings.spillHorizonDays));
  const days: DayPlan[] = Array.from({ length: horizon + 1 }, (_, index) => {
    const day = addDays(today, index);
    const capacityHours = positive(dayCapacity[day] ?? template[weekday(day)] ?? settings.defaultDayHours);
    return { day, capacityHours, committedHours: 0, ratio: 0, state: capacityHours === 0 ? 'closed' : 'ok', items: [] };
  });
  const active = tasks.filter((task) => !task.isGroup && !['Terminé', 'Annulé', 'Completed', 'Cancelled'].includes(task.status));
  const ordered = [...active].sort((left, right) => {
    const leftOverdue = Boolean(left.dueDate && left.dueDate < today);
    const rightOverdue = Boolean(right.dueDate && right.dueDate < today);
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    if (leftOverdue && rightOverdue && left.dueDate !== right.dueDate) return (left.dueDate ?? '').localeCompare(right.dueDate ?? '');
    const priority = (priorityRank[left.priority] ?? 2) - (priorityRank[right.priority] ?? 2);
    if (priority) return priority;
    const leftDue = left.dueDate ?? '9999-12-31'; const rightDue = right.dueDate ?? '9999-12-31';
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    const displayOrder = (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER);
    if (displayOrder) return displayOrder;
    return (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.id.localeCompare(right.id);
  });
  const updateState = (day: DayPlan) => { day.ratio = day.capacityHours === 0 ? 0 : day.committedHours / day.capacityHours; day.state = day.capacityHours === 0 ? 'closed' : day.ratio > 1 ? 'over' : day.ratio >= 0.9 ? 'tight' : 'ok'; };
  const add = (day: DayPlan, item: PlanItem, consumes = true) => { day.items.push(item); if (consumes) day.committedHours += item.costHours; updateState(day); };
  const placementState = (task: PlanTask, day: string, originalDay: string): PlanState => (task.dueDate && (task.dueDate < today || day > task.dueDate)) ? 'late' : day === originalDay ? 'scheduled' : 'deferred';
  const unplannable = (task: PlanTask, cost: number, unestimated: boolean) => add(days[0], { taskId: task.id, costHours: cost, totalCostHours: cost, state: 'unplannable', originalDay: today, dueDate: task.dueDate, isUnestimated: unestimated }, false);

  for (const task of ordered.filter((task) => task.pinnedDay)) {
    const { hours, isUnestimated } = costOf(task, settings);
    const found = days.findIndex((day) => day.day === task.pinnedDay);
    const target = days[Math.max(0, found)];
    add(target, { taskId: task.id, costHours: hours, totalCostHours: hours, state: 'pinned', dueDate: task.dueDate, isUnestimated });
  }
  for (const task of ordered.filter((candidate) => !candidate.pinnedDay)) {
    const { hours, isUnestimated } = costOf(task, settings);
    if (hours === 0) { const target = days.find((day) => day.capacityHours > 0) ?? days[0]; add(target, { taskId: task.id, costHours: 0, totalCostHours: 0, state: placementState(task, target.day, today), originalDay: target.day === today ? undefined : today, dueDate: task.dueDate, isUnestimated }); continue; }
    const maxDailyCapacity = Math.max(0, ...days.map((day) => day.capacityHours));
    if (maxDailyCapacity === 0) { unplannable(task, hours, isUnestimated); continue; }
    if (hours > maxDailyCapacity) {
      let remaining = hours; const placements: { day: DayPlan; cost: number }[] = [];
      for (const day of days) { if (remaining <= 0) break; const available = Math.max(0, day.capacityHours - day.committedHours); if (available <= 0) continue; const segment = Math.min(available, remaining); placements.push({ day, cost: segment }); remaining -= segment; }
      if (remaining > 0) { unplannable(task, hours, isUnestimated); continue; }
      placements.forEach(({ day, cost }, index) => add(day, { taskId: task.id, costHours: cost, totalCostHours: hours, state: 'split', segmentIndex: index + 1, segmentCount: placements.length, originalDay: day.day === today ? undefined : today, dueDate: task.dueDate, isUnestimated }));
      continue;
    }
    const target = days.find((day) => day.capacityHours > 0 && day.committedHours + hours <= day.capacityHours);
    if (!target) { unplannable(task, hours, isUnestimated); continue; }
    const state = placementState(task, target.day, today);
    add(target, { taskId: task.id, costHours: hours, totalCostHours: hours, state, originalDay: state === 'scheduled' ? undefined : today, dueDate: task.dueDate, isUnestimated });
  }
  return days;
}
