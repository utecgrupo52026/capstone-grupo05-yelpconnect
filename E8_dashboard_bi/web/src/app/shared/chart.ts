import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, viewChild,
} from '@angular/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Import selectivo: solo lo que usa el dashboard (mantiene el bundle liviano)
echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent,
  MarkLineComponent, CanvasRenderer]);

@Component({
  selector: 'app-chart',
  template: `<div #lienzo class="lienzo" [style.height.px]="alto()" role="img" [attr.aria-label]="descripcion()"></div>`,
  styles: `.lienzo { width: 100%; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chart {
  readonly opciones = input.required<echarts.EChartsCoreOption>();
  readonly alto = input(280);
  readonly descripcion = input('Gráfico');

  private readonly lienzo = viewChild.required<ElementRef<HTMLDivElement>>('lienzo');
  private grafico?: echarts.ECharts;

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const el = this.lienzo().nativeElement;
      if (!this.grafico) {
        this.grafico = echarts.init(el);
        const ro = new ResizeObserver(() => this.grafico?.resize());
        ro.observe(el);
        destroyRef.onDestroy(() => { ro.disconnect(); this.grafico?.dispose(); });
      }
      this.grafico.setOption(this.opciones(), { notMerge: true });
    });
  }
}
