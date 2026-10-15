import { Routes } from '@angular/router';

// Cada página se carga bajo demanda (lazy) para mantener liviano el bundle inicial
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'resumen' },
  { path: 'resumen', title: 'Resumen T&S · YelpConnect', loadComponent: () => import('./pages/resumen').then((m) => m.Resumen) },
  { path: 'reglas', title: 'Reglas · YelpConnect', loadComponent: () => import('./pages/reglas').then((m) => m.Reglas) },
  { path: 'negocios', title: 'Negocios · YelpConnect', loadComponent: () => import('./pages/negocios').then((m) => m.Negocios) },
  { path: 'cola', title: 'Cola de investigación · YelpConnect', loadComponent: () => import('./pages/cola').then((m) => m.Cola) },
  { path: 'ml', title: 'Reglas vs ML · YelpConnect', loadComponent: () => import('./pages/ml').then((m) => m.Ml) },
  { path: 'gobierno', title: 'Calidad de datos · YelpConnect', loadComponent: () => import('./pages/gobierno').then((m) => m.Gobierno) },
  { path: '**', redirectTo: 'resumen' },
];
