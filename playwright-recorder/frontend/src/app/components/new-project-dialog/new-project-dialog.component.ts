import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { NewProjectRequest } from '../../models/project.model';

@Component({
  selector: 'app-new-project-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Create New Solution</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Solution name</mat-label>
          <input matInput formControlName="solutionName" placeholder="MyAutomation" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Root directory (absolute path)</mat-label>
          <input matInput formControlName="rootDirectory" placeholder="C:/Projects" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Test project name</mat-label>
          <input matInput formControlName="testProjectName" placeholder="MyAutomation.Tests" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Default namespace</mat-label>
          <input matInput formControlName="defaultNamespace" placeholder="MyAutomation.Tests" />
        </mat-form-field>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="ref.close()">Cancel</button>
        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid">Create</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [`
    mat-dialog-content { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
  `]
})
export class NewProjectDialogComponent {
  ref = inject(MatDialogRef<NewProjectDialogComponent>);
  private fb = inject(FormBuilder);

  form = this.fb.nonNullable.group({
    solutionName: ['', Validators.required],
    rootDirectory: ['', Validators.required],
    testProjectName: ['', Validators.required],
    defaultNamespace: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.ref.close(this.form.getRawValue() as NewProjectRequest);
  }
}
