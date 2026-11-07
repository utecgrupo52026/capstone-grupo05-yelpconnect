const nf = new Intl.NumberFormat('es-PE');
const nf1 = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });

export const num = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v)} %`);
export const dec = (v: number | null | undefined, d = 3) =>
  v == null ? '—' : new Intl.NumberFormat('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
/** 'YYYY-MM-DD' → '29 dic.' (hora local fija, para que la zona horaria no cambie el día). */
export const diaCorto = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
/** Diferencia en puntos porcentuales con signo: +1,2 pp. */
export const pp = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf1.format(Math.abs(v))} pp`;

/** Escapa texto que se inyecta en tooltips HTML de ECharts. */
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
