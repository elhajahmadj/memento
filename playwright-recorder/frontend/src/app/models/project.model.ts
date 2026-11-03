export interface ProjectInfo {
  solutionName: string;
  solutionPath: string;
  solutionDirectory: string;
  testProjectName: string;
  testProjectDirectory: string;
  defaultNamespace: string;
}

export interface NewProjectRequest {
  solutionName: string;
  rootDirectory: string;
  testProjectName: string;
  defaultNamespace: string;
}

export interface LoadProjectRequest {
  solutionPath: string;
}
