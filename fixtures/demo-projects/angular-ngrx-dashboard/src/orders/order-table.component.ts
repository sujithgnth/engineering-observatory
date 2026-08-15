import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "app-order-table",
  template: `<ul>
    <li *ngFor="let order of orders()">{{ order.id }}</li>
  </ul>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderTableComponent {
  readonly orders = input.required<Array<{ id: string }>>();
}
