import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BusinessKpi } from '../core/models';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { dec, esc, num, pct, pp } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Panel, SinDatos } from '../shared/ui';

type Columna = keyof Pick<BusinessKpi, 'reviews_evaluated' | 'reviews_with_signal' | 'signal_rate_pct'
  | 'reviews_for_investigation' | 'investigation_rate_pct' | 'priority_p1' | 'avg_weighted_risk_score'>;
type Metrica = 'investigacion' | 'tasa';

@Component({
  selector: 'app-negocios',
  imports: [Chart, Panel, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Negocios con mayor riesgo</h1>
        <p>¿Qué negocios presentan mayor tasa de reseñas con señales T&amp;S y cómo evoluciona en el tiempo?
           Sirve para priorizar el análisis por negocio, sin afirmar fraude confirmado.</p>
      </div>

      @if (negocios(); as ns) {
        <div class="filtros">
          <span class="nota" style="margin:0">Rankear por:</span>
          <div class="segmentado" role="group" aria-label="Métrica del ranking">
            <button type="button" [class.activo]="metrica() === 'tasa'" (click)="cambiarMetrica('tasa')">Tasa de señal</button>
            <button type="button" [class.activo]="metrica() === 'investigacion'" (click)="cambiarMetrica('investigacion')">Reseñas a investigar</button>
          </div>
        </div>

        <div class="rejilla">
          <app-panel [titulo]="metrica() === 'tasa' ? 'Top 15 negocios por tasa de señal' : 'Top 15 negocios por reseñas a investigar'"
                     req="REQ-01" stakeholder="Rafael Nakamura (T&S) · priorizar análisis por negocio">
            <app-chart [opciones]="opt()" [alto]="420" [descripcion]="'Top 15 negocios por ' + (metrica() === 'tasa' ? 'tasa de señal' : 'reseñas a investigar')" />
            @if (metrica() === 'tasa') {
              <p class="nota">Solo negocios con al menos {{ minResenas() }} reseñas evaluadas, para que una tasa alta no
                salga de dos o tres reseñas.</p>
            }
          </app-panel>

          <app-panel [titulo]="'Evolución mensual · ' + (actual()?.business_name ?? '—')" req="REQ-01"
                     stakeholder="Rafael Nakamura (T&S) · ¿la señal del negocio sube o baja?">
            @if (mensual() === null) {
              <app-sin-datos mensaje="Sin business_monthly.json: vuelve a ejecutar local/exportar_gold.py para ver la evolución por negocio." />
            } @else if (serieNegocio().length) {
              <div class="filtros">
                <label class="nota" style="margin:0" for="negocio">Negocio:</label>
                <select id="negocio" (change)="seleccionar($any($event.target).value)">
                  @for (n of porNombre(); track n.business_id) {
                    <option [value]="n.business_id" [selected]="n.business_id === actual()?.business_id">{{ n.business_name }}</option>
                  }
                </select>
              </div>
              @if (variacion(); as v) {
                <p class="resumen-mes">
                  <strong>{{ v.mes }}:</strong> {{ pct(v.tasa) }} con señal ({{ num(v.senal) }} de {{ num(v.evaluadas) }})
                  · <strong>{{ pp(v.delta) }}</strong> vs. {{ v.mesAnterior }}
                </p>
              }
              <app-chart [opciones]="optEvolucion()" [alto]="300" descripcion="Tasa mensual de señal del negocio frente a la plataforma" />
              <p class="nota">Últimos {{ serieNegocio().length }} meses del run. El último mes puede estar incompleto:
                compara tasas, no volúmenes.</p>
            } @else {
              <app-sin-datos mensaje="El negocio no tiene reseñas en la ventana exportada." />
            }
          </app-panel>
        </div>

        <app-panel titulo="Ranking de negocios" req="REQ-01" stakeholder="Rafael Nakamura (T&S) · seguimiento de cuentas">
          <div class="tabla-scroll">
            <table>
              <thead><tr>
                <th>#</th><th>Negocio</th><th>Ciudad</th>
                @for (c of columnas; track c.id) {
                  <th class="n ordenable" (click)="ordenar(c.id)" [attr.aria-sort]="orden() === c.id ? 'descending' : null">
                    {{ c.nombre }}{{ orden() === c.id ? ' ↓' : '' }}
                  </th>
                }
              </tr></thead>
              <tbody>
                @for (n of ordenados(); track n.business_id; let i = $index) {
                  <tr [class.seleccionado]="n.business_id === actual()?.business_id">
                    <td class="n">{{ i + 1 }}</td>
                    <td><button type="button" class="link" (click)="seleccionar(n.business_id)"
                                [attr.aria-label]="'Ver evolución de ' + n.business_name">{{ n.business_name }}</button></td>
                    <td class="texto">{{ n.city }}, {{ n.state }}</td>
                    <td class="n">{{ num(n.reviews_evaluated) }}</td>
                    <td class="n">{{ num(n.reviews_with_signal) }}</td>
                    <td class="n">{{ pct(n.signal_rate_pct) }}</td>
                    <td class="n">{{ num(n.reviews_for_investigation) }}</td>
                    <td class="n">{{ pct(n.investigation_rate_pct) }}</td>
                    <td class="n">{{ num(n.priority_p1) }}</td>
                    <td class="n">{{ dec(n.avg_weighted_risk_score) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="nota">Clic en un negocio para ver su evolución mensual.
            @if (topN(); as n) { La tabla une el top {{ n }} por reseñas a investigar y el top {{ n }} por tasa de señal. }
          </p>
        </app-panel>
      } @else {
        <app-sin-datos [mensaje]="negocios() === null ? 'Sin businesses.json' : 'Cargando…'" />
      }
    </section>
  `,
  styles: `.resumen-mes { margin: 0 0 4px; font-size: 13px; color: var(--text-secondary); }`,
})
export class Negocios {
  private readonly data = inject(DataService);
  protected readonly negocios = this.data.businesses();
  protected readonly mensual = this.data.businessMonthly();
  private readonly plataforma = this.data.monthly();
  private readonly meta = this.data.meta();
  protected readonly num = num; protected readonly pct = pct; protected readonly dec = dec; protected readonly pp = pp;

  protected readonly minResenas = computed(() => this.meta()?.parametros?.min_resenas_tasa ?? 50);
  protected readonly topN = computed(() => this.meta()?.parametros?.top_negocios ?? null);

  protected readonly columnas: { id: Columna; nombre: string }[] = [
    { id: 'reviews_evaluated', nombre: 'Evaluadas' },
    { id: 'reviews_with_signal', nombre: 'Con señal' },
    { id: 'signal_rate_pct', nombre: 'Tasa señal' },
    { id: 'reviews_for_investigation', nombre: 'A investigar' },
    { id: 'investigation_rate_pct', nombre: 'Tasa invest.' },
    { id: 'priority_p1', nombre: 'P1' },
    { id: 'avg_weighted_risk_score', nombre: 'Score prom.' },
  ];
  protected readonly metrica = signal<Metrica>('tasa');
  protected readonly orden = signal<Columna>('signal_rate_pct');
  protected ordenar(c: Columna) { this.orden.set(c); }
  protected cambiarMetrica(m: Metrica) {
    this.metrica.set(m);
    this.orden.set(m === 'tasa' ? 'signal_rate_pct' : 'reviews_for_investigation');
  }

  /** Con la tasa, los negocios chicos van al final: su tasa no es comparable. */
  private readonly comparables = computed(() =>
    (this.negocios() ?? []).filter((n) => this.metrica() !== 'tasa' || n.reviews_evaluated >= this.minResenas()));

  protected readonly ordenados = computed(() => {
    const c = this.orden();
    const ok = new Set(this.comparables().map((n) => n.business_id));
    return [...(this.negocios() ?? [])].sort((a, b) =>
      Number(ok.has(b.business_id)) - Number(ok.has(a.business_id)) || (b[c] ?? 0) - (a[c] ?? 0));
  });
  protected readonly porNombre = computed(() =>
    [...(this.negocios() ?? [])].sort((a, b) => a.business_name.localeCompare(b.business_name, 'es')));

  private readonly seleccionado = signal<string | null>(null);
  protected seleccionar(id: string) { this.seleccionado.set(id); }
  protected readonly actual = computed(() => {
    const ns = this.negocios() ?? [];
    return ns.find((n) => n.business_id === this.seleccionado()) ?? this.ordenados()[0] ?? null;
  });

  protected readonly serieNegocio = computed(() => {
    const id = this.actual()?.business_id;
    return (this.mensual() ?? []).filter((m) => m.business_id === id).sort((a, b) => a.mes.localeCompare(b.mes));
  });

  /** Último mes con reseñas frente al mes anterior con reseñas. */
  protected readonly variacion = computed(() => {
    const conDatos = this.serieNegocio().filter((m) => m.reviews_evaluated > 0);
    if (conDatos.length < 2) return null;
    const [ant, ult] = conDatos.slice(-2);
    return {
      mes: ult.mes, mesAnterior: ant.mes, tasa: ult.signal_rate_pct, senal: ult.reviews_with_signal,
      evaluadas: ult.reviews_evaluated, delta: (ult.signal_rate_pct ?? 0) - (ant.signal_rate_pct ?? 0),
    };
  });

  protected readonly optEvolucion = computed(() => {
    const t = tema(); const b = base(t); const s = this.serieNegocio();
    const global = new Map((this.plataforma() ?? []).map((m) => [m.mes, m.signal_rate_pct]));
    const nombre = this.actual()?.business_name ?? 'Negocio';
    return {
      ...b, color: [t.serie[0], t.tenue],
      legend: { ...b.legend, show: true, data: [nombre, 'Plataforma'] },
      tooltip: {
        ...b.tooltip, trigger: 'axis',
        formatter: (ps: { dataIndex: number }[]) => {
          const m = s[ps[0].dataIndex];
          return `<b>${esc(m.mes)}</b><br>${esc(nombre)}: ${pct(m.signal_rate_pct)} (${num(m.reviews_with_signal)} de ${num(m.reviews_evaluated)})`
            + `<br>A investigar: ${num(m.reviews_for_investigation)}<br>Plataforma: ${pct(global.get(m.mes))}`;
        },
      },
      xAxis: { type: 'category', data: s.map((m) => m.mes), ...b.eje, splitLine: { show: false } },
      yAxis: { type: 'value', ...b.eje, axisLabel: { ...b.eje.axisLabel, formatter: '{value} %' } },
      series: [
        { name: nombre, type: 'line', data: s.map((m) => m.signal_rate_pct), connectNulls: false, symbolSize: 6,
          lineStyle: { width: 2 }, itemStyle: { color: t.serie[0] }, emphasis: { focus: 'series' } },
        { name: 'Plataforma', type: 'line', data: s.map((m) => global.get(m.mes) ?? null), showSymbol: false,
          lineStyle: { width: 1.5, type: 'dashed' }, itemStyle: { color: t.tenue } },
      ],
    };
  });

  protected readonly opt = computed(() => {
    const t = tema(); const b = base(t);
    const tasa = this.metrica() === 'tasa';
    const valor = (n: BusinessKpi) => (tasa ? n.signal_rate_pct : n.reviews_for_investigation);
    const top = [...this.comparables()].sort((a, c) => valor(c) - valor(a)).slice(0, 15).reverse();
    return {
      ...b, grid: { ...b.grid, top: 8, right: 56 },
      tooltip: {
        ...b.tooltip, trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const n = top[p.dataIndex];
          return `<b>${esc(n.business_name)}</b><br>${pct(n.signal_rate_pct)} con señal (${num(n.reviews_with_signal)} de ${num(n.reviews_evaluated)})`
            + `<br>${num(n.reviews_for_investigation)} a investigar · P1: ${num(n.priority_p1)}`;
        },
      },
      xAxis: { type: 'value', ...b.eje, ...(tasa ? { axisLabel: { ...b.eje.axisLabel, formatter: '{value} %' } } : {}) },
      yAxis: { type: 'category', data: top.map((n) => n.business_name), ...b.eje, splitLine: { show: false },
        axisLabel: { ...b.eje.axisLabel, color: t.tinta2, width: 170, overflow: 'truncate' } },
      series: [{
        name: tasa ? 'Tasa de señal' : 'Reseñas a investigar', type: 'bar', barMaxWidth: 18, data: top.map(valor),
        itemStyle: { color: t.serie[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.tinta2, formatter: (p: { value: number }) => (tasa ? pct(p.value) : num(p.value)) },
      }],
    };
  });
}
