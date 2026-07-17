// Minimal ambient declaration for Node's built-in node:sqlite module.
//
// node:sqlite is a stable part of the Node 22.5+/24 runtime but the installed
// @types/node predates it. We declare only the surface we use rather than
// bumping the whole types package.
declare module "node:sqlite" {
  interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  class StatementSync {
    run(...params: unknown[]): StatementResultingChanges;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
