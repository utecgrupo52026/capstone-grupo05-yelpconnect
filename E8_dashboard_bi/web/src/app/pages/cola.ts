import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../core/data.service';
import { dec, num } from '../shared/format';
import { Panel, Prioridad, SinDatos } from '../shared/ui';

type Filtro = 'todas' | 'P1' | 'P2' | 'P3';
const PAGINA = 50;

@Component({
  selector: 'app-cola',
  imports: [Panel, Prioridad, SinDatos],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pagina">
      <div class="intro">
        <h1>Cola de investigación</h1>
        <p>Las reseñas de mayor riesgo del último run, ordenadas por score. Los usuarios se muestran seudonimizados
           y el texto se trunca a 200 caracteres porque este sitio es público.</p>
      </div>

      <app-panel titulo="Reseñas candidatas a revisión" stakeholder="Trust & Safety · analistas de moderación">
        <div class="filtros">
          <div class="segmentado" role="group" aria-label="Prioridad">
            @for (f of filtros; track f) {
              <button type="button" [class.activo]="filtro() === f" (click)="filtro.set(f); limite.set(pagina)">
                {{ f === 'todas' ? 'Todas' : f }}
              </button>
            }
          </div>
          <input type="search" placeholder="Buscar negocio, regla o review_id…" [value]="busqueda()"
                 (input)="busqueda.set($any($event.target).value); limite.set(pagina)" aria-label="Buscar" />
          <span class="nota" style="margin:0">{{ num(filtradas().length) }} reseñas</span>
        </div>

        @if (cola(); as _) {
          <div class="tabla-scroll">
            <table>
              <thead><tr>
                <th>Prioridad</th><th class="n">Score</th><th>Reglas activadas</th><th>Negocio</th>
                <th>Fecha</th><th class="n">★</th><th>Usuario</th><th>Texto</th><th>Estado</th>
              </tr></thead>
              <tbody>
                @for (r of visibles(); track r.review_id) {
                  <tr>
                    <td><app-prioridad [p]="r.investigation_priority" /></td>
                    <td class="n">{{ dec(r.weighted_risk_score, 2) }}</td>
                    <td>@for (g of reglas(r.signal_rules_csv); track g) { <span class="regla">{{ g }}</span> }</td>
                    <td>{{ r.business_name }}</td>
                    <td class="mono">{{ r.review_date }}</td>
                    <td class="n">{{ r.stars }}</td>
                    <td class="mono">{{ r.user_hash }}</td>
                    <td class="texto">{{ r.text_preview }}</td>
                    <td class="texto">{{ r.investigation_status }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="9" class="sin-datos">Sin resultados para el filtro.</td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (filtradas().length > limite()) {
            <p style="text-align:center"><button type="button" class="mas" (click)="limite.set(limite() + pagina)">Ver más</button></p>
          }
        } @else {
          <app-sin-datos [mensaje]="cola() === null ? 'Sin queue.json' : 'Cargando…'" />
        }
      </app-panel>
    </section>
  `,
  styles: `.mas { font: inherit; padding: 6px 16px; border-radius: 8px; border: 1px solid var(--border);
    background: transparent; color: var(--text-primary); cursor: pointer; }`,
})
export class Cola {
  protected readonly cola = inject(DataService).queue();
  protected readonly num = num; protected readonly dec = dec;
  protected readonly filtros: Filtro[] = ['todas', 'P1', 'P2', 'P3'];
  protected readonly pagina = PAGINA;

  protected readonly filtro = signal<Filtro>('todas');
  protected readonly busqueda = signal('');
  protected readonly limite = signal(PAGINA);

  protected readonly filtradas = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    return (this.cola() ?? []).filter((r) =>
      (this.filtro() === 'todas' || r.investigation_priority === this.filtro()) &&
      (!q || [r.business_name, r.signal_rules_csv, r.review_id].some((v) => v?.toLowerCase().includes(q))));
  });
  protected readonly visibles = computed(() => this.filtradas().slice(0, this.limite()));

  protected reglas(csv: string | null) { return csv ? csv.split(',').filter(Boolean) : []; }
}
