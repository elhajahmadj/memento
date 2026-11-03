import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

interface PromptData { title: string; label: string; initial?: string; }

@Component({
  selector: 'app-text-prompt-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" style="width:100%;">
        <mat-label>{{ data.label }}</mat-label>
        <input matInput [formControl]="control" (keydown.enter)="submit()" autofocus />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close()">Cancel</button>
      <button mat-flat-button color="primary" (click)="submit()" [disabled]="control.invalid">OK</button>
    </mat-dialog-actions>
  `
})
export class TextPromptDialogComponent {
  control: FormControl<string>;

  constructor(
    public ref: MatDialogRef<TextPromptDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PromptData
  ) {
    this.control = new FormControl<string>(data.initial ?? '', { nonNullable: true, validators: [Validators.required] });
  }

  submit(): void {
    if (this.control.invalid) return;
    this.ref.close(this.control.value.trim());
  }
}
