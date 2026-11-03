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

/** Por debajo de este volumen anual, la tasa de un año es poco confiable. */
const MIN_RESENAS_ANIO = 10;

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

          <app-panel [titulo]="'Evolución anual · ' + (actual()?.business_name ?? '—')" req="REQ-01"
                     stakeholder="Rafael Nakamura (T&S) · ¿la señal del negocio sube o baja?">
            @if (tendencia() === null) {
              <app-sin-datos mensaje="Sin business_trend.json: vuelve a ejecutar local/exportar_gold.py para ver la evolución por negocio." />
            } @else if (tendencia()) {
              <div class="filtros">
                <label class="nota" style="margin:0" for="negocio">Negocio:</label>
                <select id="negocio" (change)="seleccionar($any($event.target).value)">
                  @for (n of porNombre(); track n.business_id) {
                    <option [value]="n.business_id" [selected]="n.business_id === actual()?.business_id">{{ n.business_name }}</option>
                  }
                </select>
              </div>
              @if (serieNegocio().length) {
                @if (variacion(); as v) {
                  <p class="resumen-mes">
                    <strong>{{ v.anio }}:</strong> {{ pct(v.tasa) }} con señal ({{ num(v.senal) }} de {{ num(v.evaluadas) }})
                    · <strong>{{ pp(v.delta) }}</strong> vs. {{ v.anioAnterior }}
                  </p>
                }
                <app-chart [opciones]="optEvolucion()" [alto]="300" descripcion="Tasa anual de señal del negocio frente a la plataforma" />
                <p class="nota">
                  Los puntos huecos son años con menos de {{ minAnio }} reseñas: su tasa es poco confiable. La comparación
                  de arriba usa solo años con al menos {{ minAnio }} reseñas.
                  @if (anioParcial(); as a) { {{ a }}* está incompleto (los datos terminan en {{ ultimoMes() }}). }
                </p>
              } @else {
                <app-sin-datos mensaje="El negocio no tiene reseñas en el run." />
              }
            } @else {
              <app-sin-datos />
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
          <p class="nota">Clic en un negocio para ver su evolución anual.
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
  protected readonly tendencia = this.data.businessTrend();
  private readonly plataforma = this.data.monthly();
  private readonly meta = this.data.meta();
  protected readonly num = num; protected readonly pct = pct; protected readonly dec = dec; protected readonly pp = pp;
  protected readonly minAnio = MIN_RESENAS_ANIO;

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

  protected readonly ultimoMes = computed(() => this.tendencia()?.ultimo_mes_datos ?? null);
  /** Año del último mes con datos si no llega a diciembre (p. ej. 2022 con solo enero). */
  protected readonly anioParcial = computed(() => {
    const u = this.ultimoMes();
    return u && !u.endsWith('-12') ? Number(u.slice(0, 4)) : null;
  });

  /** Años del negocio desde su primera reseña (antes no existía en Yelp o no tenía actividad). */
  protected readonly serieNegocio = computed(() => {
    const id = this.actual()?.business_id;
    const filas = (this.tendencia()?.filas ?? []).filter((f) => f.business_id === id).sort((a, b) => a.anio - b.anio);
    const desde = filas.findIndex((f) => f.reviews_evaluated > 0);
    return desde < 0 ? [] : filas.slice(desde);
  });

  /** Tasa anual de la plataforma, a partir de monthly.json. */
  private readonly plataformaAnual = computed(() => {
    const acc = new Map<number, { n: number; s: number }>();
    for (const m of this.plataforma() ?? []) {
      const a = Number(m.mes.slice(0, 4));
      const x = acc.get(a) ?? { n: 0, s: 0 };
      x.n += m.reviews_evaluated; x.s += m.reviews_with_signal;
      acc.set(a, x);
    }
    return new Map([...acc].map(([a, x]) => [a, x.n ? Math.round((10000 * x.s) / x.n) / 100 : null]));
  });

  /** Último año completo con volumen suficiente frente al anterior con volumen suficiente. */
  protected readonly variacion = computed(() => {
    const parcial = this.anioParcial();
    const conDatos = this.serieNegocio().filter((f) => f.reviews_evaluated >= MIN_RESENAS_ANIO && f.anio !== parcial);
    if (conDatos.length < 2) return null;
    const [ant, ult] = conDatos.slice(-2);
    return {
      anio: ult.anio, anioAnterior: ant.anio, tasa: ult.signal_rate_pct, senal: ult.reviews_with_signal,
      evaluadas: ult.reviews_evaluated, delta: (ult.signal_rate_pct ?? 0) - (ant.signal_rate_pct ?? 0),
    };
  });

  protected readonly optEvolucion = computed(() => {
    const t = tema(); const b = base(t); const s = this.serieNegocio();
    const global = this.plataformaAnual();
    const parcial = this.anioParcial();
    const etiqueta = (a: number) => (a === parcial ? `${a}*` : String(a));
    const nombre = this.actual()?.business_name ?? 'Negocio';
    return {
      ...b, color: [t.serie[0], t.tenue],
      legend: { ...b.legend, show: true, data: [nombre, 'Plataforma'] },
      tooltip: {
        ...b.tooltip, trigger: 'axis',
        formatter: (ps: { dataIndex: number }[]) => {
          const f = s[ps[0].dataIndex];
          const aviso = f.reviews_evaluated < MIN_RESENAS_ANIO ? '<br><i>Pocas reseñas: tasa poco confiable</i>' : '';
          return `<b>${etiqueta(f.anio)}</b><br>${esc(nombre)}: ${pct(f.signal_rate_pct)} (${num(f.reviews_with_signal)} de ${num(f.reviews_evaluated)})`
            + `<br>A investigar: ${num(f.reviews_for_investigation)}<br>Plataforma: ${pct(global.get(f.anio))}${aviso}`;
        },
      },
      xAxis: { type: 'category', data: s.map((f) => etiqueta(f.anio)), ...b.eje, splitLine: { show: false } },
      yAxis: { type: 'value', ...b.eje, axisLabel: { ...b.eje.axisLabel, formatter: '{value} %' } },
      series: [
        {
          name: nombre, type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 },
          itemStyle: { color: t.serie[0] },
          emphasis: { focus: 'series' },
          // Años con pocas reseñas: punto hueco (la forma, no solo el color, marca la diferencia)
          data: s.map((f) => ({
            value: f.signal_rate_pct,
            itemStyle: f.reviews_evaluated < MIN_RESENAS_ANIO ? { color: t.superficie, borderColor: t.serie[0], borderWidth: 2 } : undefined,
          })),
        },
        { name: 'Plataforma', type: 'line', data: s.map((f) => global.get(f.anio) ?? null), showSymbol: false,
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
