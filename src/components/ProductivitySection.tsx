import { useEffect, useMemo, useState } from 'react';
import { cadenceApi, type ApiRecord, type Bootstrap, type TaskFields } from '../lib/cadenceApi';
import type { DayPlan } from '../lib/planEngine';

type ProductivityPage = 'overview' | 'tasks' | 'projects' | 'gantt' | 'cockpit' | 'resources';
type ProductivityModel = {
  data: Bootstrap;
  template: Record<number, number>;
  capacity: Record<string, number>;
  plan: DayPlan[];
  current: DayPlan;
};

type Props = {
  model: ProductivityModel;
  error?: string;
  today: string;
  onReload: () => Promise<void>;
  onSetCapacity: (day: string, value: number) => Promise<void>;
  onPinTask: (task: ApiRecord<TaskFields>) => Promise<void>;
};

const pages: Array<{ id: ProductivityPage; label: string }> = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'tasks', label: 'TASKS' },
  { id: 'projects', label: 'PROJECTS' },
  { id: 'gantt', label: 'GANTT' },
  { id: 'cockpit', label: 'COCKPIT' },
  { id: 'resources', label: 'RESOURCES' },
];

const doneStatuses = ['Terminé', 'Annulé', 'Completed', 'Cancelled', 'Done'];
const monthTargets = [
  ['AUG', '$0 / $2,000', 28],
  ['SEP', '— / $5,000', 0],
  ['OCT', '— / $12,000', 0],
  ['NOV', '— / $25,000', 0],
  ['DEC', '— / $50,000', 0],
  ['JAN', '— / $100,000', 0],
] as const;

function text(value: unknown, fallback = '—') {
  return Array.isArray(value) ? String(value[0] ?? fallback) : typeof value === 'string' && value.trim() ? value : fallback;
}
function hours(value: number) { return `${Number.isInteger(value) ? value : value.toFixed(1)}h`; }
function money(value: number) { return `$${value.toLocaleString('en-US')}`; }
function dateLabel(day: string) { return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`)).toUpperCase(); }
function shortDate(day?: string) { return day ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`)) : 'No date'; }
function estimate(task: ApiRecord<TaskFields>) { return Number(task.fields.estimatedHours ?? task.fields.legacyEstimateHours ?? 1); }
function logged(task: ApiRecord<TaskFields>) { return Number(task.fields.loggedHours ?? 0); }
function projectName(projectId: string | undefined, projects: ApiRecord[]) { return projects.find((project) => project.id === projectId)?.fields.name as string | undefined; }
function phaseName(phaseId: string | undefined, phases: ApiRecord[]) { return phases.find((phase) => phase.id === phaseId)?.fields.name as string | undefined; }
function isDone(task: ApiRecord<TaskFields>) { return doneStatuses.includes(String(task.fields.status ?? '')); }
function stateBadge(state: string) { return state === 'over' || state === 'late' ? 'overdue' : state === 'tight' ? 'amber' : state === 'closed' || state === 'done' ? 'done' : 'active'; }
function dueTone(task: ApiRecord<TaskFields>, today: string) { const due = task.fields.dueDate; if (!due) return ''; if (due < today) return 'overdue'; if (due === today) return 'today'; return 'future'; }
function weekday(day: string) { return new Date(`${day}T12:00:00Z`).getDay(); }

function CapacityDial({ value, committed, template, size = 'lg', onChange, readOnly = false }: { value: number; committed: number; template: number; size?: 'lg' | 'md' | 'sm'; onChange?: (hours: number) => void; readOnly?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const diameter = size === 'lg' ? 184 : size === 'md' ? 118 : 56;
  const snap = (next: number) => Math.max(0, Math.min(12, Math.round(next * 2) / 2));
  const fromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 100 - 50;
    const y = ((event.clientY - box.top) / box.height) * 100 - 50;
    let angle = Math.atan2(y, x) * 180 / Math.PI;
    if (angle < 135) angle += 360;
    return snap(((angle - 135) / 270) * 12);
  };
  const commit = (next: number) => { const snapped = snap(next); setDraft(snapped); onChange?.(snapped); };
  const ratio = value ? committed / value : committed ? Infinity : 0;
  return <div className={`capacity-dial dial-${size}`} style={{ width: diameter }}>
    <svg viewBox="0 0 100 100" role="slider" aria-valuemin={0} aria-valuemax={12} aria-valuenow={draft} aria-label="Dynamic time wheel" tabIndex={readOnly ? -1 : 0} onPointerDown={(event) => { if (readOnly) return; event.currentTarget.setPointerCapture(event.pointerId); setDraft(fromPointer(event)); }} onPointerMove={(event) => { if (!readOnly && event.currentTarget.hasPointerCapture(event.pointerId)) setDraft(fromPointer(event)); }} onPointerUp={(event) => { if (!readOnly) commit(fromPointer(event)); }} onWheel={(event) => { if (!readOnly) { event.preventDefault(); commit(draft + (event.deltaY > 0 ? -0.5 : 0.5)); } }} onKeyDown={(event) => { if (readOnly) return; if (event.key === 'ArrowUp') commit(draft + (event.shiftKey ? 1 : 0.5)); if (event.key === 'ArrowDown') commit(draft - (event.shiftKey ? 1 : 0.5)); if (event.key === 'Home') commit(0); if (event.key === 'End') commit(template); }}>
      <path className="dial-track" d="M 22.4 77.6 A 39 39 0 1 1 77.6 77.6" fill="none" pathLength="100" />
      <path className="dial-budget" d="M 22.4 77.6 A 39 39 0 1 1 77.6 77.6" fill="none" pathLength="100" strokeDasharray={`${draft / 12 * 100} 100`} />
      <path className={`dial-committed ${ratio > 1 ? 'over' : ratio >= 0.9 ? 'tight' : ''}`} d="M 28 72 A 31 31 0 1 1 72 72" fill="none" pathLength="100" strokeDasharray={`${Math.min(1, committed / 12) * 100} 100`} />
    </svg>
    {size !== 'sm' && <div className="dial-value"><b>{hours(draft)}</b><small>{hours(committed)} engagées</small></div>}
  </div>;
}

export default function ProductivitySection({ model, error, today, onReload, onSetCapacity, onPinTask }: Props) {
  const [page, setPage] = useState<ProductivityPage>('overview');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(model.data.Projects[0]?.id ?? '');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [expandedDay, setExpandedDay] = useState<string>(today);
  const [expandedProjectId, setExpandedProjectId] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const week = model.plan.slice(0, 7);
  const activeTasks = model.data.Tasks.filter((task) => !isDone(task));
  const selectedProject = model.data.Projects.find((project) => project.id === selectedProjectId) ?? model.data.Projects[0];
  const selectedTask = model.data.Tasks.find((task) => task.id === selectedTaskId) ?? null;
  const total = week.reduce((sum, day) => sum + day.committedHours, 0);
  const available = week.reduce((sum, day) => sum + day.capacityHours, 0);
  const focusItem = model.current.items.find((item) => ['scheduled', 'pinned', 'split'].includes(item.state));
  const focusTask = focusItem ? model.data.Tasks.find((task) => task.id === focusItem.taskId) : activeTasks[0];
  const tomorrow = week[1];
  const taskById = useMemo(() => Object.fromEntries(model.data.Tasks.map((task) => [task.id, task])), [model.data.Tasks]);

  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(''), 2500); }
  async function completeTask(task: ApiRecord<TaskFields>) { setSaving(true); try { await cadenceApi.update('Tasks', task.id, { status: 'Terminé', completedAt: today }); showToast('Task completed ✓'); await onReload(); } catch { showToast('Task update failed ✗'); } finally { setSaving(false); } }
  async function updateTask(task: ApiRecord<TaskFields>, field: keyof TaskFields, value: unknown) { setSaving(true); try { await cadenceApi.update('Tasks', task.id, { [field]: value }); showToast('Saved ✓'); await onReload(); } catch { showToast('Save failed ✗'); } finally { setSaving(false); } }
  async function pinToday(task: ApiRecord<TaskFields>) { setSaving(true); try { await onPinTask(task); showToast('Pinned to today ✓'); } catch { showToast('Pin failed ✗'); } finally { setSaving(false); } }
  function dayTasks(day: DayPlan) { return day.items.map((item) => taskById[item.taskId]).filter(Boolean) as ApiRecord<TaskFields>[]; }
  function filteredDayTasks(day: DayPlan) { const tasks = dayTasks(day); return selectedProject ? tasks.filter((task) => task.fields.project?.includes(selectedProject.id)) : tasks; }
  function templateFor(day: string) { return model.template[weekday(day)] ?? (weekday(day) === 0 || weekday(day) === 6 ? 0 : 8); }

  function renderHero() { return <div className="productivity-hero"><div><p className="eyebrow">CADENCE PRODUCTIVITY</p><h1>Executable plan, not infinite list.</h1><span>{model.data.Projects.length} projects · {activeTasks.length} active tasks · {hours(total)} / {hours(available)} committed this week.</span></div><button className="refresh-button prod-refresh" onClick={() => void onReload()} type="button">SYNC ↻</button></div>; }

  function renderResourceWheel(day = model.current) {
    return <article className="card glass resource-wheel-panel"><div className="section-title">RESOURCE WHEEL <span>{dateLabel(day.day)}</span></div><div className="resource-wheel-body"><CapacityDial value={day.capacityHours} committed={day.committedHours} template={templateFor(day.day)} onChange={(value) => void onSetCapacity(day.day, value)} /><div className="resource-wheel-copy"><p className="eyebrow">RESOURCE LOGIC</p><h3>{hours(day.committedHours)} / {hours(day.capacityHours)}</h3><p>La roue ajuste la capacité réelle de la journée. Le moteur recalcule automatiquement ce qui rentre, ce qui est reporté, ce qui est tight/over.</p><div className="resource-presets"><button type="button" onClick={() => void onSetCapacity(day.day, 0)}>Bureau</button><button type="button" onClick={() => void onSetCapacity(day.day, 4)}>Demi</button><button type="button" onClick={() => void onSetCapacity(day.day, templateFor(day.day))}>Normale</button></div></div></div></article>;
  }

  function renderOverview() {
    return <div className="prod-overview prod-page-enter"><aside className="card glass project-sidebar"><div className="section-title">PROJECTS</div>{model.data.Projects.map((project, index) => { const taskCount = activeTasks.filter((task) => task.fields.project?.includes(project.id)).length; const active = project.id === selectedProject?.id; const status = text(project.fields.status, index === 0 ? 'ACTIVE' : 'ONGOING'); return <button key={project.id} className={`project-filter ${active ? 'active' : ''}`} onClick={() => setSelectedProjectId(project.id)} type="button"><span>{active ? '▶' : ' '}</span><b>{text(project.fields.name, `Project ${index + 1}`)}</b><i className={`dot ${status.toLowerCase().includes('over') ? 'amber' : active ? 'green' : 'gray'}`} /><small>{status} · {taskCount}</small></button>; })}<button className="new-link" type="button">+ New project</button></aside><section className="card glass week-timeline"><div className="section-title">WEEK OVERVIEW</div>{week.map((day) => { const ratio = Math.min(100, day.capacityHours ? (day.committedHours / day.capacityHours) * 100 : 0); const tasks = filteredDayTasks(day); return <article className={`timeline-day ${day.state}`} key={day.day}><button className="timeline-head" onClick={() => setExpandedDay(expandedDay === day.day ? '' : day.day)} type="button"><b>{dateLabel(day.day)}</b><span>{hours(day.committedHours)} / {hours(day.capacityHours)} <em className={`badge badge-${stateBadge(day.state)}`}>● {day.state}</em></span></button><div className="timeline-track"><i className="timeline-fill" style={{ width: `${ratio}%` }} /></div><div className="timeline-foot">[{tasks.length} tasks]</div>{expandedDay === day.day && <div className="timeline-drop">{tasks.length ? tasks.map((task) => <button key={task.id} onClick={() => setSelectedTaskId(task.id)} type="button">{task.fields.name}<span>{hours(estimate(task))}</span></button>) : <p>No tasks scheduled · + Add task</p>}</div>}</article>; })}</section><aside className="resource-side">{renderResourceWheel()}<section className="card glass kpi-sidebar"><div className="section-title">KPI LADDER <span>↗ 100K JAN</span></div>{monthTargets.map(([month, label, width], index) => <div className="kpi-row" key={month}><b>{month}</b><div><i style={{ width: `${width}%` }} /></div><span>{label}</span>{index === 0 && <em>◄ NOW</em>}</div>)}<div className="section-title metrics-title">KEY METRICS</div><dl className="metric-ladder"><dt>OFFERS SENT</dt><dd>0 ⚠</dd><dt>SIGNED</dt><dd>0</dd><dt>MRR</dt><dd>{money(0)}</dd><dt>BODY</dt><dd>91.2 → 90.0 KG ▼ 1.2</dd></dl></section></aside></div>;
  }

  function renderTaskRow(task: ApiRecord<TaskFields>) { const project = projectName(task.fields.project?.[0], model.data.Projects) ?? 'No project'; const done = isDone(task); return <article className={`task-row ${done ? 'done' : ''} ${selectedTaskId === task.id ? 'active' : ''}`} key={task.id} onClick={() => setSelectedTaskId(task.id)}><button className="task-check" onClick={(event) => { event.stopPropagation(); void completeTask(task); }} type="button">{done ? '✓' : '○'}</button><div className="task-main"><b>{task.fields.name}</b><span><em className="chip">{project}</em> · {hours(estimate(task))} · <i className={dueTone(task, today)}>Due {shortDate(task.fields.dueDate)}</i></span><small>{text(task.fields.status, 'NEXT')} · Priority: {text(task.fields.priority, 'MEDIUM')}</small></div><button className="pin-task" onClick={(event) => { event.stopPropagation(); void pinToday(task); }} type="button">⌖ TODAY</button><span className="open-arrow">↗ open</span></article>; }
  function renderTasks() { return <div className="prod-tasks prod-page-enter"><section className="card glass task-list-panel"><header className="table-head"><div><p className="eyebrow">TASKS</p><h2>Task management</h2></div><div><button type="button">+ New Task</button><button type="button">Filter ▾</button><button type="button">Sort ▾</button></div></header><div className="filter-bar"><button>All</button><button>Today</button><button>This week</button><button>Overdue</button><button>By project ▾</button></div><div className="task-table">{activeTasks.concat(model.data.Tasks.filter(isDone)).slice(0, 24).map(renderTaskRow)}</div></section>{renderTaskDetail()}</div>; }
  function renderTaskDetail() { return <><div className={`overlay-backdrop ${selectedTask ? 'active' : ''}`} onClick={() => setSelectedTaskId('')} /><aside className={`task-detail-overlay ${selectedTask ? 'open' : ''}`}>{selectedTask && <><header><button onClick={() => setSelectedTaskId('')} type="button">← BACK TO TASKS</button><span>[⋮ More]</span></header><p className="eyebrow">TASK DETAIL</p><input className="editable detail-title" defaultValue={text(selectedTask.fields.name)} onBlur={(event) => void updateTask(selectedTask, 'name', event.currentTarget.value)} /><div className="detail-grid"><label>PROJECT<select defaultValue={selectedTask.fields.project?.[0] ?? ''} onChange={(event) => void updateTask(selectedTask, 'project', event.currentTarget.value ? [event.currentTarget.value] : [])}>{model.data.Projects.map((project) => <option key={project.id} value={project.id}>{text(project.fields.name)}</option>)}</select></label><label>STATUS<input defaultValue={text(selectedTask.fields.status, 'NEXT')} onBlur={(event) => void updateTask(selectedTask, 'status', event.currentTarget.value)} /></label><label>PRIORITY<input defaultValue={text(selectedTask.fields.priority, 'MEDIUM')} onBlur={(event) => void updateTask(selectedTask, 'priority', event.currentTarget.value)} /></label><label>DUE DATE<input type="date" defaultValue={selectedTask.fields.dueDate ?? ''} onBlur={(event) => void updateTask(selectedTask, 'dueDate', event.currentTarget.value)} /></label><label>ESTIMATE<input defaultValue={String(estimate(selectedTask))} onBlur={(event) => void updateTask(selectedTask, 'estimatedHours', Number(event.currentTarget.value))} /></label><label>ACTUAL<input defaultValue={String(logged(selectedTask))} onBlur={(event) => void updateTask(selectedTask, 'loggedHours', Number(event.currentTarget.value))} /></label></div><div className="detail-section"><h3>NOTES</h3><textarea className="editable" defaultValue={text(selectedTask.fields.notes, '')} onBlur={(event) => void updateTask(selectedTask, 'notes', event.currentTarget.value)} /><button type="button">+ Add note</button></div><div className="detail-section"><h3>SUBTASKS</h3><p>○ Set up email trigger automation</p><p>✓ Configure record creation flow</p><p>○ Test with real data</p><button type="button">+ Add subtask</button></div><div className="detail-section activity"><h3>ACTIVITY LOG</h3><p>14:22 Status changed: TODO → IN PROGRESS</p><p>13:45 Estimate updated</p><p>Aug 14 Task created</p></div><div className="save-indicator">{saving ? 'Saving…' : 'Saved ✓'}</div></>}</aside></>; }
  function renderProjects() { const opened = model.data.Projects.find((project) => project.id === expandedProjectId); if (opened) { const tasks = model.data.Tasks.filter((task) => task.fields.project?.includes(opened.id)); const doneCount = tasks.filter(isDone).length; return <section className="project-detail prod-page-enter card glass"><button className="back-link" onClick={() => setExpandedProjectId('')} type="button">← PROJECTS</button><h2>{text(opened.fields.name)}</h2><span>CLIENT · PHASE 2 · {text(opened.fields.status, 'ACTIVE')}</span><h3>PHASES</h3>{model.data.Phases.filter((phase) => tasks.some((task) => task.fields.phase?.includes(phase.id))).slice(0, 4).map((phase, index) => <article className="phase-line" key={phase.id}><b>{index === 0 ? '✓' : index === 1 ? '●' : '○'} {text(phase.fields.name)}</b><span>{index === 0 ? 'COMPLETE' : index === 1 ? 'IN PROGRESS' : 'UPCOMING'}</span></article>)}<h3>PHASE 2 TASKS</h3>{tasks.slice(0, 12).map((task) => <article className={`phase-task-line ${isDone(task) ? 'done' : 'active'}`} key={task.id}><b>{isDone(task) ? '✓' : '○'} {task.fields.name}</b><span>{hours(estimate(task))} · {text(task.fields.status, 'Next')}</span></article>)}<p>{doneCount}/{tasks.length} complete</p></section>; } return <section className="prod-projects prod-page-enter"><header className="table-head"><div><p className="eyebrow">PROJECTS</p><h2>Project cards + phases</h2></div><button type="button">+ New Project</button></header><div className="project-card-grid">{model.data.Projects.map((project, index) => { const tasks = model.data.Tasks.filter((task) => task.fields.project?.includes(project.id)); const doneCount = tasks.filter(isDone).length; const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0; return <article className="project-card card glass" key={project.id}><header><h3>{text(project.fields.name)}</h3><span>{index === 0 ? '●' : pct === 0 ? '⚠' : '○'}</span></header><small>CLIENT PROJECT</small><p>{pct ? `Phase 2 / Week 3 / 4` : 'OVERDUE -12d'}</p><div className="progress-track"><i className="progress-fill" style={{ width: `${pct}%` }} /></div><b>{pct}% complete</b><span>{tasks.filter((task) => !isDone(task)).length} tasks open</span><span>Next: {tasks.find((task) => !isDone(task))?.fields.name ?? 'Client handoff'}</span><button onClick={() => setExpandedProjectId(project.id)} type="button">OPEN PROJECT →</button></article>; })}</div></section>; }
  function renderGantt() { return <section className="prod-gantt prod-page-enter card glass"><header className="table-head"><div><p className="eyebrow">GANTT</p><h2>Timeline view</h2></div><div><button>Week ▾</button><button>Aug 2026 ▾</button><button>← →</button></div></header><div className="gantt-chart"><div className="gantt-row gantt-head"><b />{week.map((day) => <span key={day.day}>{dateLabel(day.day).replace(' AUG', '')}</span>)}</div>{model.data.Projects.slice(0, 6).map((project) => { const tasks = model.data.Tasks.filter((task) => task.fields.project?.includes(project.id)).slice(0, 4); return <div className="gantt-project" key={project.id}><div className="gantt-row project-label"><b>{text(project.fields.name).toUpperCase()}</b>{week.map((day) => <span className={day.day === today ? 'today-col' : ''} key={day.day} />)}</div>{tasks.map((task, index) => <div className="gantt-row" key={task.id}><b>{text(task.fields.name).slice(0, 18)}</b>{week.map((day, dayIndex) => <span className={day.day === today ? 'today-col' : ''} key={day.day}>{dayIndex === index || day.day === task.fields.pinnedDay ? <button className={`gantt-bar ${dueTone(task, today)}`} onClick={() => setSelectedTaskId(task.id)} type="button" /> : null}</span>)}</div>)}</div>; })}</div><p className="gantt-note">▲ TODAY · drag to reschedule coming soon</p>{renderTaskDetail()}</section>; }
  function renderCockpit() { const elapsed = focusTask ? logged(focusTask) : 0; const est = focusTask ? estimate(focusTask) : 1; const pct = Math.min(100, Math.round((elapsed / Math.max(est, 0.25)) * 100)); const upcoming = model.current.items.map((item) => taskById[item.taskId]).filter(Boolean).slice(1, 4) as ApiRecord<TaskFields>[]; return <section className="prod-cockpit prod-page-enter"><header className="cockpit-title"><h2>TODAY · {dateLabel(today)}</h2><span>{hours(model.current.committedHours)} / {hours(model.current.capacityHours)} committed · {model.current.items.length} tasks · {model.current.state.toUpperCase()}</span></header><div className="cockpit-grid"><div>{renderResourceWheel(model.current)}</div><article className="card glass current-focus"><p className="eyebrow">CURRENT FOCUS</p>{focusTask ? <><h3>▶ {focusTask.fields.name}</h3><span>[{projectName(focusTask.fields.project?.[0], model.data.Projects) ?? 'No project'}] {hours(est)} est · {hours(elapsed)} elapsed</span><div className="progress-track big"><i className="progress-fill" style={{ width: `${pct}%` }} /></div><div className="focus-actions"><button onClick={() => void completeTask(focusTask)} type="button">● MARK COMPLETE</button><button onClick={() => void pinToday(focusTask)} type="button">⌖ PIN TODAY</button><button onClick={() => setSelectedTaskId(focusTask.id)} type="button">✎ EDIT</button></div></> : <p>No tasks scheduled · + Add task</p>}</article></div><article className="card glass next-stack"><p className="eyebrow">UP NEXT</p>{upcoming.map((task) => <div key={task.id}>{task.fields.name}<span>[{projectName(task.fields.project?.[0], model.data.Projects) ?? 'Project'}] {hours(estimate(task))} est</span></div>)}</article><article className="card glass tomorrow-preview"><p className="eyebrow">TOMORROW PREVIEW <span>{tomorrow ? `${hours(tomorrow.committedHours)} / ${hours(tomorrow.capacityHours)}` : ''}</span></p>{tomorrow && dayTasks(tomorrow).slice(0, 6).map((task) => <div key={task.id}>{task.fields.name}</div>)}</article>{renderTaskDetail()}</section>; }
  function renderResources() { return <section className="resources-page prod-page-enter"><header className="table-head"><div><p className="eyebrow">RESOURCE LOGIC</p><h2>Dynamic capacity controls</h2><span>{hours(total)} engagées / {hours(available)} disponibles cette semaine</span></div></header><div className="resource-grid">{week.map((day) => <article className="card glass resource-day" key={day.day}><div className="section-title">{dateLabel(day.day)} <span>{day.state.toUpperCase()}</span></div><CapacityDial value={day.capacityHours} committed={day.committedHours} template={templateFor(day.day)} size="md" onChange={(value) => void onSetCapacity(day.day, value)} /><strong>{hours(day.committedHours)} / {hours(day.capacityHours)}</strong><small>{day.items.length} tasks · template {hours(templateFor(day.day))}</small><div className="resource-presets"><button type="button" onClick={() => void onSetCapacity(day.day, 0)}>Bureau</button><button type="button" onClick={() => void onSetCapacity(day.day, 4)}>Demi</button><button type="button" onClick={() => void onSetCapacity(day.day, templateFor(day.day))}>Normale</button></div></article>)}</div></section>; }

  return <section id="section-productivity" className="cadence-screen os-screen cadence-productivity"><nav className="prod-subnav" aria-label="Productivity pages">{pages.map((item) => <button key={item.id} className={`prod-subnav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)} type="button">{item.label}</button>)}</nav><div className="prod-page">{renderHero()}{error && <div className="alert-line">CADENCE LINK ERROR — {error}</div>}{page === 'overview' && renderOverview()}{page === 'tasks' && renderTasks()}{page === 'projects' && renderProjects()}{page === 'gantt' && renderGantt()}{page === 'cockpit' && renderCockpit()}{page === 'resources' && renderResources()}</div>{toast && <div className="toast-container"><div className="toast">{toast}</div></div>}</section>;
}
