import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { dec, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Kpi, Panel, SinDatos } from '../shared/ui';

type Rango = 'todo' | '60' | '24';

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
      } @else {
        <app-sin-datos [mensaje]="ov() === null ? 'Sin overview.json' : 'Cargando…'" />
      }

      <div class="filtros">
        <span class="nota" style="margin:0">Periodo:</span>
        <div class="segmentado" role="group" aria-label="Periodo">
          @for (r of rangos; track r.id) {
            <button type="button" [class.activo]="rango() === r.id" (click)="rango.set(r.id)">{{ r.nombre }}</button>
          }
        </div>
      </div>

      <div class="rejilla">
        <app-panel titulo="Tasa de señales e investigación por mes" stakeholder="Trust & Safety · tendencia del riesgo">
          @if (meses().length) { <app-chart [opciones]="optTasas()" descripcion="Tasas mensuales de señal e investigación" /> }
          @else { <app-sin-datos /> }
        </app-panel>
        <app-panel titulo="Reseñas evaluadas por mes" stakeholder="Producto · volumen de contenido analizado">
          @if (meses().length) { <app-chart [opciones]="optVolumen()" descripcion="Volumen mensual de reseñas" /> }
          @else { <app-sin-datos /> }
        </app-panel>
        <app-panel titulo="Reseñas por prioridad de investigación" stakeholder="Trust & Safety · dimensionar la carga del equipo">
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
  protected readonly num = num; protected readonly pct = pct; protected readonly dec = dec;

  protected readonly rangos: { id: Rango; nombre: string }[] = [
    { id: 'todo', nombre: 'Todo' }, { id: '60', nombre: 'Últimos 5 años' }, { id: '24', nombre: 'Últimos 24 meses' },
  ];
  protected readonly rango = signal<Rango>('todo');

  protected readonly meses = computed(() => {
    const m = this.mensual() ?? [];
    return this.rango() === 'todo' ? m : m.slice(-Number(this.rango()));
  });

  protected readonly optTasas = computed(() => {
    const t = tema(); const b = base(t); const m = this.meses();
    const linea = (nombre: string, color: string, datos: (number | null)[]) => ({
      name: nombre, type: 'line', data: datos, showSymbol: false, symbolSize: 8,
      lineStyle: { width: 2 }, itemStyle: { color }, emphasis: { focus: 'series' },
    });
    return {
      ...b, color: t.serie,
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: number) => pct(v) },
      legend: { ...b.legend, show: true, data: ['Con señal', 'Requiere investigación'] },
      xAxis: { type: 'category', data: m.map((x) => x.mes), ...b.eje, splitLine: { show: false } },
      yAxis: { type: 'value', ...b.eje, axisLabel: { ...b.eje.axisLabel, formatter: '{value} %' } },
      series: [
        linea('Con señal', t.serie[0], m.map((x) => x.signal_rate_pct)),
        linea('Requiere investigación', t.serie[1], m.map((x) => x.investigation_rate_pct)),
      ],
    };
  });

  protected readonly optVolumen = computed(() => {
    const t = tema(); const b = base(t); const m = this.meses();
    return {
      ...b, grid: { ...b.grid, top: 12 },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: number) => num(v) },
      xAxis: { type: 'category', data: m.map((x) => x.mes), ...b.eje, splitLine: { show: false } },
      yAxis: { type: 'value', ...b.eje },
      series: [{ name: 'Reseñas evaluadas', type: 'bar', data: m.map((x) => x.reviews_evaluated),
        itemStyle: { color: t.serie[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 }],
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
