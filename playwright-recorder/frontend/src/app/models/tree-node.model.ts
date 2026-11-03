export interface TreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  extension?: string;
  children: TreeNode[];
}
