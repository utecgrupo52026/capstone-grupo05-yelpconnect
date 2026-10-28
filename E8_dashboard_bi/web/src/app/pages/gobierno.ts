import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { fecha, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Kpi, Panel, SinDatos } from '../shared/ui';

@Component({
  selector: 'app-gobierno',
  imports: [Chart, Kpi, Panel, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Calidad de datos</h1>
        <p>Salud del motor de reglas DQ (E5) en su última ejecución por capa. Es la vista que se le muestra a la CDO:
           ¿podemos confiar en los datos que alimentan Trust &amp; Safety?</p>
      </div>

      @if (dq(); as d) {
        <div class="kpis">
          <app-kpi etiqueta="Reglas evaluadas" [valor]="num(d.total_reglas)" [detalle]="'Última ejecución ' + fecha(d.ultima_ejecucion)" />
          <app-kpi etiqueta="Reglas que cumplen" [valor]="num(d.reglas_ok)" [detalle]="pct(d.total_reglas ? 100 * d.reglas_ok / d.total_reglas : null)" />
          <app-kpi etiqueta="Reglas en rojo" [valor]="num(d.reglas_en_rojo)" detalle="Bajo su umbral" />
          <app-kpi etiqueta="Cumplimiento promedio" [valor]="pct(d.pct_cumplimiento_promedio)" />
        </div>

        <app-panel titulo="Reglas en rojo por dimensión y capa" stakeholder="CDO · dónde invertir en calidad">
          <app-chart [opciones]="opt()" [alto]="240" descripcion="Reglas en rojo por dimensión de calidad y capa" />
        </app-panel>

          <app-panel titulo="Reglas de calidad (última ejecución)" stakeholder="Data Stewards · remediación">
            <div class="tabla-scroll alto">
              <table>
                <thead><tr>
                  <th>Estado</th><th>Regla</th><th>Capa</th><th>Dimensión</th><th>Objetivo</th>
                  <th class="n">Cumple</th><th class="n">Umbral</th><th class="n">Filas con error</th>
                </tr></thead>
                <tbody>
                  @for (r of d.reglas; track r.regla_id + r.capa) {
                    <tr>
                      <td>
                        @if (r.paso) { <span class="chip ok"><span class="punto"></span>OK</span> }
                        @else { <span class="chip critico"><span class="punto"></span>Rojo</span> }
                      </td>
                      <td><span class="regla">{{ r.regla_id }}</span> <span class="texto">{{ r.descripcion }}</span></td>
                      <td>{{ r.capa }}</td>
                      <td>{{ r.dimension }}</td>
                      <td class="mono">{{ objetivo(r.tabla_objetivo, r.columna) }}</td>
                      <td class="n">{{ pct(r.pct_cumplimiento) }}</td>
                      <td class="n">{{ pct(r.umbral_pct) }}</td>
                      <td class="n">{{ num(r.filas_error) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-panel>
      } @else {
        <app-sin-datos [mensaje]="dq() === null ? 'Sin dq.json' : 'Cargando…'" />
      }
    </section>
  `,
  styles: `.alto { max-height: 420px; overflow-y: auto; }`,
})
export class Gobierno {
  protected readonly dq = inject(DataService).dq();
  protected readonly num = num; protected readonly pct = pct; protected readonly fecha = fecha;

  protected objetivo(tabla: string, col: string) {
    const corta = tabla.split('.').slice(-1)[0];
    return col && col !== '*' ? `${corta}.${col}` : corta;
  }

  protected readonly opt = computed(() => {
    const t = tema(); const b = base(t);
    const filas = this.dq()?.por_capa_dimension ?? [];
    const dims = [...new Set(filas.map((f) => f.dimension))];
    const capas = [...new Set(filas.map((f) => f.capa))];
    return {
      ...b,
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: number) => `${num(v)} en rojo` },
      legend: { ...b.legend, show: true, data: capas },
      xAxis: { type: 'category', data: dims, ...b.eje, splitLine: { show: false } },
      yAxis: { type: 'value', minInterval: 1, ...b.eje },
      series: capas.map((c, i) => ({
        name: c, type: 'bar', barMaxWidth: 22, barGap: '10%',
        data: dims.map((d) => filas.find((f) => f.capa === c && f.dimension === d)?.en_rojo ?? 0),
        itemStyle: { color: t.serie[i], borderRadius: [4, 4, 0, 0], borderColor: t.superficie, borderWidth: 1 },
      })),
    };
  });
}
