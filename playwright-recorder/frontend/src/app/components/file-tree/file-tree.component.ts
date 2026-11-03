import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConfirmDialogComponent } from '../../components/select-class-dialog/confirm-dialog.component';
import { TextPromptDialogComponent } from '../../components/select-class-dialog/text-prompt-dialog.component';
import { ProjectService } from '../../services/project.service';
import { FileTreeService } from '../../services/file-tree.service';
import { TreeNode } from '../../models/tree-node.model';

interface FlatNode {
  node: TreeNode;
  level: number;
  expanded: boolean;
}

@Component({
  selector: 'app-file-tree',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatMenuModule, MatButtonModule],
  template: `
    <div class="header">
      <span>EXPLORER</span>
      <button mat-icon-button (click)="refresh()" title="Refresh"><mat-icon>refresh</mat-icon></button>
    </div>
    <div class="tree" *ngIf="project.tree() as root">
      <ng-container *ngFor="let row of flatten(root); trackBy: trackPath">
        <div class="row"
             [style.padding-left.px]="8 + row.level * 14"
             (click)="onRowClick(row)"
             (contextmenu)="openMenu($event, row)">
          <mat-icon class="chev" *ngIf="row.node.type === 'folder'">
            {{ expanded.has(row.node.path) ? 'expand_more' : 'chevron_right' }}
          </mat-icon>
          <mat-icon class="ico" [ngClass]="iconClass(row.node)">{{ icon(row.node) }}</mat-icon>
          <span class="name">{{ row.node.name }}</span>
        </div>
      </ng-container>
    </div>

    <div #menuAnchor [style.position]="'fixed'" [style.left.px]="menuX" [style.top.px]="menuY"></div>
    <button mat-icon-button [matMenuTriggerFor]="ctxMenu" #trigger="matMenuTrigger" style="display:none"></button>

    <mat-menu #ctxMenu="matMenu">
      <ng-container *ngIf="contextNode() as ctx">
        <ng-container *ngIf="ctx.type === 'folder'">
          <button mat-menu-item (click)="addFolder(ctx)"><mat-icon>create_new_folder</mat-icon>New Folder</button>
          <button mat-menu-item (click)="addClass(ctx)"><mat-icon>note_add</mat-icon>New C# Class</button>
          <button mat-menu-item (click)="rename(ctx)"><mat-icon>drive_file_rename_outline</mat-icon>Rename</button>
          <button mat-menu-item (click)="delete(ctx)"><mat-icon>delete</mat-icon>Delete</button>
        </ng-container>
        <ng-container *ngIf="ctx.type === 'file'">
          <button mat-menu-item (click)="open(ctx)"><mat-icon>open_in_new</mat-icon>Open</button>
          <button mat-menu-item (click)="rename(ctx)"><mat-icon>drive_file_rename_outline</mat-icon>Rename</button>
          <button mat-menu-item (click)="delete(ctx)"><mat-icon>delete</mat-icon>Delete</button>
        </ng-container>
      </ng-container>
    </mat-menu>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 8px; font-size: 11px; letter-spacing: 0.08em; color: var(--text-dim);
      border-bottom: 1px solid var(--border);
    }
    .header button { width: 28px; height: 28px; line-height: 28px; }
    .header mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .tree { padding: 4px 0; user-select: none; }
    .row {
      display: flex; align-items: center; gap: 4px; height: 24px;
      cursor: pointer; font-size: 13px;
    }
    .row:hover { background: var(--bg-2); }
    .chev { font-size: 16px; width: 16px; height: 16px; color: var(--text-dim); }
    .ico { font-size: 16px; width: 16px; height: 16px; }
    .ico.folder { color: var(--warning); }
    .ico.cs { color: var(--accent); }
    .ico.json { color: var(--success); }
    .ico.sln { color: var(--primary); }
    .name { font-size: 13px; }
  `]
})
export class FileTreeComponent implements OnInit {
  @Output() fileSelected = new EventEmitter<string>();

  readonly project = inject(ProjectService);
  private files = inject(FileTreeService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  readonly expanded = new Set<string>();
  readonly contextNode = signal<TreeNode | null>(null);
  menuX = 0; menuY = 0;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.project.refreshTree().subscribe(tree => {
      this.expanded.add(tree.path);
    });
  }

  flatten(root: TreeNode): FlatNode[] {
    const out: FlatNode[] = [];
    const walk = (n: TreeNode, level: number) => {
      out.push({ node: n, level, expanded: this.expanded.has(n.path) });
      if (n.type === 'folder' && this.expanded.has(n.path)) {
        for (const c of n.children) walk(c, level + 1);
      }
    };
    walk(root, 0);
    return out;
  }

  trackPath = (_: number, row: FlatNode) => row.node.path;

  onRowClick(row: FlatNode): void {
    if (row.node.type === 'folder') {
      this.expanded.has(row.node.path) ? this.expanded.delete(row.node.path) : this.expanded.add(row.node.path);
    } else {
      this.fileSelected.emit(row.node.path);
    }
  }

  openMenu(ev: MouseEvent, row: FlatNode): void {
    ev.preventDefault();
    this.contextNode.set(row.node);
    this.menuX = ev.clientX; this.menuY = ev.clientY;
    // We use the standard click sequence via DOM trigger
    setTimeout(() => {
      const trigger = document.querySelector('[matmenutriggerfor]') as HTMLButtonElement | null;
      trigger?.click();
    });
  }

  icon(n: TreeNode): string {
    if (n.type === 'folder') return this.expanded.has(n.path) ? 'folder_open' : 'folder';
    if (n.extension === 'cs') return 'code';
    if (n.extension === 'sln') return 'workspaces';
    if (n.extension === 'csproj') return 'inventory_2';
    if (n.extension === 'json') return 'data_object';
    return 'description';
  }

  iconClass(n: TreeNode): Record<string, boolean> {
    return {
      folder: n.type === 'folder',
      cs: n.extension === 'cs',
      json: n.extension === 'json',
      sln: n.extension === 'sln' || n.extension === 'csproj'
    };
  }

  open(n: TreeNode): void { this.fileSelected.emit(n.path); }

  addFolder(parent: TreeNode): void {
    const ref = this.dialog.open(TextPromptDialogComponent, {
      data: { title: 'New Folder', label: 'Folder name', initial: 'NewFolder' }, width: '400px'
    });
    ref.afterClosed().subscribe(name => {
      if (!name) return;
      const path = `${parent.path}/${name}`.replace(/\\/g, '/');
      this.files.createFolder(path).subscribe({
        next: () => { this.snack.open(`Created folder ${name}`, 'OK', { duration: 2000 }); this.refresh(); },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 4000 })
      });
    });
  }

  addClass(parent: TreeNode): void {
    const ref = this.dialog.open(TextPromptDialogComponent, {
      data: { title: 'New C# Class', label: 'File name', initial: 'NewClass.cs' }, width: '400px'
    });
    ref.afterClosed().subscribe(name => {
      if (!name) return;
      const finalName = name.endsWith('.cs') ? name : `${name}.cs`;
      const className = finalName.replace(/\.cs$/, '');
      const ns = this.project.current()?.defaultNamespace ?? 'Tests';
      const stub = `namespace ${ns}\n{\n    public class ${className}\n    {\n    }\n}\n`;
      const path = `${parent.path}/${finalName}`.replace(/\\/g, '/');
      this.files.createFile(path, stub).subscribe({
        next: () => { this.snack.open(`Created ${finalName}`, 'OK', { duration: 2000 }); this.refresh(); this.fileSelected.emit(path); },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 4000 })
      });
    });
  }

  rename(node: TreeNode): void {
    const ref = this.dialog.open(TextPromptDialogComponent, {
      data: { title: `Rename ${node.type}`, label: 'New name', initial: node.name }, width: '400px'
    });
    ref.afterClosed().subscribe(name => {
      if (!name || name === node.name) return;
      const parentDir = node.path.substring(0, node.path.length - node.name.length).replace(/[\\/]$/, '');
      const newPath = `${parentDir}/${name}`.replace(/\\/g, '/');
      const obs = node.type === 'file'
        ? this.files.renameFile(node.path, newPath)
        : this.files.renameFolder(node.path, newPath);
      obs.subscribe({
        next: () => { this.snack.open(`Renamed to ${name}`, 'OK', { duration: 2000 }); this.refresh(); },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 4000 })
      });
    });
  }

  delete(node: TreeNode): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete ${node.type}`,
        message: `Are you sure you want to delete "${node.name}"? This cannot be undone.`,
        confirmText: 'Delete'
      },
      width: '420px'
    });
    ref.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      const obs = node.type === 'file' ? this.files.deleteFile(node.path) : this.files.deleteFolder(node.path);
      obs.subscribe({
        next: () => { this.snack.open(`Deleted ${node.name}`, 'OK', { duration: 2000 }); this.refresh(); },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 4000 })
      });
    });
  }
}
