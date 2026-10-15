import { computed, signal } from '@angular/core';

/**
 * Tokens de color (paleta de referencia validada para daltonismo, modo claro y oscuro).
 * Los valores viven en styles.scss como variables CSS; aquí se leen para ECharts.
 */
const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
const oscuro = signal(media?.matches ?? false);
media?.addEventListener('change', (e) => oscuro.set(e.matches));

const leer = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export interface Tema {
  serie: string[];      // categórica, orden fijo
  p1: string; p2: string; p3: string; ok: string;   // estado
  tinta: string; tinta2: string; tenue: string; grilla: string; eje: string; superficie: string;
}

export const tema = computed<Tema>(() => {
  oscuro(); // dependencia: recalcula al cambiar el esquema del sistema
  return {
    serie: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => leer(`--series-${i}`)),
    p1: leer('--status-critical'), p2: leer('--status-serious'), p3: leer('--status-warning'),
    ok: leer('--status-good'),
    tinta: leer('--text-primary'), tinta2: leer('--text-secondary'), tenue: leer('--text-muted'),
    grilla: leer('--grid'), eje: leer('--axis'), superficie: leer('--surface-1'),
  };
});

/** Ejes y tooltip comunes: grilla recesiva, texto en tokens de tinta (nunca en color de serie). */
export function base(t: Tema) {
  const eje = {
    axisLine: { lineStyle: { color: t.eje } },
    axisTick: { show: false },
    axisLabel: { color: t.tenue, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grilla } },
    nameTextStyle: { color: t.tenue, fontSize: 11 },
  };
  return {
    eje,
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: t.tinta2 },
    tooltip: {
      backgroundColor: t.superficie, borderColor: t.grilla, textStyle: { color: t.tinta, fontSize: 12 },
    },
    legend: { show: false, textStyle: { color: t.tinta2 }, icon: 'roundRect', itemWidth: 12, itemHeight: 8, top: 0 },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
  };
}
