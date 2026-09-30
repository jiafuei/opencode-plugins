import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";

type Response =
  | {
      id: number;
      ok: true;
      image: string;
      width: number;
      height: number;
      screenshot: [number, number];
      native: [number, number];
      scale: number;
    }
  | { id: number; ok: false; error: string };

const HELPER = process.env.COMPUTER_USE_HELPER ?? `${import.meta.dir}/bin/computer-use-helper.exe`;

const COORDINATES =
  "Coordinates are pixels in the most recent computer_screenshot image of the primary display, not native display pixels.";
const RESULT =
  "Returns a screenshot taken 300ms after the action. If the UI was still animating (Start menu, menus or dialogs opening), call computer_wait before clicking positions taken from it.";

// Separate x/y instead of an [x, y] tuple: tuple-form array schemas are rejected by some providers.
// Plain Number, not Int: schema checks fail inside opencode's effect copy even on integer input; the helper rounds.
const coordinate = (name: string) => Schema.Number.annotate({ description: `${name} in screenshot pixels` });

const input = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
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
      const [width, height] = response.screenshot;
      const contract = `Screenshot ${width}x${height} of the primary display (native ${response.native[0]}x${response.native[1]}, scale ${response.scale.toFixed(4)}). All computer_* coordinates are pixels in this ${width}x${height} image.`;
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
        input: input({ x0: coordinate("left"), y0: coordinate("top"), x1: coordinate("right"), y1: coordinate("bottom") }),
        execute: ({ x0, y0, x1, y1 }, context) => call({ action: "zoom", region: [x0, y0, x1, y1] }, context.signal),
      });
      tools.add({
        name: "computer_click",
        options: { codemode: false },
        description: `Move the pointer to a coordinate and click. ${COORDINATES} ${RESULT}`,
        input: input({
          x: coordinate("x"),
          y: coordinate("y"),
          button: Schema.optional(Schema.Literals(["left", "right", "middle"])),
          count: Schema.optional(Schema.Literals([1, 2, 3]).annotate({ description: "1 = click, 2 = double, 3 = triple" })),
        }),
        execute: ({ x, y, button, count }, context) =>
          call({ action: "click", coordinate: [x, y], button, count }, context.signal),
      });
      tools.add({
        name: "computer_move",
        options: { codemode: false },
        description: `Move the pointer without clicking, e.g. to hover and open tooltips or hover menus. ${COORDINATES} ${RESULT}`,
        input: input({ x: coordinate("x"), y: coordinate("y") }),
        execute: ({ x, y }, context) => call({ action: "move", coordinate: [x, y] }, context.signal),
      });
      tools.add({
        name: "computer_drag",
        options: { codemode: false },
        description: `Press the left button at the start point, drag to the end point, and release. Use for moving or resizing windows, selecting text, drag and drop. ${COORDINATES} ${RESULT}`,
        input: input({
          start_x: coordinate("start x"),
          start_y: coordinate("start y"),
          end_x: coordinate("end x"),
          end_y: coordinate("end y"),
        }),
        execute: ({ start_x, start_y, end_x, end_y }, context) =>
          call({ action: "drag", start: [start_x, start_y], end: [end_x, end_y] }, context.signal),
      });
      tools.add({
        name: "computer_scroll",
        options: { codemode: false },
        description: `Scroll the mouse wheel over a point. ${COORDINATES} ${RESULT}`,
        input: input({
          x: coordinate("x"),
          y: coordinate("y"),
          direction: Schema.Literals(["up", "down", "left", "right"]),
          amount: Schema.Number.annotate({ description: "Wheel clicks, usually 3 lines each; 5 is a good default" }),
        }),
        execute: ({ x, y, direction, amount }, context) =>
          call({ action: "scroll", coordinate: [x, y], direction, amount: Math.round(amount) }, context.signal),
      });
      tools.add({
        name: "computer_type",
        options: { codemode: false },
        description: `Type text at the current keyboard focus. Any Unicode text works regardless of keyboard layout. Use computer_key for Enter, Tab, and shortcuts. ${RESULT}`,
        input: input({ text: Schema.String }),
        execute: ({ text }, context) => call({ action: "type", text }, context.signal),
      });
      tools.add({
        name: "computer_key",
        options: { codemode: false },
        description: `Press a key or key chord, e.g. "Return", "Escape", "Tab", "super" (Windows key), "ctrl+s", "alt+Tab", "ctrl+shift+Escape", "Down". Names are case-insensitive: ctrl, alt, shift, super/win/cmd, Return/Enter, Escape/Esc, Tab, BackSpace, Delete, Home, End, Page_Up, Page_Down, Up, Down, Left, Right, Space, Insert, F1-F12, or a single character. ${RESULT}`,
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
        description: `Wait, then take a screenshot. Use after actions that start animations or loading (Start menu, menus, dialogs, app launch) before clicking positions from the previous screenshot. ${COORDINATES}`,
        input: input({ seconds: Schema.Number.annotate({ description: "Seconds to wait, e.g. 1" }) }),
        execute: ({ seconds }, context) => call({ action: "wait", seconds: Math.max(0, seconds) }, context.signal),
      });
    });

    return async () => {
      helper?.proc.kill();
    };
  },
});
