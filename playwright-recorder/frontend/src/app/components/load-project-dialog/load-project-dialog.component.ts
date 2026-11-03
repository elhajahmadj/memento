import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-load-project-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Open Existing Solution</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <p class="hint">
          The browser cannot show a native file dialog for arbitrary disk paths. Paste the absolute path
          to the <span class="mono">.sln</span> file.
        </p>
        <mat-form-field appearance="outline">
          <mat-label>Path to .sln file</mat-label>
          <input matInput formControlName="solutionPath" placeholder="C:/Projects/MyAutomation/MyAutomation.sln" />
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="ref.close()">Cancel</button>
        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid">Open</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [`
    .hint { color: var(--text-dim); font-size: 12px; line-height: 1.5; margin-top: 0; }
    .mono { font-family: 'JetBrains Mono', monospace; color: var(--accent-2); }
  `]
})
export class LoadProjectDialogComponent {
  ref = inject(MatDialogRef<LoadProjectDialogComponent>);
  private fb = inject(FormBuilder);

  form = this.fb.nonNullable.group({
    solutionPath: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.ref.close(this.form.getRawValue().solutionPath);
  }
}
