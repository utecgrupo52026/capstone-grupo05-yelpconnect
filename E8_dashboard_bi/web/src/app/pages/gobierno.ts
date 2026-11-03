import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Certificacion, EstadoChequeo } from '../core/models';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { fecha, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Kpi, Panel, SinDatos } from '../shared/ui';

/** Fila de la tabla de trazabilidad (REQ-07). */
interface Version { componente: string; version: string; id: string; fecha: string | null; detalle?: string }

const VEREDICTO: Record<Certificacion['veredicto'], { texto: string; clase: string }> = {
  CERTIFICADA: { texto: 'Certificada', clase: 'ok' },
  CON_OBSERVACIONES: { texto: 'Certificada con observaciones', clase: 'alerta' },
  NO_CERTIFICADA: { texto: 'No certificada', clase: 'critico' },
  NO_VERIFICABLE: { texto: 'No verificable', clase: 'neutro' },
};
const ESTADO: Record<EstadoChequeo, { texto: string; clase: string }> = {
  ok: { texto: 'OK', clase: 'ok' }, alerta: { texto: 'Alerta', clase: 'alerta' }, falla: { texto: 'Falla', clase: 'critico' },
  info: { texto: 'Info', clase: 'neutro' }, sin_datos: { texto: 'Sin datos', clase: 'neutro' },
};

@Component({
  selector: 'app-gobierno',
  imports: [Chart, Kpi, Panel, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Calidad y versiones</h1>
        <p>¿Qué calidad y cobertura tuvo la corrida que alimentó el dashboard, y qué versión de regla, pipeline y run
           produjo cada KPI? Es la vista para la CDO y para auditar o reproducir un resultado.</p>
      </div>

      @if (dq(); as d) {
        <app-panel titulo="Certificación de la corrida" req="REQ-06"
                   stakeholder="Laura Hernández / Mei Lin · ¿el resultado puede considerarse certificado?">
          @if (d.certificacion; as c) {
            <p class="veredicto">
              <span class="chip grande" [class]="'chip grande ' + veredicto(c).clase"><span class="punto"></span>{{ veredicto(c).texto }}</span>
              @if (run(); as r) {
                <span class="nota" style="margin:0">Run <span class="mono">{{ r.evaluation_run_id }}</span> · inició {{ fecha(r.started_at) }}</span>
              }
            </p>
            <div class="tabla-scroll">
              <table>
                <thead><tr><th>Estado</th><th>Chequeo</th><th>Detalle</th></tr></thead>
                <tbody>
                  @for (ch of c.chequeos; track ch.id) {
                    <tr>
                      <td><span class="chip" [class]="'chip ' + estado(ch.estado).clase"><span class="punto"></span>{{ estado(ch.estado).texto }}</span></td>
                      <td>{{ ch.nombre }}</td>
                      <td class="texto">{{ ch.detalle }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="nota">{{ c.criterio }}</p>
          } @else {
            <p class="nota">Este snapshot es anterior a la certificación por run. Vuelve a ejecutar
              <span class="mono">local/exportar_gold.py</span> para ligar la ejecución DQ al run y calcular el veredicto.</p>
          }
        </app-panel>

        <div class="kpis">
          <app-kpi etiqueta="Reglas evaluadas" [valor]="num(d.total_reglas)"
                   [detalle]="d.vinculo === 'run' ? 'Ejecución vigente al iniciar el run' : 'Última ejecución ' + fecha(d.ultima_ejecucion)" />
          <app-kpi etiqueta="Reglas que cumplen" [valor]="num(d.reglas_ok)" [detalle]="pct(d.total_reglas ? 100 * d.reglas_ok / d.total_reglas : null)" />
          <app-kpi etiqueta="Reglas en rojo" [valor]="num(d.reglas_en_rojo)" detalle="Bajo su umbral" />
          <app-kpi etiqueta="Cumplimiento promedio" [valor]="pct(d.pct_cumplimiento_promedio)" />
          @if (d.certificacion?.cobertura_evaluacion_pct != null) {
            <app-kpi etiqueta="Cobertura de evaluación" [valor]="pct(d.certificacion!.cobertura_evaluacion_pct)" detalle="Reseñas con todas las reglas evaluables" />
          }
        </div>

        <app-panel titulo="Versiones que produjeron estos KPI" req="REQ-07" stakeholder="Mei Lin (Data Science) · reproducir el análisis y auditar cambios">
          <div class="tabla-scroll">
            <table>
              <thead><tr><th>Componente</th><th>Versión</th><th>Identificador</th><th>Fecha</th></tr></thead>
              <tbody>
                @for (v of versiones(); track v.componente + v.id) {
                  <tr>
                    <td>{{ v.componente }} @if (v.detalle) { <span class="texto">· {{ v.detalle }}</span> }</td>
                    <td class="mono">{{ v.version }}</td>
                    <td class="mono">{{ v.id }}</td>
                    <td class="texto">{{ fecha(v.fecha) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (!meta()?.versiones) {
            <p class="nota">Este snapshot solo trae el run y la fecha de corte. Vuelve a ejecutar
              <span class="mono">local/exportar_gold.py</span> para exportar las versiones de pipeline, modelo de riesgo y reglas.</p>
          }
        </app-panel>

        <app-panel titulo="Reglas en rojo por dimensión y capa" req="REQ-06" stakeholder="Laura Hernández (CDO) · dónde invertir en calidad">
          <app-chart [opciones]="opt()" [alto]="240" descripcion="Reglas en rojo por dimensión de calidad y capa" />
        </app-panel>

        <app-panel [titulo]="d.vinculo === 'run' ? 'Reglas de calidad (ejecución del run)' : 'Reglas de calidad (última ejecución)'"
                   req="REQ-06" stakeholder="Data Stewards · remediación">
          <div class="tabla-scroll alto">
            <table>
              <thead><tr>
                <th>Estado</th><th>Regla</th><th>Capa</th><th>Dimensión</th><th>Criticidad</th><th>Objetivo</th>
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
                    <td>{{ r.criticidad }}</td>
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
  styles: `
    .alto { max-height: 420px; overflow-y: auto; }
    .veredicto { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 10px; }
    .chip.grande { font-size: 14px; padding: 3px 12px; }
  `,
})
export class Gobierno {
  private readonly data = inject(DataService);
  protected readonly dq = this.data.dq();
  protected readonly meta = this.data.meta();
  private readonly reglas = this.data.rules();
  private readonly ml = this.data.mlResumen();
  protected readonly num = num; protected readonly pct = pct; protected readonly fecha = fecha;

  protected readonly run = computed(() => this.meta()?.versiones?.run ?? null);
  protected veredicto(c: Certificacion) { return VEREDICTO[c.veredicto] ?? VEREDICTO.NO_VERIFICABLE; }
  protected estado(e: EstadoChequeo) { return ESTADO[e] ?? ESTADO.sin_datos; }

  protected objetivo(tabla: string, col: string) {
    const corta = tabla.split('.').slice(-1)[0];
    return col && col !== '*' ? `${corta}.${col}` : corta;
  }

  /** REQ-07: cada componente que interviene en un KPI, con su versión e identificador. */
  protected readonly versiones = computed<Version[]>(() => {
    const m = this.meta();
    if (!m) return [];
    const v = m.versiones;
    const filas: Version[] = [];
    const r = v?.run;
    filas.push({
      componente: 'Run de evaluación T&S', detalle: r?.pipeline_name ?? undefined,
      version: r?.pipeline_version ?? '—', id: r?.evaluation_run_id ?? m.evaluation_run_id, fecha: r?.started_at ?? null,
    });
    if (r) filas.push({ componente: 'Features Silver', detalle: 'dataset_version', version: '—', id: r.dataset_version ?? '—', fecha: null });
    for (const x of v?.riesgo ?? []) {
      filas.push({ componente: 'Modelo de riesgo', detalle: `${num(x.reviews)} reseñas`, version: x.risk_model_version ?? '—',
        id: x.risk_consolidation_id ?? '—', fecha: null });
    }
    for (const x of this.reglas() ?? []) {
      if (!x.rule_version_id) continue;
      filas.push({ componente: `Regla ${x.rule_id}`, detalle: `${x.rule_name}${x.rule_status ? ' · ' + x.rule_status : ''}`,
        version: x.rule_version ?? '—', id: x.rule_version_id, fecha: x.valid_from ?? null });
    }
    for (const e of v?.dq ?? []) {
      filas.push({ componente: `Calidad DQ ${e.capa}`, detalle: `${num(e.reglas)} reglas`, version: '—', id: e.ejecucion_id, fecha: e.ejecucion_ts });
    }
    const ml = this.ml();
    if (ml) {
      filas.push({ componente: 'Modelo ML de anomalías', detalle: 'experimental, fuera del score (ADR-12)',
        version: ml.modelo.version, id: ml.modelo.algoritmo, fecha: ml.modelo.entrenado_en });
    }
    filas.push({ componente: 'Snapshot del dashboard', detalle: m.modo, version: '—', id: 'meta.json', fecha: m.generado_en });
    return filas;
  });

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
