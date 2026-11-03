import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProjectService } from '../../services/project.service';
import { RecordingService } from '../../services/recording.service';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { CodeViewerComponent } from '../code-viewer/code-viewer.component';
import { BrowserViewComponent } from '../browser-view/browser-view.component';
import { TestManagerComponent } from '../test-manager/test-manager.component';
import { SelectClassDialogComponent } from '../select-class-dialog/select-class-dialog.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule, MatToolbarModule, MatButtonModule, MatIconModule,
    FileTreeComponent, CodeViewerComponent, BrowserViewComponent, TestManagerComponent,
  ],
  template: `
    <mat-toolbar class="topbar">
      <span class="title">{{ project.current()?.solutionName }}</span>
      <span class="dim mono">— {{ project.current()?.solutionPath }}</span>
      <span class="spacer"></span>

      <button mat-stroked-button color="warn" *ngIf="recording.isRecording()" (click)="stopRecording()">
        <mat-icon>stop_circle</mat-icon> Stop Recording
      </button>
      <button mat-stroked-button color="primary" *ngIf="!recording.isRecording()" (click)="startRecording()">
        <mat-icon style="color: var(--recording)">fiber_manual_record</mat-icon>
        Start Recording
      </button>
    </mat-toolbar>

    <div class="layout">
      <aside class="left">
        <app-file-tree (fileSelected)="selectedFile.set($event)"></app-file-tree>
      </aside>

      <section class="center">
        <ng-container *ngIf="recording.isRecording(); else codeView">
          <app-browser-view></app-browser-view>
        </ng-container>
        <ng-template #codeView>
          <app-code-viewer [filePath]="selectedFile()"></app-code-viewer>
        </ng-template>
      </section>

      <aside class="right">
        <app-test-manager (selectFile)="selectedFile.set($event)"></app-test-manager>
      </aside>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100vh; }
    .topbar {
      background: var(--bg-1); color: var(--text); height: 44px; min-height: 44px;
      border-bottom: 1px solid var(--border); padding: 0 12px;
      display: flex; align-items: center; gap: 8px;
    }
    .title { font-weight: 600; font-size: 13px; }
    .dim { color: var(--text-dim); font-size: 12px; }
    .layout {
      flex: 1; display: grid; grid-template-columns: 280px 1fr 320px;
      min-height: 0; min-width: 0;
    }
    .left { background: var(--bg-1); border-right: 1px solid var(--border); overflow: auto; }
    .center { background: var(--bg-0); display: flex; flex-direction: column; min-width: 0; }
    .right { background: var(--bg-1); border-left: 1px solid var(--border); overflow: auto; }
  `]
})
export class MainLayoutComponent {
  readonly project = inject(ProjectService);
  readonly recording = inject(RecordingService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  readonly selectedFile = signal<string | null>(null);

  startRecording(): void {
    const ref = this.dialog.open(SelectClassDialogComponent, {
      width: '520px',
      data: { selectedFile: this.selectedFile() }
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.recording.start(result).subscribe({
        error: err => this.snack.open(`Failed to start: ${err?.error ?? err.message}`, 'Dismiss', { duration: 5000 })
      });
    });
  }

  stopRecording(): void {
    this.recording.stop().subscribe({
      next: generated => {
        const created = generated.filter(g => g.created).length;
        this.snack.open(`Recording stopped — ${generated.length} files written (${created} new).`, 'OK', { duration: 4000 });
        this.project.refreshTree().subscribe();
      },
      error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 5000 })
    });
  }
}
