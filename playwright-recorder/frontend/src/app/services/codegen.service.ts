import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { GeneratedFileResult } from '../models/recording.model';

export interface GenerateTestClassRequest {
  className: string;
  namespace: string;
  folderPath: string;
}

export interface GenerateTestMethodRequest {
  filePath: string;
  methodName: string;
}

@Injectable({ providedIn: 'root' })
export class CodegenService {
  constructor(private http: HttpClient) {}

  generateTestClass(req: GenerateTestClassRequest): Observable<GeneratedFileResult> {
    return this.http.post<GeneratedFileResult>('/api/codegen/testclass', req);
  }

  addTestMethod(req: GenerateTestMethodRequest): Observable<GeneratedFileResult> {
    return this.http.post<GeneratedFileResult>('/api/codegen/testmethod', req);
  }
}
