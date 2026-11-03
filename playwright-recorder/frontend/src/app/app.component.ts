import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ProjectService } from './services/project.service';
import { ProjectSelectionComponent } from './components/project-selection/project-selection.component';
import { NewProjectDialogComponent } from './components/new-project-dialog/new-project-dialog.component';
import { LoadProjectDialogComponent } from './components/load-project-dialog/load-project-dialog.component';
import { MainLayoutComponent } from './components/main-layout/main-layout.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatSnackBarModule, ProjectSelectionComponent, MainLayoutComponent],
  template: `
    <ng-container *ngIf="!project.current(); else workspace">
      <app-project-selection
        (newProject)="openNewProject()"
        (loadProject)="openLoadProject()">
      </app-project-selection>
    </ng-container>
    <ng-template #workspace>
      <app-main-layout></app-main-layout>
    </ng-template>
  `,
  styles: [`:host { display: block; height: 100vh; }`]
})
export class AppComponent {
  readonly project = inject(ProjectService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  openNewProject(): void {
    const ref = this.dialog.open(NewProjectDialogComponent, { width: '560px', disableClose: false });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.project.createNew(result).subscribe({
        next: info => {
          this.snack.open(`Created solution "${info.solutionName}"`, 'OK', { duration: 3000 });
          this.project.refreshTree().subscribe();
        },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 5000 })
      });
    });
  }

  openLoadProject(): void {
    const ref = this.dialog.open(LoadProjectDialogComponent, { width: '560px' });
    ref.afterClosed().subscribe(path => {
      if (!path) return;
      this.project.load({ solutionPath: path }).subscribe({
        next: info => {
          this.snack.open(`Loaded "${info.solutionName}"`, 'OK', { duration: 3000 });
          this.project.refreshTree().subscribe();
        },
        error: err => this.snack.open(`Failed: ${err?.error ?? err.message}`, 'Dismiss', { duration: 5000 })
      });
    });
  }
}
