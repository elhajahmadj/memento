export interface RecordedAction {
  id: string;
  pageName: string;
  actionType: 'click' | 'fill' | 'navigate' | 'check' | 'select';
  selector: string;
  selectorStrategy: 'data-testid' | 'id' | 'aria-label' | 'css' | 'url';
  value?: string;
  url?: string;
  timestamp: string;
}

export interface RecordingSessionInfo {
  sessionId: string;
  status: string;
}

export interface StartRecordingRequest {
  targetClassFilePath: string;
  testMethodName: string;
  namespace: string;
  pageObjectsFolder: string;
  startUrl: string;
}

export interface GeneratedFileResult {
  path: string;
  created: boolean;
}
