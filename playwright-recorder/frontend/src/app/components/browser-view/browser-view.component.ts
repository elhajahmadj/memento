import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RecordingService } from '../../services/recording.service';

@Component({
  selector: 'app-browser-view',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="bar">
      <mat-icon class="rec">fiber_manual_record</mat-icon>
      <span>Recording — live browser preview</span>
      <span class="spacer"></span>
      <span class="dim">{{ recording.actions().length }} actions captured</span>
    </div>

    <div class="canvas">
      <img *ngIf="recording.latestFrame() as frame; else loading"
           [src]="frame" alt="Live browser preview" />
      <ng-template #loading>
        <div class="empty">
          <mat-icon>cast</mat-icon>
          <p>Waiting for first browser frame…</p>
        </div>
      </ng-template>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .bar {
      display: flex; align-items: center; gap: 8px; padding: 0 12px;
      height: 36px; background: var(--bg-1); border-bottom: 1px solid var(--border);
    }
    .rec { color: var(--recording); animation: pulse 1.4s infinite; font-size: 16px; width: 16px; height: 16px; }
    .dim { color: var(--text-dim); font-size: 12px; }
    .spacer { flex: 1; }
    .canvas { flex: 1; display: flex; align-items: center; justify-content: center; background: var(--bg-0); overflow: auto; }
    img { max-width: 100%; max-height: 100%; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
    .empty { color: var(--text-dim); display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  `]
})
export class BrowserViewComponent {
  readonly recording = inject(RecordingService);
}
