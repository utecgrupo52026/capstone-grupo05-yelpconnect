import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { esc, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Panel, SinDatos } from '../shared/ui';

@Component({
  selector: 'app-reglas',
  imports: [Chart, Panel, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Reglas de Trust &amp; Safety</h1>
        <p>¿Qué reglas heurísticas (R001–R006) se activan más y con qué cobertura? Sirve para calibrar umbrales
           y pesos del catálogo versionado en <span class="mono">yelp_gov.evaluation_rule_version</span>.</p>
      </div>

      @if (reglas(); as rs) {
        <div class="rejilla">
          <app-panel titulo="Reseñas con señal por regla" stakeholder="Trust & Safety · calibración de reglas">
            <app-chart [opciones]="opt()" [alto]="300" descripcion="Cantidad de señales por regla" />
            <p class="nota">Una reseña puede activar varias reglas a la vez.</p>
          </app-panel>
          <app-panel titulo="Detalle por regla" stakeholder="Trust & Safety · Data Steward">
            <div class="tabla-scroll">
              <table>
                <thead><tr>
                  <th>Regla</th><th>Tipo</th><th class="n">Señales</th><th class="n">Tasa</th>
                  <th class="n">No evaluables</th><th class="n">Cobertura</th>
                </tr></thead>
                <tbody>
                  @for (r of rs; track r.rule_id) {
                    <tr>
                      <td><span class="regla">{{ r.rule_id }}</span> {{ r.rule_name }}</td>
                      <td class="texto">{{ r.rule_type }}</td>
                      <td class="n">{{ num(r.signals) }}</td>
                      <td class="n">{{ pct(r.signal_rate_pct) }}</td>
                      <td class="n">{{ num(r.not_evaluable) }}</td>
                      <td class="n">{{ pct(r.evaluation_coverage_pct) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-panel>
        </div>
      } @else {
        <app-sin-datos [mensaje]="reglas() === null ? 'Sin rules.json' : 'Cargando…'" />
      }
    </section>
  `,
})
export class Reglas {
  protected readonly reglas = inject(DataService).rules();
  protected readonly num = num; protected readonly pct = pct;

  protected readonly opt = computed(() => {
    const t = tema(); const b = base(t);
    const rs = [...(this.reglas() ?? [])].sort((a, c) => a.signals - c.signals);
    return {
      ...b, grid: { ...b.grid, top: 8, right: 64 },
      tooltip: {
        ...b.tooltip, trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = rs[p.dataIndex];
          return `<b>${esc(r.rule_id)} · ${esc(r.rule_name)}</b><br>${num(r.signals)} señales · ${pct(r.signal_rate_pct)} de las evaluables`;
        },
      },
      xAxis: { type: 'value', ...b.eje },
      yAxis: { type: 'category', data: rs.map((r) => `${r.rule_id} ${r.rule_name}`), ...b.eje,
        splitLine: { show: false }, axisLabel: { ...b.eje.axisLabel, color: t.tinta2 } },
      series: [{
        name: 'Señales', type: 'bar', barMaxWidth: 22, data: rs.map((r) => r.signals),
        itemStyle: { color: t.serie[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.tinta2, formatter: (p: { dataIndex: number }) => pct(rs[p.dataIndex].signal_rate_pct) },
      }],
    };
  });
}
