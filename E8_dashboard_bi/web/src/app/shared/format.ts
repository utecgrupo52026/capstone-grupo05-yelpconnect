const nf = new Intl.NumberFormat('es-PE');
const nf1 = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });

export const num = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v)} %`);
export const dec = (v: number | null | undefined, d = 3) =>
  v == null ? '—' : new Intl.NumberFormat('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Escapa texto que se inyecta en tooltips HTML de ECharts. */
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
