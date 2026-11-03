import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Observable, Subject, tap } from 'rxjs';
import {
  GeneratedFileResult,
  RecordedAction,
  RecordingSessionInfo,
  StartRecordingRequest
} from '../models/recording.model';

@Injectable({ providedIn: 'root' })
export class RecordingService {
  readonly isRecording = signal(false);
  readonly sessionId = signal<string | null>(null);
  readonly actions = signal<RecordedAction[]>([]);
  readonly latestFrame = signal<string | null>(null);

  readonly recordingStopped$ = new Subject<GeneratedFileResult[]>();
  readonly treeUpdated$ = new Subject<void>();

  private connection: signalR.HubConnection | null = null;

  constructor(private http: HttpClient) {}

  start(req: StartRecordingRequest): Observable<RecordingSessionInfo> {
    return this.http.post<RecordingSessionInfo>('/api/recording/start', req).pipe(
      tap(async info => {
        this.actions.set([]);
        this.latestFrame.set(null);
        this.sessionId.set(info.sessionId);
        this.isRecording.set(true);
        await this.connect(info.sessionId);
      })
    );
  }

  stop(): Observable<GeneratedFileResult[]> {
    const id = this.sessionId();
    if (!id) throw new Error('No active recording session.');
    return this.http.post<GeneratedFileResult[]>('/api/recording/stop', { sessionId: id }).pipe(
      tap(() => {
        this.isRecording.set(false);
      })
    );
  }

  private async connect(sessionId: string): Promise<void> {
    if (this.connection) {
      try { await this.connection.stop(); } catch {}
    }
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/recording')
      .withAutomaticReconnect()
      .build();

    this.connection.on('actionRecorded', (a: RecordedAction) => {
      this.actions.update(list => [...list, a]);
    });
    this.connection.on('screenshotFrame', (b64: string) => {
      this.latestFrame.set('data:image/png;base64,' + b64);
    });
    this.connection.on('treeUpdated', () => this.treeUpdated$.next());
    this.connection.on('recordingStopped', (g: GeneratedFileResult[]) => {
      this.recordingStopped$.next(g);
    });

    await this.connection.start();
    await this.connection.invoke('JoinSession', sessionId);
  }
}
