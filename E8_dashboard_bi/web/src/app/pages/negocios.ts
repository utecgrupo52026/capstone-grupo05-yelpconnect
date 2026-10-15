import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BusinessKpi } from '../core/models';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { dec, esc, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Panel, SinDatos } from '../shared/ui';

type Columna = keyof Pick<BusinessKpi, 'reviews_evaluated' | 'reviews_for_investigation' | 'investigation_rate_pct'
  | 'priority_p1' | 'avg_weighted_risk_score'>;

@Component({
  selector: 'app-negocios',
  imports: [Chart, Panel, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Negocios con mayor riesgo</h1>
        <p>¿Qué negocios concentran reseñas que requieren investigación? Útil para priorizar auditorías
           y detectar campañas coordinadas a favor o en contra de un negocio.</p>
      </div>

      @if (negocios(); as ns) {
        <app-panel titulo="Top 15 negocios por reseñas a investigar" stakeholder="Trust & Safety · Operaciones Comerciales">
          <app-chart [opciones]="opt()" [alto]="420" descripcion="Negocios con más reseñas para investigación" />
        </app-panel>

        <app-panel titulo="Ranking de negocios (top 50)" stakeholder="Operaciones Comerciales · seguimiento de cuentas">
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
                  <tr>
                    <td class="n">{{ i + 1 }}</td>
                    <td>{{ n.business_name }}</td>
                    <td class="texto">{{ n.city }}, {{ n.state }}</td>
                    <td class="n">{{ num(n.reviews_evaluated) }}</td>
                    <td class="n">{{ num(n.reviews_for_investigation) }}</td>
                    <td class="n">{{ pct(n.investigation_rate_pct) }}</td>
                    <td class="n">{{ num(n.priority_p1) }}</td>
                    <td class="n">{{ dec(n.avg_weighted_risk_score) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-panel>
      } @else {
        <app-sin-datos [mensaje]="negocios() === null ? 'Sin businesses.json' : 'Cargando…'" />
      }
    </section>
  `,
})
export class Negocios {
  protected readonly negocios = inject(DataService).businesses();
  protected readonly num = num; protected readonly pct = pct; protected readonly dec = dec;

  protected readonly columnas: { id: Columna; nombre: string }[] = [
    { id: 'reviews_evaluated', nombre: 'Evaluadas' },
    { id: 'reviews_for_investigation', nombre: 'A investigar' },
    { id: 'investigation_rate_pct', nombre: 'Tasa' },
    { id: 'priority_p1', nombre: 'P1' },
    { id: 'avg_weighted_risk_score', nombre: 'Score prom.' },
  ];
  protected readonly orden = signal<Columna>('reviews_for_investigation');
  protected ordenar(c: Columna) { this.orden.set(c); }

  protected readonly ordenados = computed(() =>
    [...(this.negocios() ?? [])].sort((a, b) => (b[this.orden()] ?? 0) - (a[this.orden()] ?? 0)));

  protected readonly opt = computed(() => {
    const t = tema(); const b = base(t);
    const top = [...(this.negocios() ?? [])]
      .sort((a, c) => c.reviews_for_investigation - a.reviews_for_investigation).slice(0, 15).reverse();
    return {
      ...b, grid: { ...b.grid, top: 8, right: 48 },
      tooltip: {
        ...b.tooltip, trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const n = top[p.dataIndex];
          return `<b>${esc(n.business_name)}</b><br>${num(n.reviews_for_investigation)} a investigar de ${num(n.reviews_evaluated)}`
            + ` (${pct(n.investigation_rate_pct)})<br>P1: ${num(n.priority_p1)} · score prom. ${dec(n.avg_weighted_risk_score)}`;
        },
      },
      xAxis: { type: 'value', ...b.eje },
      yAxis: { type: 'category', data: top.map((n) => n.business_name), ...b.eje, splitLine: { show: false },
        axisLabel: { ...b.eje.axisLabel, color: t.tinta2, width: 170, overflow: 'truncate' } },
      series: [{
        name: 'Reseñas a investigar', type: 'bar', barMaxWidth: 18, data: top.map((n) => n.reviews_for_investigation),
        itemStyle: { color: t.serie[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.tinta2 },
      }],
    };
  });
}
