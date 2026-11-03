import { CommonModule } from '@angular/common';
import { Component, Inject, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatRadioModule } from '@angular/material/radio';
import { ProjectService } from '../../services/project.service';
import { CodegenService } from '../../services/codegen.service';
import { TreeNode } from '../../models/tree-node.model';
import { StartRecordingRequest } from '../../models/recording.model';

interface DialogData { selectedFile: string | null; }

@Component({
  selector: 'app-select-class-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatTabsModule, MatRadioModule
  ],
  template: `
    <h2 mat-dialog-title>Start Recording</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <mat-radio-group formControlName="mode" class="modes">
          <mat-radio-button value="existing">Use existing test class</mat-radio-button>
          <mat-radio-button value="new">Create new test class</mat-radio-button>
        </mat-radio-group>

        <ng-container *ngIf="form.controls.mode.value === 'existing'">
          <mat-form-field appearance="outline">
            <mat-label>Test class file</mat-label>
            <mat-select formControlName="existingClassPath">
              <mat-option *ngFor="let f of testFiles()" [value]="f.path">{{ f.name }}</mat-option>
            </mat-select>
          </mat-form-field>
        </ng-container>

        <ng-container *ngIf="form.controls.mode.value === 'new'">
          <mat-form-field appearance="outline">
            <mat-label>New class name</mat-label>
            <input matInput formControlName="newClassName" placeholder="LoginTests" />
          </mat-form-field>
        </ng-container>

        <mat-form-field appearance="outline">
          <mat-label>Test method name</mat-label>
          <input matInput formControlName="methodName" placeholder="ShouldLogIn" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Start URL</mat-label>
          <input matInput formControlName="startUrl" placeholder="https://example.com" />
        </mat-form-field>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="ref.close()">Cancel</button>
        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid">Start</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [`
    .modes { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    mat-dialog-content { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
  `]
})
export class SelectClassDialogComponent {
  ref = inject(MatDialogRef<SelectClassDialogComponent>);
  private fb = inject(FormBuilder);
  private project = inject(ProjectService);
  private codegen = inject(CodegenService);

  readonly testFiles = computed(() => {
    const tree = this.project.tree();
    if (!tree) return [];
    const out: { name: string; path: string }[] = [];
    const walk = (n: TreeNode) => {
      if (n.type === 'file' && n.extension === 'cs' && n.path.replace(/\\/g, '/').includes('/Tests/')) {
        out.push({ name: n.name, path: n.path });
      }
      if (n.children) for (const c of n.children) walk(c);
    };
    walk(tree);
    return out;
  });

  form = this.fb.nonNullable.group({
    mode: ['existing' as 'existing' | 'new', Validators.required],
    existingClassPath: [''],
    newClassName: [''],
    methodName: ['ShouldDoSomething', Validators.required],
    startUrl: ['https://example.com', Validators.required],
  });

  constructor(@Inject(MAT_DIALOG_DATA) data: DialogData) {
    if (data.selectedFile && data.selectedFile.endsWith('.cs')) {
      this.form.patchValue({ existingClassPath: data.selectedFile });
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const cur = this.project.current();
    if (!cur) return;

    let targetPath = v.existingClassPath;
    if (v.mode === 'new' && v.newClassName) {
      const folder = `${cur.testProjectDirectory}/Tests`.replace(/\\/g, '/');
      const created = await this.codegen.generateTestClass({
        className: v.newClassName,
        namespace: cur.defaultNamespace,
        folderPath: folder,
      }).toPromise();
      targetPath = created!.path;
    }
    if (!targetPath) return;

    const req: StartRecordingRequest = {
      targetClassFilePath: targetPath,
      testMethodName: v.methodName,
      namespace: cur.defaultNamespace,
      pageObjectsFolder: `${cur.testProjectDirectory}/PageObjects`.replace(/\\/g, '/'),
      startUrl: v.startUrl,
    };
    this.ref.close(req);
  }
}
