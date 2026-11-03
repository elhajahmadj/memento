import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface FileContent { path: string; content: string; }

@Injectable({ providedIn: 'root' })
export class FileTreeService {
  constructor(private http: HttpClient) {}

  read(path: string): Observable<FileContent> {
    return this.http.get<FileContent>('/api/files/content', { params: new HttpParams().set('path', path) });
  }

  createFile(path: string, content = ''): Observable<void> {
    return this.http.post<void>('/api/files/create', { path, content });
  }

  updateFile(path: string, content: string): Observable<void> {
    return this.http.put<void>('/api/files/update', { path, content });
  }

  deleteFile(path: string): Observable<void> {
    return this.http.delete<void>('/api/files/delete', { params: new HttpParams().set('path', path) });
  }

  renameFile(oldPath: string, newPath: string): Observable<void> {
    return this.http.post<void>('/api/files/rename', { oldPath, newPath });
  }

  createFolder(path: string): Observable<void> {
    return this.http.post<void>('/api/folders/create', { path });
  }

  deleteFolder(path: string): Observable<void> {
    return this.http.delete<void>('/api/folders/delete', { params: new HttpParams().set('path', path) });
  }

  renameFolder(oldPath: string, newPath: string): Observable<void> {
    return this.http.post<void>('/api/folders/rename', { oldPath, newPath });
  }
}
