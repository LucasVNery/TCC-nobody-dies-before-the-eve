// DOM analysis panel. The only DOM-touching file of the analysis HUD; the DOM is touched only in
// constructor / render / setVisible / destroy. Pure helpers (RefreshGate, needsRebuild) are unit-tested.
import { diffView, type AnalysisView, type ViewSection } from './analysisViewModel';

/** Throttle: never due while hidden, at most once per interval while visible. */
export class RefreshGate {
  private last = Number.NEGATIVE_INFINITY;
  constructor(private readonly intervalMs = 100) {}
  due(nowMs: number, visible: boolean): boolean {
    if (!visible) return false;
    if (nowMs - this.last < this.intervalMs) return false;
    this.last = nowMs;
    return true;
  }
}

/** diffView only reports changed cells, so a changed column list or ordered row-id list needs a DOM rebuild. */
export function needsRebuild(prev: ViewSection | null, next: ViewSection): boolean {
  if (prev === null) return true;
  if (prev.columns.length !== next.columns.length || prev.rows.length !== next.rows.length) return true;
  if (prev.columns.some((c, i) => c !== next.columns[i])) return true;
  return prev.rows.some((r, i) => r.id !== next.rows[i].id);
}

const COLUMN_LAYOUT: ViewSection['id'][][] = [
  ['inputs', 'events'],
  ['metrics'],
  ['profile', 'registry', 'predictor', 'perf'],
];

const CSS = `
.analysis-panel{position:fixed;top:0;left:0;right:0;bottom:0;display:none;grid-template-columns:1fr 1.6fr 1.2fr;gap:8px;
padding:8px;overflow:hidden;box-sizing:border-box;pointer-events:none;z-index:1000;
font:11px/1.3 ui-monospace,Consolas,Menlo,monospace;color:#d8e6d8;background:rgba(8,12,16,0.82)}
.analysis-panel.visible{display:grid}
.analysis-panel .ap-col{overflow:hidden;min-width:0}
.analysis-panel h3{margin:6px 0 2px;font-size:11px;color:#8fd3ff;text-transform:uppercase}
.analysis-panel table{border-collapse:collapse;width:100%}
.analysis-panel th{text-align:left;color:#8a9a8a;font-weight:normal;border-bottom:1px solid #345}
.analysis-panel td,.analysis-panel th{padding:0 4px;white-space:pre-wrap;word-break:break-all;vertical-align:top}
`;

export class AnalysisPanel {
  private readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly cells = new Map<string, HTMLTableCellElement[]>();
  private readonly holders = new Map<string, HTMLElement>();
  private prev: AnalysisView | null = null;
  private shown = false;

  constructor(parent: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = document.createElement('div');
    this.root.className = 'analysis-panel';
    for (const ids of COLUMN_LAYOUT) {
      const col = document.createElement('div');
      col.className = 'ap-col';
      for (const id of ids) {
        const holder = document.createElement('section');
        this.holders.set(id, holder);
        col.appendChild(holder);
      }
      this.root.appendChild(col);
    }
    parent.appendChild(this.root);
  }

  get visible(): boolean { return this.shown; }

  setVisible(v: boolean): void {
    this.shown = v;
    this.root.classList.toggle('visible', v);
  }

  toggle(): void { this.setVisible(!this.shown); }

  render(view: AnalysisView): void {
    const rebuilt = new Set<string>();
    for (const sec of view) {
      const before = this.prev?.find((s) => s.id === sec.id) ?? null;
      if (needsRebuild(before, sec)) {
        this.build(sec);
        rebuilt.add(sec.id);
      }
    }
    // A rebuilt section's cells already hold final text; skip patching them.
    for (const p of diffView(this.prev, view)) {
      if (rebuilt.has(p.sectionId)) continue;
      const cell = this.cells.get(`${p.sectionId}|${p.rowId}`)?.[p.cell];
      if (cell && cell.textContent !== p.text) cell.textContent = p.text;
    }
    this.prev = view;
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
    this.cells.clear();
    this.holders.clear();
    this.prev = null;
  }

  private build(sec: ViewSection): void {
    const holder = this.holders.get(sec.id);
    if (!holder) return;
    for (const key of [...this.cells.keys()]) if (key.startsWith(`${sec.id}|`)) this.cells.delete(key);
    holder.textContent = '';
    const h = document.createElement('h3');
    h.textContent = sec.title;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const c of sec.columns) {
      const th = document.createElement('th');
      th.textContent = c;
      head.appendChild(th);
    }
    const body = table.createTBody();
    for (const row of sec.rows) {
      const tr = body.insertRow();
      const tds = row.cells.map((text) => {
        const td = tr.insertCell();
        td.textContent = text;
        return td;
      });
      this.cells.set(`${sec.id}|${row.id}`, tds);
    }
    holder.append(h, table);
  }
}
