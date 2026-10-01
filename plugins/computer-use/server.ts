import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";

type Response =
  | {
      id: number;
      ok: true;
      /** Screenshots, actions and zoom. */
      image?: string;
      width?: number;
      height?: number;
      /** computer_tree. */
      tree?: string;
      /** computer_read and computer_type. */
      text?: string;
      screenshot: [number, number];
      native: [number, number];
      scale: number;
    }
  | { id: number; ok: false; error: string };

// Under WSL the helper is a Windows exe run through interop; on macOS it is a native binary.
const HELPER =
  process.env.COMPUTER_USE_HELPER ??
  `${import.meta.dir}/bin/computer-use-helper${process.platform === "darwin" ? "" : ".exe"}`;

const COORDINATES =
  "Coordinates are pixels in the most recent computer_screenshot image of the primary display, not native display pixels.";
const TARGET = "Target an element by its [id] from the latest computer_tree, or pass x/y.";
const RESULT =
  "Returns a screenshot taken 300ms after the action. If the UI was still animating (Start menu, Spotlight, menus or dialogs opening), call computer_wait before clicking positions taken from it.";

// Separate x/y instead of an [x, y] tuple: tuple-form array schemas are rejected by some providers.
// Plain Number, not Int: schema checks fail inside opencode's effect copy even on integer input; the helper rounds.
// x/y are optional because an element ID can replace them.
const coordinate = (name: string) =>
  Schema.optional(Schema.Number.annotate({ description: `${name} in screenshot pixels; omit when passing an element ID` }));
const id = (description: string) => Schema.optional(Schema.Number.annotate({ description }));

const input = <Fields extends Record<string, Schema.Top & { readonly DecodingServices: never }>>(fields: Fields) =>
  Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Schema.Struct(fields)));

function startHelper() {
  const proc = Bun.spawn([HELPER], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  return {
    proc,
    async readLine() {
      while (!buffered.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`computer-use helper exited with code ${await proc.exited}`);
        buffered += value;
      }
      const end = buffered.indexOf("\n");
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      return line;
    },
  };
}

export default Plugin.define({
  id: "computer-use",
  setup: async (ctx) => {
    let helper: ReturnType<typeof startHelper> | undefined;
    let queue: Promise<unknown> = Promise.resolve();
    let nextID = 0;

    async function send(request: Record<string, unknown>) {
      if (!helper || helper.proc.exitCode !== null) helper = startHelper();
      helper.proc.stdin.write(`${JSON.stringify({ id: ++nextID, ...request })}\n`);
      helper.proc.stdin.flush();
      const response = JSON.parse(await helper.readLine()) as Response;
      if (!response.ok) throw new Error(response.error);
      if (response.text !== undefined) return { content: response.text };
      const [width, height] = response.screenshot;
      const space = `native ${response.native[0]}x${response.native[1]}, scale ${response.scale.toFixed(4)}`;
      if (response.tree !== undefined)
        return {
          content: `Accessibility tree. @(x,y wxh) bounds are in the ${width}x${height} screenshot space of the primary display (${space}). Element IDs stay valid until the next computer_tree call; after the UI changes substantially (navigation, a new dialog), call computer_tree again before using them.\n\n${response.tree}`,
        };
      const contract = `Screenshot ${width}x${height} of the primary display (${space}). All computer_* coordinates are pixels in this ${width}x${height} image.`;
      const text =
        request.action === "zoom"
          ? `Zoom of screenshot region ${JSON.stringify(request.region)}, shown at ${response.width}x${response.height}. Coordinates stay in full-screenshot space: ${contract}`
          : contract;
      return {
        content: [
          { type: "text" as const, text },
          { type: "file" as const, uri: `data:image/jpeg;base64,${response.image}`, mime: "image/jpeg" },
        ],
      };
    }

    // One desktop, one pointer: actions run strictly one after another, even when the model issues parallel calls.
    function call(request: Record<string, unknown>, signal: AbortSignal) {
      const result = queue.then(() => {
        signal.throwIfAborted();
        return send(request);
      });
      queue = result.catch(() => {});
      return result;
    }

    await ctx.tool.transform((tools) => {
      tools.add({
        name: "computer_screenshot",
        options: { codemode: false },
        description: `Capture the primary display. ${COORDINATES}`,
        input: Schema.Record(Schema.String, Schema.Unknown),
        execute: (_, context) => call({ action: "screenshot" }, context.signal),
      });
      tools.add({
        name: "computer_zoom",
        options: { codemode: false },
        description: `Show a region of the screen at higher detail, e.g. to read small text. The region and all later coordinates stay in full-screenshot space; zooming does not change what coordinates mean. ${COORDINATES}`,
        input: input({
          x0: Schema.Number.annotate({ description: "left in screenshot pixels" }),
          y0: Schema.Number.annotate({ description: "top in screenshot pixels" }),
          x1: Schema.Number.annotate({ description: "right in screenshot pixels" }),
          y1: Schema.Number.annotate({ description: "bottom in screenshot pixels" }),
        }),
        execute: ({ x0, y0, x1, y1 }, context) => call({ action: "zoom", region: [x0, y0, x1, y1] }, context.signal),
      });
      tools.add({
        name: "computer_tree",
        options: { codemode: false },
        description:
          'Read the accessibility tree of the foreground window as text: one element per line as [id] role "name" value="…" @(x,y wxh) states, indented by nesting; bounds are in screenshot pixels and only on elements without listed children. An open menu or popup outside the window follows it, then the other open windows. Use it to target small or crowded controls exactly by element ID with computer_click, computer_move, computer_scroll and computer_drag, or to read text with computer_read. Pass find with text you can see on screen (a button label, a link, a field name) to list only the elements that contain it; prefer that over the full tree when you know what to target. Apps that draw their own UI (games, canvas apps) expose little or nothing; use the screenshot there.',
        input: input({
          find: Schema.optional(
            Schema.String.annotate({ description: "Only list elements whose name or value contains this text (case-insensitive), each with its parent's name" }),
          ),
        }),
        execute: ({ find }, context) => call({ action: "tree", find }, context.signal),
      });
      tools.add({
        name: "computer_read",
        options: { codemode: false },
        description:
          'Read the full text of one element from the latest computer_tree: the whole page text of a browser Document, the buffer of a terminal or editor (elements with the "text" state), or the complete text of an item cut off with "…(truncated; computer_read [id])". Long text is paged: the result ends with the offset to pass for the next page. Does not act, and keeps the tree\'s IDs valid.',
        input: input({
          element: Schema.Number.annotate({ description: "Element ID from the latest tree" }),
          offset: Schema.optional(Schema.Number.annotate({ description: "Character offset to start from (default 0)" })),
        }),
        execute: ({ element, offset }, context) =>
          call({ action: "read", element: Math.round(element), offset: offset === undefined ? undefined : Math.max(0, Math.round(offset)) }, context.signal),
      });
      tools.add({
        name: "computer_click",
        options: { codemode: false },
        description: `Move the pointer to an element or a coordinate and click. ${TARGET} ${COORDINATES} ${RESULT}`,
        input: input({
          element: id("Element ID to click at its center"),
          x: coordinate("x"),
          y: coordinate("y"),
          button: Schema.optional(Schema.Literals(["left", "right", "middle"])),
          count: Schema.optional(Schema.Literals([1, 2, 3]).annotate({ description: "1 = click, 2 = double, 3 = triple" })),
        }),
        execute: (args, context) => call({ action: "click", ...args }, context.signal),
      });
      tools.add({
        name: "computer_move",
        options: { codemode: false },
        description: `Move the pointer without clicking, e.g. to hover and open tooltips or hover menus. ${TARGET} ${COORDINATES} ${RESULT}`,
        input: input({ element: id("Element ID to hover at its center"), x: coordinate("x"), y: coordinate("y") }),
        execute: (args, context) => call({ action: "move", ...args }, context.signal),
      });
      tools.add({
        name: "computer_drag",
        options: { codemode: false },
        description: `Press the left button at the start point, drag to the end point, and release. Use for moving or resizing windows, selecting text, drag and drop. Each end is an element [id] from the latest computer_tree or x/y. ${COORDINATES} ${RESULT}`,
        input: input({
          start_element: id("Element ID to start the drag at"),
          start_x: coordinate("start x"),
          start_y: coordinate("start y"),
          end_element: id("Element ID to drop on"),
          end_x: coordinate("end x"),
          end_y: coordinate("end y"),
        }),
        execute: (args, context) => call({ action: "drag", ...args }, context.signal),
      });
      tools.add({
        name: "computer_scroll",
        options: { codemode: false },
        description: `Scroll the mouse wheel over an element or a point. ${TARGET} ${COORDINATES} ${RESULT}`,
        input: input({
          element: id("Element ID to scroll over"),
          x: coordinate("x"),
          y: coordinate("y"),
          direction: Schema.Literals(["up", "down", "left", "right"]),
          amount: Schema.Number.annotate({ description: "Wheel clicks, usually 3 lines each; 5 is a good default" }),
        }),
        execute: (args, context) => call({ action: "scroll", ...args, amount: Math.round(args.amount) }, context.signal),
      });
      tools.add({
        name: "computer_type",
        options: { codemode: false },
        description: `Type text at the current keyboard focus. Any Unicode text works regardless of keyboard layout. Use computer_key for Enter, Tab, and shortcuts. Returns no screenshot, only which element had keyboard focus; the next action's result shows the outcome, or call computer_screenshot to check.`,
        input: input({ text: Schema.String }),
        execute: ({ text }, context) => call({ action: "type", text }, context.signal),
      });
      tools.add({
        name: "computer_focus",
        options: { codemode: false },
        description: `Bring a top-level window to the front (restoring it if minimized), by title: case-insensitive, an exact title first, else the first window whose title contains the text. If nothing matches, the error lists the open windows' titles; computer_tree lists them too. ${RESULT}`,
        input: input({ title: Schema.String.annotate({ description: "Window title or part of it" }) }),
        execute: ({ title }, context) => call({ action: "focus", title }, context.signal),
      });
      tools.add({
        name: "computer_key",
        options: { codemode: false },
        description: `Press a key or key chord, e.g. "Return", "Escape", "Tab", "super" (Windows key), "ctrl+s", "alt+Tab", "Down"; on macOS use cmd for shortcuts, e.g. "cmd+space" (Spotlight), "cmd+c", "cmd+tab". Names are case-insensitive: ctrl, alt/option, shift, super/win/cmd (Windows key on Windows, Command on macOS), Return/Enter, Escape/Esc, Tab, BackSpace, Delete, Home, End, Page_Up, Page_Down, Up, Down, Left, Right, Space, ${process.platform === "darwin" ? "" : "Insert, "}F1-F12, or a single character. ${RESULT}`,
        input: input({
          keys: Schema.String.annotate({ description: 'Keys joined with "+", modifiers first' }),
          repeat: Schema.optional(Schema.Number.annotate({ description: "Press the chord this many times (default 1)" })),
        }),
        execute: ({ keys, repeat }, context) =>
          call({ action: "key", keys, repeat: Math.max(1, Math.round(repeat ?? 1)) }, context.signal),
      });
      tools.add({
        name: "computer_wait",
        options: { codemode: false },
        description: `Wait, then take a screenshot. Use after actions that start animations or loading (Start menu, Spotlight, menus, dialogs, app launch) before clicking positions from the previous screenshot. ${COORDINATES}`,
        input: input({ seconds: Schema.Number.annotate({ description: "Seconds to wait, e.g. 1" }) }),
        execute: ({ seconds }, context) => call({ action: "wait", seconds: Math.max(0, seconds) }, context.signal),
      });
    });

    return async () => {
      helper?.proc.kill();
    };
  },
});
