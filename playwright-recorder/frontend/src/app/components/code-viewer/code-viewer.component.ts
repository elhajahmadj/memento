import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FileTreeService } from '../../services/file-tree.service';

@Component({
  selector: 'app-code-viewer',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="bar">
      <mat-icon class="ico">code</mat-icon>
      <span class="path mono">{{ filePath || 'No file selected' }}</span>
      <span class="spacer"></span>
      <button mat-icon-button *ngIf="content()" (click)="copy()" title="Copy">
        <mat-icon>content_copy</mat-icon>
      </button>
    </div>

    <div class="viewer">
      <ng-container *ngIf="filePath; else placeholder">
        <pre class="code mono"><code>{{ content() }}</code></pre>
      </ng-container>
      <ng-template #placeholder>
        <div class="empty">
          <mat-icon>description</mat-icon>
          <p>Select a file from the explorer to view its contents.</p>
        </div>
      </ng-template>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .bar {
      display: flex; align-items: center; gap: 6px; padding: 0 12px;
      height: 36px; background: var(--bg-1); border-bottom: 1px solid var(--border);
    }
    .ico { font-size: 18px; width: 18px; height: 18px; color: var(--accent-2); }
    .path { color: var(--text); font-size: 12px; }
    .spacer { flex: 1; }
    .viewer { flex: 1; overflow: auto; background: var(--bg-0); }
    .code {
      margin: 0; padding: 16px; font-size: 13px; line-height: 1.55;
      color: var(--text); white-space: pre; min-height: 100%;
    }
    .empty {
      height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: var(--text-dim); gap: 8px;
    }
    .empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }
  `]
})
export class CodeViewerComponent implements OnChanges {
  @Input() filePath: string | null = null;
  readonly content = signal<string>('');
  private files = inject(FileTreeService);
  private snack = inject(MatSnackBar);

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.filePath) { this.content.set(''); return; }
    this.files.read(this.filePath).subscribe({
      next: r => this.content.set(r.content),
      error: () => this.content.set('// Unable to read file.')
    });
  }

  copy(): void {
    navigator.clipboard.writeText(this.content());
    this.snack.open('Copied to clipboard', 'OK', { duration: 1500 });
  }
}
