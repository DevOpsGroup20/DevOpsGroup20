// Types
type BookingStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

interface BookingRecord {
  id: string;
  bookingStatus: BookingStatus | 'CREATING';
  startTime: number;
  endTime?: number;
  pollCount: number;
  reservationId?: string;
  paymentConfirmationId?: string;
  ticketId?: string;
  createdAt?: string;
  updatedAt?: string;
  backendMs?: number;
  lastResponse?: Record<string, unknown>;
  error?: string;
}

interface BurstGroup {
  groupId: string;
  bookings: Map<string, BookingRecord>;
  target: number;
  startTime: number;
  expanded: boolean;
}

type FailureMode =
  | { kind: 'none' }
  | { kind: 'force'; step: string }
  | { kind: 'probability'; none: number; seats: number; payment: number; ticket: number };

// API layer
async function apiCreateBooking(baseUrl: string, simulate?: string): Promise<string> {
  const body = simulate ? JSON.stringify({ simulateBookingFailure: simulate }) : undefined;
  const res = await fetch(`${baseUrl}/ticket`, {
    method: 'PUT',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body,
  });
  if (!res.ok) throw new Error(`PUT /ticket ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  const id = (data['bookingReferenceId'] ?? data['bookingReferenceID']) as string | undefined;
  if (!id) throw new Error('No booking ID in response');
  return id;
}

async function apiGetBookingStatus(baseUrl: string, id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/booking/${id}`);
  if (!res.ok) throw new Error(`GET /booking/${id} ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// Per-booking polling loop
function startPolling(
  baseUrl: string,
  id: string,
  initialDelay: number,
  pollInterval: number,
  signal: { stopped: boolean },
  onUpdate: (update: Partial<BookingRecord> & { id: string }) => void,
): void {
  (async () => {
    await sleep(initialDelay);
    let pollCount = 0;
    while (!signal.stopped) {
      try {
        const data = await apiGetBookingStatus(baseUrl, id);
        pollCount++;
        const status = data['bookingStatus'] as BookingStatus;
        const isTerminal = status === 'COMPLETED' || status === 'FAILED';
        const createdAt  = data['createdAt'] as string | undefined;
        const updatedAt  = data['updatedAt'] as string | undefined;
        const update: Partial<BookingRecord> & { id: string } = {
          id,
          bookingStatus: status,
          pollCount,
          reservationId:         data['reservationId'] as string | undefined,
          paymentConfirmationId: data['paymentConfirmationId'] as string | undefined,
          ticketId:              data['ticketId'] as string | undefined,
          createdAt,
          updatedAt,
        };
        if (isTerminal) {
          update.endTime  = Date.now();
          update.lastResponse = data;
          if (createdAt && updatedAt) {
            update.backendMs = new Date(updatedAt).getTime() - new Date(createdAt).getTime();
          }
        }
        onUpdate(update);
        if (isTerminal) break;
      } catch (_err) {
        // transient — keep retrying
      }
      await sleep(pollInterval);
    }
  })();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

// Probability slider — 3 draggable knobs dividing a track into 4 segments
const SEG_COLORS = ['#2dd4bf', '#f59e0b', '#f87171', '#a78bfa'];
const SEG_LABELS = ['Success', 'Seats', 'Payment', 'Ticket'];
const MIN_GAP = 1; // minimum 1% per segment

class ProbabilitySlider {
  private track: HTMLElement;
  private segments: HTMLElement[] = [];
  private segLabels: HTMLElement[] = [];
  private knobEls: HTMLElement[] = [];
  private knobs: [number, number, number] = [70, 80, 90];
  private dragging: number | null = null;
  private dragOriginX = 0;
  private dragOriginKnob = 0;

  constructor(container: HTMLElement) {
    this.track = document.createElement('div');
    this.track.className = 'prob-track';

    for (let i = 0; i < 4; i++) {
      const seg = document.createElement('div');
      seg.className = 'prob-segment';
      (seg.style as CSSStyleDeclaration).background = SEG_COLORS[i];
      const lbl = document.createElement('span');
      lbl.className = 'seg-label';
      seg.appendChild(lbl);
      this.segments.push(seg);
      this.segLabels.push(lbl);
      this.track.appendChild(seg);
    }

    for (let i = 0; i < 3; i++) {
      const knob = document.createElement('div');
      knob.className = 'prob-knob';
      const idx = i;
      knob.addEventListener('mousedown',  e => this.startDrag(idx, e.clientX, e));
      knob.addEventListener('touchstart', e => this.startDrag(idx, e.touches[0].clientX, e), { passive: false });
      this.knobEls.push(knob);
      this.track.appendChild(knob);
    }

    document.addEventListener('mousemove',  e => { if (this.dragging !== null) this.moveDrag(e.clientX); });
    document.addEventListener('mouseup',    () => this.stopDrag());
    document.addEventListener('touchmove',  e => { if (this.dragging !== null) { e.preventDefault(); this.moveDrag(e.touches[0].clientX); } }, { passive: false });
    document.addEventListener('touchend',   () => this.stopDrag());

    container.appendChild(this.track);
    this.render();
  }

  /** Returns [none%, seats%, payment%, ticket%] — always sums to 100 */
  getProbs(): [number, number, number, number] {
    const [k0, k1, k2] = this.knobs;
    return [k0, k1 - k0, k2 - k1, 100 - k2];
  }

  private startDrag(idx: number, clientX: number, e: Event): void {
    e.preventDefault();
    this.dragging = idx;
    this.dragOriginX    = clientX;
    this.dragOriginKnob = this.knobs[idx];
    this.knobEls[idx].classList.add('dragging');
  }

  private moveDrag(clientX: number): void {
    const idx   = this.dragging!;
    const rect  = this.track.getBoundingClientRect();
    const newPct = Math.round(((clientX - rect.left) / rect.width) * 100);
    const lo    = idx === 0 ? MIN_GAP           : this.knobs[idx - 1] + MIN_GAP;
    const hi    = idx === 2 ? 100 - MIN_GAP     : this.knobs[idx + 1] - MIN_GAP;
    this.knobs[idx] = Math.max(lo, Math.min(hi, newPct));
    this.render();
  }

  private stopDrag(): void {
    if (this.dragging !== null) {
      this.knobEls[this.dragging].classList.remove('dragging');
      this.dragging = null;
    }
  }

  private render(): void {
    const [k0, k1, k2] = this.knobs;
    const bounds = [0, k0, k1, k2, 100];
    for (let i = 0; i < 4; i++) {
      const left  = bounds[i];
      const width = bounds[i + 1] - bounds[i];
      this.segments[i].style.left  = `${left}%`;
      this.segments[i].style.width = `${width}%`;
      this.segLabels[i].textContent =
        width >= 12 ? `${SEG_LABELS[i]} ${width}%` :
        width >= 5  ? `${width}%` : '';
    }
    for (let i = 0; i < 3; i++) {
      this.knobEls[i].style.left = `${this.knobs[i]}%`;
    }
  }
}

function sampleFailure(mode: FailureMode): string | undefined {
  if (mode.kind === 'none') return undefined;
  if (mode.kind === 'force') return mode.step;
  const total = mode.none + mode.seats + mode.payment + mode.ticket;
  if (total <= 0) return undefined;
  let r = Math.random() * total;
  for (const [key, val] of [['none', mode.none], ['seats', mode.seats], ['payment', mode.payment], ['ticket', mode.ticket]] as [string, number][]) {
    r -= val;
    if (r < 0) return key === 'none' ? undefined : key;
  }
  return undefined;
}

// App
class App {
  private baseUrl = '/api';

  // DOM
  private elFailureEnabled: HTMLInputElement;
  private elFailurePanel: HTMLElement;
  private elFailureForceRadio: HTMLInputElement;
  private elFailureProbRadio: HTMLInputElement;
  private elFailureForceSelect: HTMLSelectElement;
  private elProbPanel: HTMLElement;
  private probSlider!: ProbabilitySlider;
  private elInitialDelay: HTMLInputElement;
  private elPollInterval: HTMLInputElement;
  private elBtnGo: HTMLButtonElement;
  private elEntries: HTMLElement;
  private sizeBtns: NodeListOf<HTMLButtonElement>;

  // State
  private selectedSize = 1;
  private singleRecords = new Map<string, BookingRecord>();
  private burstGroups   = new Map<string, BurstGroup>();
  private entryIds: string[] = [];
  private bookingToGroup = new Map<string, string>();
  private pollSignals    = new Map<string, { stopped: boolean }>();
  private rafScheduled   = false;
  private pendingRenders = new Set<string>();

  constructor() {
    this.elFailureEnabled    = document.getElementById('failure-enabled')    as HTMLInputElement;
    this.elFailurePanel      = document.getElementById('failure-panel')      as HTMLElement;
    this.elFailureForceRadio = document.getElementById('failure-force-radio') as HTMLInputElement;
    this.elFailureProbRadio  = document.getElementById('failure-prob-radio')  as HTMLInputElement;
    this.elFailureForceSelect= document.getElementById('failure-force-select') as HTMLSelectElement;
    this.elProbPanel         = document.getElementById('prob-panel')          as HTMLElement;
    this.probSlider          = new ProbabilitySlider(document.getElementById('prob-slider') as HTMLElement);
    this.elInitialDelay      = document.getElementById('initial-delay')       as HTMLInputElement;
    this.elPollInterval      = document.getElementById('poll-interval')       as HTMLInputElement;
    this.elBtnGo             = document.getElementById('btn-go')              as HTMLButtonElement;
    this.elEntries           = document.getElementById('entries')             as HTMLElement;
    this.sizeBtns            = document.querySelectorAll<HTMLButtonElement>('.btn-size');

    this.elFailureEnabled.addEventListener('change', () => this.onFailureToggle());
    this.elFailureForceRadio.addEventListener('change', () => this.onModeChange());
    this.elFailureProbRadio.addEventListener('change',  () => this.onModeChange());

    this.sizeBtns.forEach(btn => btn.addEventListener('click', () => {
      this.selectedSize = parseInt(btn.dataset['size'] ?? '1');
      this.sizeBtns.forEach(b => b.classList.toggle('active', b === btn));
      this.elBtnGo.textContent = this.selectedSize === 1 ? 'Book' : `Burst ×${this.selectedSize}`;
    }));

    this.elBtnGo.addEventListener('click', () => this.go());
  }

  private getInitialDelay() { return Math.max(0,  parseInt(this.elInitialDelay.value) || 50); }
  private getPollInterval()  { return Math.max(10, parseInt(this.elPollInterval.value) || 25); }

  private getFailureMode(): FailureMode {
    if (!this.elFailureEnabled.checked) return { kind: 'none' };
    if (this.elFailureProbRadio.checked) {
      const [none, seats, payment, ticket] = this.probSlider.getProbs();
      return { kind: 'probability', none, seats, payment, ticket };
    }
    return { kind: 'force', step: this.elFailureForceSelect.value };
  }

  private onFailureToggle() {
    this.elFailurePanel.classList.toggle('hidden', !this.elFailureEnabled.checked);
  }

  private onModeChange() {
    this.elProbPanel.classList.toggle('hidden', !this.elFailureProbRadio.checked);
  }

  // --- Dispatch ---
  async go(): Promise<void> {
    this.elBtnGo.disabled = true;
    try {
      if (this.selectedSize === 1) await this.doSingle();
      else await this.doBurst(this.selectedSize);
    } finally {
      this.elBtnGo.disabled = false;
    }
  }

  private async doSingle(): Promise<void> {
    const mode    = this.getFailureMode();
    const simulate = sampleFailure(mode);
    const tempId  = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: BookingRecord = { id: tempId, bookingStatus: 'CREATING', startTime: Date.now(), pollCount: 0 };
    this.singleRecords.set(tempId, record);
    this.prependEntry(tempId);
    this.renderEntry(tempId);

    try {
      const id = await apiCreateBooking(this.baseUrl, simulate);
      this.singleRecords.delete(tempId);
      this.singleRecords.set(id, { ...record, id, bookingStatus: 'PENDING' });
      this.replaceEntryId(tempId, id);
      this.renderEntry(id);
      const signal = { stopped: false };
      this.pollSignals.set(id, signal);
      startPolling(this.baseUrl, id, this.getInitialDelay(), this.getPollInterval(), signal,
        upd => { this.onSingleUpdate(upd); });
    } catch (err) {
      record.bookingStatus = 'FAILED';
      record.endTime = Date.now();
      record.error = String(err);
      this.renderEntry(tempId);
    }
  }

  private onSingleUpdate(upd: Partial<BookingRecord> & { id: string }): void {
    const r = this.singleRecords.get(upd.id);
    if (!r) return;
    Object.assign(r, upd);
    this.scheduleRaf(upd.id);
  }

  private async doBurst(count: number): Promise<void> {
    const mode     = this.getFailureMode();
    const groupId  = `burst-${Date.now()}`;
    const group: BurstGroup = {
      groupId, bookings: new Map(), target: count, startTime: Date.now(), expanded: false,
    };
    this.burstGroups.set(groupId, group);
    this.prependEntry(groupId);
    this.renderEntry(groupId);

    await Promise.all(Array.from({ length: count }, async () => {
      const simulate = sampleFailure(mode);
      const tempId   = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      group.bookings.set(tempId, { id: tempId, bookingStatus: 'CREATING', startTime: Date.now(), pollCount: 0 });
      this.bookingToGroup.set(tempId, groupId);
      this.scheduleRaf(groupId);

      try {
        const id = await apiCreateBooking(this.baseUrl, simulate);
        group.bookings.delete(tempId);
        this.bookingToGroup.delete(tempId);
        group.bookings.set(id, { id, bookingStatus: 'PENDING', startTime: Date.now(), pollCount: 0 });
        this.bookingToGroup.set(id, groupId);
        this.scheduleRaf(groupId);
        const signal = { stopped: false };
        this.pollSignals.set(id, signal);
        startPolling(this.baseUrl, id, this.getInitialDelay(), this.getPollInterval(), signal,
          upd => { this.onBurstUpdate(groupId, upd); });
      } catch (_err) {
        const r = group.bookings.get(tempId);
        if (r) { r.bookingStatus = 'FAILED'; r.endTime = Date.now(); }
        this.scheduleRaf(groupId);
      }
    }));
  }

  private onBurstUpdate(groupId: string, upd: Partial<BookingRecord> & { id: string }): void {
    const group = this.burstGroups.get(groupId);
    if (!group) return;
    const r = group.bookings.get(upd.id);
    if (!r) return;
    Object.assign(r, upd);
    this.scheduleRaf(groupId);
  }

  // --- Entry management ---
  private prependEntry(id: string): void {
    this.entryIds.unshift(id);
  }

  private replaceEntryId(oldId: string, newId: string): void {
    const idx = this.entryIds.indexOf(oldId);
    if (idx !== -1) this.entryIds[idx] = newId;
    const el = document.getElementById(`entry-${oldId}`);
    if (el) el.id = `entry-${newId}`;
  }

  private scheduleRaf(entryId: string): void {
    this.pendingRenders.add(entryId);
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      const ids = [...this.pendingRenders];
      this.pendingRenders.clear();
      for (const id of ids) this.renderEntry(id);
    });
  }

  private renderEntry(id: string): void {
    const isBurst = this.burstGroups.has(id);
    const html    = isBurst ? this.burstGroupHtml(id) : this.singleCardHtml(id);
    if (!html) return;

    let el = document.getElementById(`entry-${id}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `entry-${id}`;
      const idx   = this.entryIds.indexOf(id);
      const refId = this.entryIds[idx + 1];
      const refEl = refId ? document.getElementById(`entry-${refId}`) : null;
      if (refEl) this.elEntries.insertBefore(el, refEl);
      else this.elEntries.prepend(el);
    }
    el.innerHTML = html;

    if (isBurst) {
      el.querySelector('.burst-toggle')?.addEventListener('click', () => {
        const g = this.burstGroups.get(id);
        if (g) { g.expanded = !g.expanded; this.renderEntry(id); }
      });
    }
  }

  // --- HTML renderers ---
  private singleCardHtml(id: string): string {
    const r = this.singleRecords.get(id);
    if (!r) return '';
    const s = r.bookingStatus;
    const isTerminal = s === 'COMPLETED' || s === 'FAILED';

    const seats   = r.reservationId        ? 'done' : s === 'FAILED' && !r.reservationId ? 'failed' : s === 'PENDING' ? 'active' : 'idle';
    const payment = r.paymentConfirmationId ? 'done' : s === 'FAILED' && r.reservationId && !r.paymentConfirmationId ? 'failed' : r.reservationId && s === 'PENDING' ? 'active' : 'idle';
    const ticket  = r.ticketId             ? 'done' : s === 'FAILED' && r.paymentConfirmationId && !r.ticketId ? 'failed' : r.paymentConfirmationId && s === 'PENDING' ? 'active' : 'idle';
    const icon    = (st: string) => st === 'done' ? '✓' : st === 'active' ? '⟳' : st === 'failed' ? '✗' : '—';

    const clientMs   = isTerminal && r.endTime ? r.endTime - r.startTime : null;
    const overheadMs = clientMs !== null && r.backendMs !== undefined ? clientMs - r.backendMs : null;

    return `
    <div class="booking-card status-${s}">
      <div class="booking-card-header">
        <span class="booking-id">${r.id}</span>
        <span class="status-badge ${s}">${s}</span>
      </div>
      <div class="workflow">
        <div class="step"><div class="step-icon ${seats}">${icon(seats)}</div><span class="step-label">Seats</span></div>
        <span class="step-arrow">→</span>
        <div class="step"><div class="step-icon ${payment}">${icon(payment)}</div><span class="step-label">Payment</span></div>
        <span class="step-arrow">→</span>
        <div class="step"><div class="step-icon ${ticket}">${icon(ticket)}</div><span class="step-label">Ticket</span></div>
      </div>
      <div class="metrics">
        ${r.backendMs !== undefined ? `<span>Backend <span class="metric-val ${s === 'COMPLETED' ? 'success' : 'failure'}">${fmtMs(r.backendMs)}</span></span>` : ''}
        ${clientMs !== null         ? `<span>Client <span class="metric-val">${fmtMs(clientMs)}</span></span>` : ''}
        ${overheadMs !== null       ? `<span>Poll overhead <span class="metric-val muted">${fmtMs(overheadMs)}</span></span>` : ''}
        <span>Polls <span class="metric-val muted">${r.pollCount}</span></span>
        ${r.error ? `<span style="color:var(--failure)">${r.error}</span>` : ''}
      </div>
      ${r.lastResponse ? `
      <details class="response-details">
        <summary>Raw response</summary>
        <pre class="response-pre">${JSON.stringify(r.lastResponse, null, 2)}</pre>
      </details>` : ''}
    </div>`;
  }

  private burstGroupHtml(groupId: string): string {
    const group = this.burstGroups.get(groupId);
    if (!group) return '';
    const all       = Array.from(group.bookings.values());
    const completed = all.filter(r => r.bookingStatus === 'COMPLETED');
    const failed    = all.filter(r => r.bookingStatus === 'FAILED');
    const terminal  = all.filter(r => r.endTime !== undefined);
    const done      = completed.length + failed.length;
    const progress  = Math.round((done / group.target) * 100);
    const allDone   = done === group.target;

    const bkMs = terminal.filter(r => r.backendMs !== undefined).map(r => r.backendMs!).sort((a, b) => a - b);
    const avgBackend = bkMs.length ? Math.round(bkMs.reduce((s, v) => s + v, 0) / bkMs.length) : null;
    const p95Backend = bkMs.length ? pct(bkMs, 0.95) : null;

    const clMs = terminal.map(r => r.endTime! - r.startTime).sort((a, b) => a - b);
    const avgClient = clMs.length ? Math.round(clMs.reduce((s, v) => s + v, 0) / clMs.length) : null;

    const detailsHtml = group.expanded ? `
      <div class="burst-details">
        ${all.sort((a, b) => a.startTime - b.startTime).map(r => {
          const isTerminal = r.bookingStatus === 'COMPLETED' || r.bookingStatus === 'FAILED';
          const statCls    = r.bookingStatus === 'COMPLETED' ? 'success' : r.bookingStatus === 'FAILED' ? 'failure' : '';
          return `<div class="burst-item">
            <div class="burst-row">
              <div class="status-dot ${r.bookingStatus}"></div>
              <span class="row-id">${r.id}</span>
              ${r.backendMs !== undefined ? `<span class="row-stat ${statCls}">${fmtMs(r.backendMs)}</span>` : ''}
              ${isTerminal && r.endTime ? `<span class="row-stat muted">${fmtMs(r.endTime - r.startTime)} client</span>` : ''}
              <span class="row-stat muted">${r.pollCount}p</span>
            </div>
            ${r.lastResponse ? `
            <details class="response-details">
              <summary>Raw response</summary>
              <pre class="response-pre">${JSON.stringify(r.lastResponse, null, 2)}</pre>
            </details>` : ''}
          </div>`;
        }).join('')}
      </div>` : '';

    return `
    <div class="burst-card${allDone ? ' done' : ''}">
      <div class="burst-header">
        <span class="burst-title">BURST × ${group.target}</span>
        <span class="status-badge ${allDone ? (failed.length === group.target ? 'FAILED' : 'COMPLETED') : 'PENDING'}">${done} / ${group.target}</span>
      </div>
      <div class="burst-progress-wrap">
        <div class="burst-progress-bar" style="width:${progress}%"></div>
      </div>
      <div class="burst-stats">
        <span>✓ <span class="metric-val" style="color:var(--success)">${completed.length}</span></span>
        <span>✗ <span class="metric-val" style="color:var(--failure)">${failed.length}</span></span>
        ${avgBackend !== null ? `<span>Avg backend <span class="metric-val">${fmtMs(avgBackend)}</span></span>` : ''}
        ${p95Backend !== null ? `<span>P95 backend <span class="metric-val">${fmtMs(p95Backend)}</span></span>` : ''}
        ${avgClient  !== null ? `<span>Avg client <span class="metric-val muted">${fmtMs(avgClient)}</span></span>` : ''}
      </div>
      <button class="burst-toggle">${group.expanded ? '▾ Hide bookings' : '▸ Show bookings'}</button>
      ${detailsHtml}
    </div>`;
  }
}

new App();
