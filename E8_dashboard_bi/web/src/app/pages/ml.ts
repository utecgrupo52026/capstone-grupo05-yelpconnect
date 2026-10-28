import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Coincidencia } from '../core/models';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { dec, fecha, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Kpi, Panel, Prioridad, SinDatos } from '../shared/ui';

const ETIQUETA_COINCIDENCIA: Record<Coincidencia, string> = {
  ambos: 'Ambos', solo_reglas: 'Solo reglas', solo_ml: 'Solo ML', ninguno: 'Ninguno',
};

@Component({
  selector: 'app-ml',
  imports: [Chart, Kpi, Panel, Prioridad, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Reglas vs Machine Learning</h1>
        <p>Un modelo no supervisado (Isolation Forest) puntúa qué tan atípica es cada reseña según sus variables de
           comportamiento, sin usar etiquetas de fraude. Se compara con las reglas para encontrar casos que las reglas
           no ven (<b>solo ML</b>) y validar los que sí (<b>ambos</b>).</p>
      </div>

      @if (res(); as r) {
        <div class="kpis">
          <app-kpi etiqueta="Reseñas puntuadas" [valor]="num(r['reseñas_puntuadas'])" [detalle]="r.modelo.algoritmo + ' · ' + r.modelo.version" />
          <app-kpi etiqueta="Anomalías del modelo" [valor]="num(r.anomalias_ml)" [detalle]="'Contaminación ' + pct(r.modelo.contaminacion * 100)" />
          <app-kpi etiqueta="Marcadas por reglas" [valor]="num(r.marcadas_por_reglas)" detalle="requires_investigation" />
          <app-kpi etiqueta="Anomalías con alguna señal" [valor]="pct(r.pct_anomalias_con_alguna_senal)" detalle="Acuerdo parcial con reglas" />
          <app-kpi etiqueta="Coincidencia (Jaccard)" [valor]="dec(r.jaccard_ml_reglas, 2)" detalle="0 = nada en común · 1 = idénticos" />
          <app-kpi etiqueta="Correlación score vs riesgo" [valor]="dec(r.correlacion_spearman_score_vs_riesgo, 2)" detalle="Spearman" />
        </div>

        <div class="rejilla">
          <app-panel titulo="Matriz de coincidencia" stakeholder="Trust & Safety · ¿el modelo aporta algo nuevo?">
            <div class="matriz" role="table" aria-label="Matriz reglas versus modelo">
              <div></div><div class="cab">ML: anómala</div><div class="cab">ML: normal</div>
              <div class="cab lado">Reglas: investigar</div>
              <div class="celda fuerte"><b>{{ num(r.matriz.ambos) }}</b><span>Ambos</span></div>
              <div class="celda"><b>{{ num(r.matriz.solo_reglas) }}</b><span>Solo reglas</span></div>
              <div class="cab lado">Reglas: sin alerta</div>
              <div class="celda fuerte"><b>{{ num(r.matriz.solo_ml) }}</b><span>Solo ML · casos nuevos</span></div>
              <div class="celda tenue"><b>{{ num(r.matriz.ninguno) }}</b><span>Ninguno</span></div>
            </div>
            <p class="nota">«Solo ML» son candidatos que ninguna regla detecta: revisarlos ayuda a diseñar nuevas reglas.</p>
          </app-panel>

          <app-panel titulo="Distribución del anomaly score" stakeholder="Data Science · umbral del modelo">
            <app-chart [opciones]="optHist()" descripcion="Histograma del score, normales vs anómalas" />
            <p class="nota">Eje vertical en escala logarítmica: las anómalas son ~1 % del total.</p>
          </app-panel>

          <app-panel titulo="Variables que más explican las anomalías" stakeholder="Trust & Safety · interpretación del modelo">
            <app-chart [opciones]="optFeatures()" [alto]="320" descripcion="Frecuencia de cada variable entre las 3 principales de cada anomalía" />
          </app-panel>

          <app-panel titulo="Perfil: mediana anómalas vs normales" stakeholder="Data Science · validación del modelo">
            <div class="tabla-scroll">
              <table>
                <thead><tr><th>Variable</th><th class="n">Anómalas</th><th class="n">Normales</th></tr></thead>
                <tbody>
                  @for (p of r.perfil_features; track p.feature) {
                    <tr><td>{{ p.etiqueta }}</td><td class="n">{{ dec(p.mediana_anomalas, 2) }}</td><td class="n">{{ dec(p.mediana_normales, 2) }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </app-panel>
        </div>

        <app-panel titulo="Top anomalías del modelo" stakeholder="Trust & Safety · analistas de moderación">
          <div class="tabla-scroll">
            <table>
              <thead><tr>
                <th class="n">Score</th><th class="n">Percentil</th><th>Coincidencia</th><th>Variables principales</th>
                <th>Reglas</th><th>Prioridad</th><th>Negocio</th><th>Fecha</th><th class="n">★</th>
              </tr></thead>
              <tbody>
                @for (a of top() ?? []; track a.review_id) {
                  <tr>
                    <td class="n">{{ dec(a.anomaly_score, 3) }}</td>
                    <td class="n">{{ dec(a.anomaly_percentile, 2) }}</td>
                    <td><span class="chip" [class.alerta]="a.coincidencia === 'solo_ml'"><span class="punto"></span>{{ etiqueta(a.coincidencia) }}</span></td>
                    <td class="texto">{{ features(a.top_features) }}</td>
                    <td>@for (g of lista(a.signal_rules_csv); track g) { <span class="regla">{{ g }}</span> } @empty { — }</td>
                    <td><app-prioridad [p]="a.investigation_priority" /></td>
                    <td>{{ a.business_name ?? '—' }}</td>
                    <td class="mono">{{ a.review_date }}</td>
                    <td class="n">{{ a.stars }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="nota">Modelo entrenado el {{ fecha(r.modelo.entrenado_en) }}. {{ r.nota }}</p>
        </app-panel>
      } @else {
        <app-sin-datos [mensaje]="res() === null ? 'Sin ml_resumen.json: ejecuta local/ml_anomalias.py' : 'Cargando…'" />
      }
    </section>
  `,
  styles: `
    .matriz { display: grid; grid-template-columns: auto 1fr 1fr; gap: 6px; }
    .cab { font-size: 12px; color: var(--text-secondary); font-weight: 600; text-align: center; align-self: end; }
    .cab.lado { text-align: right; align-self: center; padding-right: 6px; }
    .celda { border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: grid; gap: 2px; text-align: center;
      b { font-size: 22px; } span { font-size: 12px; color: var(--text-secondary); } }
    .celda.fuerte { background: color-mix(in srgb, var(--accent) 10%, transparent); }
    .celda.tenue { opacity: .75; }
  `,
})
export class Ml {
  private readonly data = inject(DataService);
  protected readonly res = this.data.mlResumen();
  protected readonly top = this.data.mlTop();
  protected readonly num = num; protected readonly pct = pct; protected readonly dec = dec; protected readonly fecha = fecha;

  private readonly etiquetas = computed(() =>
    Object.fromEntries((this.res()?.perfil_features ?? []).map((p) => [p.feature, p.etiqueta])));

  protected etiqueta(c: Coincidencia) { return ETIQUETA_COINCIDENCIA[c]; }
  protected lista(csv: string | null) { return csv ? csv.split(',').filter(Boolean) : []; }
  protected features(csv: string) { return this.lista(csv).map((f) => this.etiquetas()[f] ?? f).join(' · '); }

  protected readonly optHist = computed(() => {
    const t = tema(); const b = base(t); const h = this.res()?.histograma;
    if (!h) return {};
    const centros = h.bordes.slice(0, -1).map((v, i) => ((v + h.bordes[i + 1]) / 2).toFixed(3));
    const sinCeros = (xs: number[]) => xs.map((v) => (v > 0 ? v : null)); // log no admite 0
    const barra = (nombre: string, color: string, datos: number[]) => ({
      name: nombre, type: 'bar', data: sinCeros(datos), barGap: '0%', barCategoryGap: '12%',
      itemStyle: { color, borderColor: t.superficie, borderWidth: 1 },
    });
    return {
      ...b,
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: number) => num(v) },
      legend: { ...b.legend, show: true, data: ['Normales', 'Anómalas'] },
      xAxis: { type: 'category', data: centros, name: 'anomaly score', nameLocation: 'middle', nameGap: 28, ...b.eje, splitLine: { show: false } },
      yAxis: { type: 'log', min: 1, ...b.eje },
      series: [barra('Normales', t.serie[0], h.normales), barra('Anómalas', t.serie[1], h.anomalas)],
    };
  });

  protected readonly optFeatures = computed(() => {
    const t = tema(); const b = base(t);
    const fs = [...(this.res()?.features_mas_frecuentes ?? [])].reverse();
    return {
      ...b, grid: { ...b.grid, top: 8, right: 48 },
      tooltip: { ...b.tooltip, trigger: 'item', valueFormatter: (v: number) => `${num(v)} anomalías` },
      xAxis: { type: 'value', ...b.eje },
      yAxis: { type: 'category', data: fs.map((f) => f.etiqueta), ...b.eje, splitLine: { show: false },
        axisLabel: { ...b.eje.axisLabel, color: t.tinta2 } },
      series: [{
        name: 'Anomalías', type: 'bar', barMaxWidth: 18, data: fs.map((f) => f.anomalias),
        itemStyle: { color: t.serie[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.tinta2 },
      }],
    };
  });
}
