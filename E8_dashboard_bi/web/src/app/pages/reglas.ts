import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../core/data.service';
import { Chart } from '../shared/chart';
import { dec, esc, num, pct } from '../shared/format';
import { base, tema } from '../shared/tema';
import { Panel, SinDatos } from '../shared/ui';

type Modo = 'reviews' | 'pct';

interface Celda { valor: number | null; texto: string; titulo: string; intensidad: number; diagonal: boolean }

@Component({
  selector: 'app-reglas',
  imports: [Chart, Panel, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Reglas de Trust &amp; Safety</h1>
        <p>¿Qué reglas T&amp;S (R001–R006) se activan con mayor frecuencia y cuáles aparecen juntas? Sirve para revisar
           el comportamiento de las reglas, su redundancia y su cobertura, con la versión del catálogo
           <span class="mono">yelp_gov.evaluation_rule_version</span> que usó el run.</p>
      </div>

      @if (reglas(); as rs) {
        <div class="rejilla">
          <app-panel titulo="Reseñas con señal por regla" req="REQ-04" stakeholder="Mei Lin (Data Science) · frecuencia de activación">
            <app-chart [opciones]="opt()" [alto]="300" descripcion="Cantidad de señales por regla" />
            <p class="nota">Una reseña puede activar varias reglas a la vez.</p>
          </app-panel>

          <app-panel titulo="Reglas que se activan juntas" req="REQ-04" stakeholder="Mei Lin (Data Science) · redundancia entre reglas">
            @if (co(); as c) {
              <div class="filtros">
                <span class="nota" style="margin:0">Mostrar:</span>
                <div class="segmentado" role="group" aria-label="Valor de la matriz">
                  <button type="button" [class.activo]="modo() === 'reviews'" (click)="modo.set('reviews')">Reseñas</button>
                  <button type="button" [class.activo]="modo() === 'pct'" (click)="modo.set('pct')">% de la fila</button>
                </div>
              </div>
              <div class="tabla-scroll">
                <table class="matriz">
                  <caption class="nota">{{ modo() === 'pct'
                    ? 'De las reseñas que activan la regla de la fila, % que también activa la de la columna.'
                    : 'Reseñas que activan ambas reglas. La diagonal es el total de señales de cada regla.' }}</caption>
                  <thead><tr><th></th>@for (r of c.reglas; track r) { <th class="n">{{ r }}</th> }</tr></thead>
                  <tbody>
                    @for (fila of matriz(); track $index; let i = $index) {
                      <tr>
                        <th>{{ c.reglas[i] }}</th>
                        @for (celda of fila; track $index) {
                          <td class="n" [class.diagonal]="celda.diagonal" [attr.title]="celda.titulo"
                              [style.background]="celda.diagonal ? null : fondo(celda.intensidad)">{{ celda.texto }}</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="nota">Color: intensidad del valor fuera de la diagonal. Pasa el cursor por una celda para ver
                el índice de Jaccard (0 = nunca juntas, 1 = siempre juntas).</p>
            } @else {
              <app-sin-datos [mensaje]="co() === null ? 'Sin rule_cooccurrence.json: vuelve a ejecutar local/exportar_gold.py.' : 'Cargando…'" />
            }
          </app-panel>
        </div>

        @if (co()?.combinaciones?.length) {
          <app-panel titulo="Combinaciones de reglas más frecuentes" req="REQ-04" stakeholder="Mei Lin (Data Science) · patrones que se repiten">
            <app-chart [opciones]="optCombos()" [alto]="360" descripcion="Combinaciones exactas de reglas activadas en una misma reseña" />
            <p class="nota">Cada barra es un conjunto exacto de reglas activadas en la misma reseña; «sola» indica que no
              se activó ninguna otra. La etiqueta muestra cuántas de esas reseñas requieren investigación.</p>
          </app-panel>
        }

        <app-panel titulo="Detalle por regla" req="REQ-04 · REQ-07" stakeholder="Mei Lin (Data Science) · cobertura y versión evaluada">
          <div class="tabla-scroll">
            <table>
              <thead><tr>
                <th>Regla</th><th>Tipo</th><th>Versión</th><th class="n">Peso</th><th class="n">Señales</th><th class="n">Tasa</th>
                <th class="n">No evaluables</th><th class="n">Cobertura</th>
              </tr></thead>
              <tbody>
                @for (r of rs; track r.rule_id) {
                  <tr>
                    <td><span class="regla">{{ r.rule_id }}</span> {{ r.rule_name }}</td>
                    <td class="texto">{{ r.rule_type }}</td>
                    <td class="mono">{{ r.rule_version_id ?? '—' }}</td>
                    <td class="n">{{ r.weight == null ? '—' : dec(r.weight, 2) }}</td>
                    <td class="n">{{ num(r.signals) }}</td>
                    <td class="n">{{ pct(r.signal_rate_pct) }}</td>
                    <td class="n">{{ num(r.not_evaluable) }}</td>
                    <td class="n">{{ pct(r.evaluation_coverage_pct) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (!rs[0]?.rule_version_id) {
            <p class="nota">Este snapshot no trae la versión de cada regla: vuelve a ejecutar <span class="mono">local/exportar_gold.py</span>.</p>
          }
        </app-panel>
      } @else {
        <app-sin-datos [mensaje]="reglas() === null ? 'Sin rules.json' : 'Cargando…'" />
      }
    </section>
  `,
  styles: `
    .matriz { width: auto; }
    .matriz caption { caption-side: top; text-align: left; margin: 0 0 6px; }
    .matriz td { min-width: 64px; }
    .matriz td.diagonal { font-weight: 600; background: color-mix(in srgb, var(--text-muted) 12%, transparent); }
    .matriz tbody th { color: var(--text-primary); }
  `,
})
export class Reglas {
  private readonly data = inject(DataService);
  protected readonly reglas = this.data.rules();
  protected readonly co = this.data.cooccurrence();
  protected readonly num = num; protected readonly pct = pct; protected readonly dec = dec;
  protected readonly modo = signal<Modo>('reviews');

  /** Fondo con la intensidad del valor (tope 55 % para que el texto siga legible en claro y oscuro). */
  protected fondo(intensidad: number) {
    return `color-mix(in srgb, var(--series-1) ${Math.round(intensidad * 55)}%, transparent)`;
  }

  protected readonly matriz = computed<Celda[][]>(() => {
    const c = this.co();
    if (!c) return [];
    const par = new Map<string, (typeof c.pares)[number]>();
    for (const p of c.pares) { par.set(`${p.regla_a}|${p.regla_b}`, p); par.set(`${p.regla_b}|${p.regla_a}`, p); }
    const maxPar = Math.max(1, ...c.pares.map((p) => p.reviews));
    const pctModo = this.modo() === 'pct';
    return c.reglas.map((a) => c.reglas.map((b) => {
      if (a === b) {
        const total = c.senales_por_regla[a] ?? 0;
        return { valor: total, texto: pctModo ? '—' : num(total), titulo: `${a}: ${num(total)} señales`, intensidad: 0, diagonal: true };
      }
      const p = par.get(`${a}|${b}`);
      const n = p?.reviews ?? 0;
      const deA = p ? (p.regla_a === a ? p.pct_de_a : p.pct_de_b) : 0;
      const titulo = `${a} y ${b}: ${num(n)} reseñas · ${pct(deA)} de las señales de ${a} · Jaccard ${dec(p?.jaccard ?? 0, 2)}`;
      return pctModo
        ? { valor: deA, texto: pct(deA), titulo, intensidad: deA / 100, diagonal: false }
        : { valor: n, texto: num(n), titulo, intensidad: n / maxPar, diagonal: false };
    }));
  });

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

  protected readonly optCombos = computed(() => {
    const t = tema(); const b = base(t);
    const cs = [...(this.co()?.combinaciones ?? [])].sort((a, c) => a.reviews - c.reviews);
    const nombre = (x: (typeof cs)[number]) => (x.n_reglas === 1 ? `${x.combinacion} sola` : x.combinacion);
    return {
      ...b, grid: { ...b.grid, top: 8, right: 96 },
      tooltip: {
        ...b.tooltip, trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const x = cs[p.dataIndex];
          return `<b>${esc(nombre(x))}</b><br>${num(x.reviews)} reseñas · ${num(x.reviews_for_investigation)} requieren investigación`;
        },
      },
      xAxis: { type: 'value', ...b.eje },
      yAxis: { type: 'category', data: cs.map(nombre), ...b.eje, splitLine: { show: false },
        axisLabel: { ...b.eje.axisLabel, color: t.tinta2 } },
      series: [{
        name: 'Reseñas', type: 'bar', barMaxWidth: 18, data: cs.map((x) => x.reviews),
        itemStyle: { color: t.serie[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.tinta2,
          formatter: (p: { dataIndex: number }) => `${num(cs[p.dataIndex].reviews)} · ${num(cs[p.dataIndex].reviews_for_investigation)} inv.` },
      }],
    };
  });
}
