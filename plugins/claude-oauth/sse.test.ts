import { describe, expect, test } from "bun:test";
import { createSseToolNameTransform } from "./wire_format.ts";

function fragmentedStream(text: string, sizes: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[offset % sizes.length]!;
      controller.enqueue(bytes.subarray(offset, offset + size));
      offset += size;
    },
  });
}

describe("SSE tool-name restoration", () => {
  test("restores only tool names across arbitrary byte boundaries and mixed CRLF/LF", async () => {
    const events = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","content":[]}}',
      'event: ping\ndata: {"type":"ping"}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"weather — λ"}}',
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","name":"_get_weather","input":{}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","name":"__secret","input":{}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","name":"web_search","input":{}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"\\"content_block_start\\""}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ];
    const payload = events.map((event, i) => event + (i % 3 === 1 ? "\r\n\r\n" : "\n\n")).join("");
    const expected = payload.replace('"name":"_get_weather"', '"name":"get_weather"').replace('"name":"__secret"', '"name":"_secret"');
    for (const sizes of [[1], [3], [7, 1, 13], [64], [new TextEncoder().encode(payload).length]]) {
      const output = await new Response(fragmentedStream(payload, sizes).pipeThrough(createSseToolNameTransform())).text();
      expect(output).toBe(expected);
    }
  });

  test("joins multiple data lines before JSON parsing and rewrites as one", async () => {
    const payload = 'data: {"type":"content_block_start","index":9,\n' +
      'data: "content_block":{"type":"tool_use","id":"toolu_09","name":"_split_name","input":{}}}\n\n';
    const output = await new Response(fragmentedStream(payload, [13]).pipeThrough(createSseToolNameTransform())).text();
    const dataLines = output.split("\n").filter((line) => line.startsWith("data:"));
    expect(dataLines).toHaveLength(1);
    expect(JSON.parse(dataLines[0]!.slice("data: ".length))).toEqual({
      type: "content_block_start", index: 9,
      content_block: { type: "tool_use", id: "toolu_09", name: "split_name", input: {} },
    });
  });

  test("uncloaks tool_use names in message_start.message.content blocks", async () => {
    const payload = 'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_ms","role":"assistant","content":[' +
      '{"type":"text","text":"hi"},{"type":"tool_use","id":"toolu_10","name":"_prefixed","input":{}}]}}\r\n\r\n';
    const output = await new Response(fragmentedStream(payload, [17]).pipeThrough(createSseToolNameTransform())).text();
    expect(output).toBe(payload.replace('"name":"_prefixed"', '"name":"prefixed"'));
  });
});
