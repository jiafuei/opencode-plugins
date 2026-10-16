import type { BrowserContextOptions, ConnectOverCDPOptions, LaunchOptions } from "playwright-core";

export type LaunchSettings = {
  userDataDir?: string | null;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
};

export type Command =
  | ({ method: "launch"; url?: string } & LaunchSettings)
  | { method: "connect"; endpoint: string; options?: ConnectOverCDPOptions }
  | { method: "tabs"; offset?: number }
  | { method: "open"; url?: string }
  | { method: "close_tab"; tab: string }
  | { method: "navigate"; tab: string; url: string }
  | { method: "snapshot"; tab: string; selector?: string; depth?: number }
  | { method: "expand"; tab: string; ref: string; offset?: number; depth?: number }
  | { method: "find"; tab: string; text: string; root?: string; offset?: number }
  | { method: "read"; tab: string; ref?: string; offset?: number }
  | { method: "click"; tab: string; ref: string; button?: "left" | "right" | "middle"; count?: number }
  | { method: "fill"; tab: string; ref: string; text: string }
  | { method: "select"; tab: string; ref: string; values: string[] }
  | { method: "check"; tab: string; ref: string; checked: boolean }
  | { method: "hover"; tab: string; ref: string }
  | { method: "press"; tab: string; key: string }
  | { method: "scroll"; tab: string; x?: number; y: number }
  | { method: "evaluate"; tab: string; code: string; ref?: string }
  | { method: "run_code"; tab: string; code: string }
  | { method: "result"; id: string; offset?: number }
  | { method: "screenshot"; tab: string; ref?: string; fullPage?: boolean }
  | { method: "network_list"; tab: string; after?: number; url?: string; status?: number; failed?: boolean }
  | { method: "network_get"; tab: string; request: number; part: "requestHeaders" | "requestBody" | "responseHeaders" | "responseBody" }
  | { method: "console"; tab: string; after?: number; level?: "error" | "warning" | "all" }
  | { method: "close" };

export type Result = {
  data: Record<string, unknown>;
  image?: { mime: string; base64: string };
};

export type Request = { id: number; command: Command };
export type Reply =
  | { id: number; ok: true; result: Result }
  | { id: number; ok: false; error: string };
