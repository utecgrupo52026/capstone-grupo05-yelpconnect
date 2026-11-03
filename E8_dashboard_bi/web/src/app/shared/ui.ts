import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Tarjeta de indicador: un número protagonista con su contexto. */
@Component({
  selector: 'app-kpi',
  template: `
    <div class="kpi-label">{{ etiqueta() }}</div>
    <div class="kpi-valor">{{ valor() }}</div>
    @if (detalle()) { <div class="kpi-detalle">{{ detalle() }}</div> }
  `,
  host: { class: 'kpi' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Kpi {
  readonly etiqueta = input.required<string>();
  readonly valor = input.required<string>();
  readonly detalle = input<string>();
}

/**
 * Panel de un visual. Cada visual declara a qué requerimiento (sección 7.1 del Documento
 * Formal) y a qué stakeholder responde: es la Definition of Done de E8.
 */
@Component({
  selector: 'app-panel',
  template: `
    <header>
      <h2>{{ titulo() }}</h2>
      @if (req() || stakeholder()) {
        <p class="stakeholder">
          @if (req()) { <span class="req">{{ req() }}</span> }
          @if (stakeholder()) { Responde a: {{ stakeholder() }} }
        </p>
      }
    </header>
    <ng-content />
  `,
  host: { class: 'panel' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Panel {
  readonly titulo = input.required<string>();
  readonly stakeholder = input<string>();
  readonly req = input<string>();
}

/** Estado de carga / ausencia de datos. */
@Component({
  selector: 'app-sin-datos',
  template: `<p class="sin-datos">{{ mensaje() }}</p>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SinDatos {
  readonly mensaje = input('Cargando…');
}

/** Prioridad de investigación: color de estado SIEMPRE acompañado de etiqueta. */
@Component({
  selector: 'app-prioridad',
  template: `@if (p()) { <span class="chip" [class]="'chip ' + p()!.toLowerCase()"><span class="punto"></span>{{ p() }}</span> } @else { — }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Prioridad {
  readonly p = input<string | null>();
}
