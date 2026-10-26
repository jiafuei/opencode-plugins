/// <reference lib="dom" />

declare module "turndown-plugin-gfm" {
  import type { Plugin } from "turndown";
  export const gfm: Plugin;
}

declare module "@mixmark-io/domino" {
  export function createDocument(html: string): Document;
}
