import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DataService } from './core/data.service';
import { fecha } from './shared/format';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly meta = inject(DataService).meta();
  protected readonly fecha = fecha;
  protected readonly secciones = [
    { ruta: 'resumen', nombre: 'Resumen T&S', grupo: 'Trust & Safety' },
    { ruta: 'reglas', nombre: 'Reglas', grupo: 'Trust & Safety' },
    { ruta: 'negocios', nombre: 'Negocios', grupo: 'Trust & Safety' },
    { ruta: 'cola', nombre: 'Cola de investigación', grupo: 'Trust & Safety' },
    { ruta: 'ml', nombre: 'Reglas vs ML', grupo: 'Machine Learning' },
    { ruta: 'gobierno', nombre: 'Calidad de datos', grupo: 'Gobierno' },
  ];
}
