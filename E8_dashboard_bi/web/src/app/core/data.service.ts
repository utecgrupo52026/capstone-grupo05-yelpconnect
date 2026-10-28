import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, of, shareReplay } from 'rxjs';
import {
  BusinessKpi, Dq, Meta, MlResumen, MlTop, Monthly, Overview, QueueItem, RuleKpi,
} from './models';

/** Estado de carga de un JSON: undefined = cargando, null = no disponible. */
export type Carga<T> = Signal<T | null | undefined>;

/**
 * Lee el snapshot estático publicado en /data. El dashboard nunca se conecta a
 * Databricks: solo consume lo que exportaron los scripts de local/.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<unknown>>();

  private cargar<T>(nombre: string): Carga<T> {
    if (!this.cache.has(nombre)) {
      this.cache.set(nombre, this.http.get<T>(`data/${nombre}.json`).pipe(
        catchError(() => of(null)),
        shareReplay(1),
      ));
    }
    return toSignal(this.cache.get(nombre) as Observable<T | null>);
  }

  meta = () => this.cargar<Meta>('meta');
  overview = () => this.cargar<Overview>('overview');
  monthly = () => this.cargar<Monthly[]>('monthly');
  rules = () => this.cargar<RuleKpi[]>('rules');
  businesses = () => this.cargar<BusinessKpi[]>('businesses');
  queue = () => this.cargar<QueueItem[]>('queue');
  dq = () => this.cargar<Dq>('dq');
  mlResumen = () => this.cargar<MlResumen>('ml_resumen');
  mlTop = () => this.cargar<MlTop[]>('ml_top');
}
