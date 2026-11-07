import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { dec, diaCorto, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Kpi, Panel, SinDatos } from '../shared/ui';

type Rango = 'todo' | '60' | '24' | 'dia';

/** Un punto de la serie, venga de monthly.json (mes) o de daily.json (día). */
interface Punto {
  etiqueta: string;
  evaluadas: number;
  senal: number | null;
  investigacion: number | null;
  score: number | null;
  p1: number;
  p2: number | null;
}

@Component({
  selector: 'app-resumen',
  imports: [Chart, Kpi, Panel, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Resumen Trust &amp; Safety</h1>
        <p>¿Cuántas reseñas muestran señales de comportamiento anómalo y cuántas requieren investigación?
           Indicadores del último run publicado en gold.</p>
      </div>

      @if (ov(); as o) {
        <div class="kpis">
          <app-kpi etiqueta="Reseñas evaluadas" [valor]="num(o.reviews_evaluated)" />
          <app-kpi etiqueta="Con al menos una señal" [valor]="pct(o.signal_rate_pct)" [detalle]="num(o.reviews_with_signal) + ' reseñas'" />
          <app-kpi etiqueta="Requieren investigación" [valor]="pct(o.investigation_rate_pct)" [detalle]="num(o.reviews_for_investigation) + ' reseñas'" />
          <app-kpi etiqueta="Prioridad P1" [valor]="num(o.priority_p1)" detalle="Atención inmediata" />
          <app-kpi etiqueta="Score de riesgo promedio" [valor]="dec(o.avg_weighted_risk_score)" [detalle]="'Máximo ' + dec(o.max_weighted_risk_score)" />
          <app-kpi etiqueta="Evaluación incompleta" [valor]="num(o.reviews_incomplete_evaluation)" detalle="Reglas no evaluables" />
        </div>
        <p class="nota" style="margin:0"><span class="req">REQ-02</span> evaluadas y % con señal ·
          <span class="req">REQ-03</span> casos a investigar y prioridad (detalle en la Cola de investigación) ·
          <span class="req">REQ-06</span> evaluación incompleta (detalle en Calidad y versiones)</p>
      } @else {
        <app-sin-datos [mensaje]="ov() === null ? 'Sin overview.json' : 'Cargando…'" />
      }

      <div class="filtros">
        <span class="nota" style="margin:0">Periodo:</span>
        <div class="segmentado" role="group" aria-label="Periodo">
          @for (r of rangos(); track r.id) {
            <button type="button" [class.activo]="rango() === r.id" [disabled]="r.id === 'dia' && diario() === null"
                    (click)="rango.set(r.id)">{{ r.nombre }}</button>
          }
        </div>
        @if (diario() === null) {
          <span class="nota" style="margin:0">La vista diaria necesita <span class="mono">daily.json</span>:
            vuelve a ejecutar <span class="mono">local/exportar_gold.py</span>.</span>
        }
      </div>

      <div class="rejilla">
        <app-panel [titulo]="'Tasa de señales e investigación por ' + unidad()" req="REQ-05"
                   stakeholder="Laura Hernández / Rafael Nakamura · estabilidad del producto">
          @if (serie().length) { <app-chart [opciones]="optTasas()" [descripcion]="'Tasas de señal e investigación por ' + unidad()" /> }
          @else { <app-sin-datos /> }
        </app-panel>
        <app-panel [titulo]="'Reseñas evaluadas por ' + unidad()" req="REQ-02 · REQ-05"
                   stakeholder="Rafael Nakamura (T&S) · volumen y alcance del monitoreo">
          @if (serie().length) { <app-chart [opciones]="optVolumen()" [descripcion]="'Reseñas evaluadas por ' + unidad()" /> }
          @else { <app-sin-datos /> }
        </app-panel>
        <app-panel [titulo]="'Score de riesgo promedio por ' + unidad()" req="REQ-05"
                   stakeholder="Laura Hernández / Rafael Nakamura · detectar cambios relevantes">
          @if (serie().length) {
            <app-chart [opciones]="optScore()" [descripcion]="'Score de riesgo ponderado promedio por ' + unidad()" />
            <p class="nota">Promedio de <span class="mono">weighted_risk_score</span> (0 a 1) de las reseñas de cada {{ unidad() }}.</p>
          } @else { <app-sin-datos /> }
        </app-panel>
        <app-panel titulo="Reseñas por prioridad de investigación" req="REQ-03"
                   stakeholder="Rafael Nakamura (T&S) · capacidad operativa y orden de revisión">
          @if (ov()) { <app-chart [opciones]="optPrioridad()" [alto]="200" descripcion="Reseñas por prioridad P1, P2 y P3" /> }
        </app-panel>
      </div>
    </section>
  `,
})
export class Resumen {
  private readonly data = inject(DataService);
  protected readonly ov = this.data.overview();
  private readonly mensual = this.data.monthly();
  protected readonly diario = this.data.daily();
  protected readonly num = num; protected readonly pct = pct; protected readonly dec = dec;

  protected readonly rango = signal<Rango>('todo');
  protected readonly rangos = computed<{ id: Rango; nombre: string }[]>(() => [
    { id: 'todo', nombre: 'Todo' }, { id: '60', nombre: 'Últimos 5 años' }, { id: '24', nombre: 'Últimos 24 meses' },
    { id: 'dia', nombre: `Diario · ${this.diario()?.length ?? 90} días` },
  ]);
  protected readonly unidad = computed(() => (this.rango() === 'dia' ? 'día' : 'mes'));

  protected readonly serie = computed<Punto[]>(() => {
    if (this.rango() === 'dia') {
      return (this.diario() ?? []).map((d) => ({
        etiqueta: d.dia, evaluadas: d.reviews_evaluated, senal: d.signal_rate_pct, investigacion: d.investigation_rate_pct,
        score: d.avg_weighted_risk_score, p1: d.priority_p1, p2: d.priority_p2,
      }));
    }
    const m = this.mensual() ?? [];
    return (this.rango() === 'todo' ? m : m.slice(-Number(this.rango()))).map((x) => ({
      etiqueta: x.mes, evaluadas: x.reviews_evaluated, senal: x.signal_rate_pct, investigacion: x.investigation_rate_pct,
      score: x.avg_weighted_risk_score, p1: x.priority_p1, p2: null,
    }));
  });

  /** Eje X común: en la vista diaria se muestran fechas cortas. */
  private ejeX() {
    const b = base(tema());
    const diaria = this.rango() === 'dia';
    return {
      type: 'category', data: this.serie().map((x) => x.etiqueta), ...b.eje, splitLine: { show: false },
      axisLabel: { ...b.eje.axisLabel, ...(diaria ? { formatter: (v: string) => diaCorto(v) } : {}) },
    };
  }

  protected readonly optTasas = computed(() => {
    const t = tema(); const b = base(t); const s = this.serie();
    const linea = (nombre: string, color: string, datos: (number | null)[]) => ({
      name: nombre, type: 'line', data: datos, showSymbol: false, symbolSize: 8,
      lineStyle: { width: 2 }, itemStyle: { color }, emphasis: { focus: 'series' },
    });
    return {
      ...b, color: t.serie,
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: number) => pct(v) },
      legend: { ...b.legend, show: true, data: ['Con señal', 'Requiere investigación'] },
      xAxis: this.ejeX(),
      yAxis: { type: 'value', ...b.eje, axisLabel: { ...b.eje.axisLabel, formatter: '{value} %' } },
      series: [
        linea('Con señal', t.serie[0], s.map((x) => x.senal)),
        linea('Requiere investigación', t.serie[1], s.map((x) => x.investigacion)),
      ],
    };
  });

  protected readonly optVolumen = computed(() => {
    const t = tema(); const b = base(t); const s = this.serie();
    return {
      ...b, grid: { ...b.grid, top: 12 },
      tooltip: {
        ...b.tooltip, trigger: 'axis',
        formatter: (ps: { dataIndex: number }[]) => {
          const x = s[ps[0].dataIndex];
          const alertas = x.p2 == null ? `P1: ${num(x.p1)}` : `P1: ${num(x.p1)} · P2: ${num(x.p2)}`;
          return `<b>${x.etiqueta}</b><br>${num(x.evaluadas)} reseñas evaluadas<br>${alertas}`;
        },
      },
      xAxis: this.ejeX(),
      yAxis: { type: 'value', ...b.eje },
      series: [{ name: 'Reseñas evaluadas', type: 'bar', data: s.map((x) => x.evaluadas),
        itemStyle: { color: t.serie[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 }],
    };
  });

  protected readonly optScore = computed(() => {
    const t = tema(); const b = base(t); const s = this.serie();
    return {
      ...b, grid: { ...b.grid, top: 12 },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: number) => dec(v) },
      xAxis: this.ejeX(),
      yAxis: { type: 'value', ...b.eje, axisLabel: { ...b.eje.axisLabel, formatter: (v: number) => dec(v, 2) } },
      series: [{
        name: 'Score promedio', type: 'line', data: s.map((x) => x.score), showSymbol: false, symbolSize: 8,
        lineStyle: { width: 2 }, itemStyle: { color: t.serie[2] }, emphasis: { focus: 'series' },
      }],
    };
  });

  protected readonly optPrioridad = computed(() => {
    const t = tema(); const b = base(t); const o = this.ov();
    if (!o) return {};
    const filas = [
      { nombre: 'P3 · baja', valor: o.priority_p3, color: t.p3 },
      { nombre: 'P2 · media', valor: o.priority_p2, color: t.p2 },
      { nombre: 'P1 · alta', valor: o.priority_p1, color: t.p1 },
    ];
    return {
      ...b, grid: { ...b.grid, top: 8, right: 56 },
      tooltip: { ...b.tooltip, trigger: 'item', valueFormatter: (v: number) => num(v) },
      xAxis: { type: 'value', ...b.eje },
      yAxis: { type: 'category', data: filas.map((f) => f.nombre), ...b.eje, splitLine: { show: false },
        axisLabel: { ...b.eje.axisLabel, color: t.tinta2 } },
      series: [{
        name: 'Reseñas', type: 'bar', barMaxWidth: 26,
        data: filas.map((f) => ({ value: f.valor, itemStyle: { color: f.color, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: t.tinta2, formatter: (p: { value: number }) => num(p.value) },
      }],
    };
  });
}
