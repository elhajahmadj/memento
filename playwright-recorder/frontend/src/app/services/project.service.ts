import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { LoadProjectRequest, NewProjectRequest, ProjectInfo } from '../models/project.model';
import { TreeNode } from '../models/tree-node.model';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  readonly current = signal<ProjectInfo | null>(null);
  readonly tree = signal<TreeNode | null>(null);

  constructor(private http: HttpClient) {}

  createNew(req: NewProjectRequest): Observable<ProjectInfo> {
    return this.http.post<ProjectInfo>('/api/project/new', req).pipe(
      tap(info => this.current.set(info))
    );
  }

  load(req: LoadProjectRequest): Observable<ProjectInfo> {
    return this.http.post<ProjectInfo>('/api/project/load', req).pipe(
      tap(info => this.current.set(info))
    );
  }

  refreshTree(): Observable<TreeNode> {
    return this.http.get<TreeNode>('/api/project/tree').pipe(
      tap(tree => this.tree.set(tree))
    );
  }
}
