import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProjectService } from '../../services/project.service';
import { CodegenService } from '../../services/codegen.service';
import { RecordingService } from '../../services/recording.service';
import { TreeNode } from '../../models/tree-node.model';
import { TextPromptDialogComponent } from '../select-class-dialog/text-prompt-dialog.component';

interface TestClassEntry {
  fileName: string;
  filePath: string;
}

@Component({
  selector: 'app-test-manager',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div class="header">
      <span>TEST CLASSES</span>
      <button mat-icon-button (click)="addClass()" title="New Test Class">
        <mat-icon>add</mat-icon>
      </button>
    </div>

    <div class="list" *ngIf="testClasses() as classes">
      <div *ngIf="classes.length === 0" class="empty">
        <mat-icon>science</mat-icon>
        <p>No test classes yet.<br/>Add one to get started.</p>
      </div>

      <div *ngFor="let c of classes" class="entry">
        <div class="row" (click)="selectFile.emit(c.filePath)">
          <mat-icon class="ico">science</mat-icon>
          <span class="name">{{ c.fileName }}</span>
          <span class="spacer"></span>
          <button mat-icon-button (click)="addMethod($event, c)" title="Add Test Method">
            <mat-icon>add</mat-icon>
          </button>
        </div>
      </div>
    </div>

    <div class="recorded" *ngIf="recording.actions().length">
      <div class="header"><span>RECORDED ACTIONS</span></div>
      <div class="action mono" *ngFor="let a of recording.actions()">
        <span class="badge {{ a.actionType }}">{{ a.actionType }}</span>
        <span class="sel">{{ a.selector }}</span>
        <span class="strat">{{ a.selectorStrategy }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 8px; font-size: 11px; letter-spacing: 0.08em; color: var(--text-dim);
      border-bottom: 1px solid var(--border);
    }
    .list { padding: 4px 0; }
    .entry .row {
      display: flex; align-items: center; gap: 6px; height: 30px;
      padding: 0 8px; cursor: pointer;
    }
    .entry .row:hover { background: var(--bg-2); }
    .ico { font-size: 16px; width: 16px; height: 16px; color: var(--accent-2); }
    .name { font-size: 13px; }
    .spacer { flex: 1; }
    .empty { padding: 24px; text-align: center; color: var(--text-dim); }
    .empty mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    .recorded { border-top: 1px solid var(--border); padding-bottom: 12px; }
    .action {
      display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 11px;
      border-bottom: 1px solid var(--bg-2);
    }
    .badge {
      font-size: 10px; padding: 2px 6px; border-radius: 3px; text-transform: uppercase;
      background: var(--bg-3); color: var(--text);
    }
    .badge.click { background: var(--primary); color: #fff; }
    .badge.fill { background: var(--navy); color: #fff; }
    .badge.navigate { background: var(--success-dark); color: #fff; }
    .sel { color: var(--accent-2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .strat { color: var(--text-dim); font-size: 10px; }
  `]
})
export class TestManagerComponent {
  @Output() selectFile = new EventEmitter<string>();

  readonly project = inject(ProjectService);
  readonly recording = inject(RecordingService);
  private codegen = inject(CodegenService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  readonly testClasses = computed<TestClassEntry[]>(() => {
    const tree = this.project.tree();
    if (!tree) return [];
    const out: TestClassEntry[] = [];
    const walk = (node: TreeNode) => {
      if (node.type === 'file' && node.extension === 'cs' && node.path.replace(/\\/g, '/').includes('/Tests/')) {
        out.push({ fileName: node.name, filePath: node.path });
      }
      if (node.children) for (const c of node.children) walk(c);
    };
    walk(tree);
    return out;
  });

  addClass(): void {
    const cur = this.project.current();
    if (!cur) return;
    const ref = this.dialog.open(TextPromptDialogComponent, {
      data: { title: 'New Test Class', label: 'Class name', initial: 'LoginTests' }, width: '400px'
    });
    ref.afterClosed().subscribe(name => {
      if (!name) return;
      const folder = `${cur.testProjectDirectory}/Tests`.replace(/\\/g, '/');
      this.codegen.generateTestClass({ className: name, namespace: cur.defaultNamespace, folderPath: folder }).subscribe({
        next: r => {
          this.snack.open(`Created ${name}.cs`, 'OK', { duration: 2000 });
          this.project.refreshTree().subscribe();
          this.selectFile.emit(r.path);
        },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 4000 })
      });
    });
  }

  addMethod(ev: Event, c: TestClassEntry): void {
    ev.stopPropagation();
    const ref = this.dialog.open(TextPromptDialogComponent, {
      data: { title: 'New Test Method', label: 'Method name', initial: 'ShouldDoSomething' }, width: '400px'
    });
    ref.afterClosed().subscribe(name => {
      if (!name) return;
      this.codegen.addTestMethod({ filePath: c.filePath, methodName: name }).subscribe({
        next: () => {
          this.snack.open(`Added method ${name}`, 'OK', { duration: 2000 });
          this.selectFile.emit(c.filePath);
        },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 4000 })
      });
    });
  }
}
