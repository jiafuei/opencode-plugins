import { createInterface } from "node:readline";

await Bun.write("child.pid", String(process.pid));
process.on("SIGINT", () => process.stdout.write("interrupted\n"));
process.stdout.write(`\x1b[31mready:${process.env.PTY_TEST}\x1b[0m\n${process.stdout.rows} ${process.stdout.columns}\n`);

let held = false;
createInterface({ input: process.stdin }).on("line", (line) => {
  if (held) {
    held = false;
    process.stdout.write("ready:interactive\n");
    return;
  }
  if (line === "bye") {
    process.stdout.write("done\n", () => process.exit(7));
    return;
  }
  if (line === "hold") {
    held = true;
    process.stdout.write("hold-requested\n");
    return;
  }
  if (line === "flood") {
    process.stdout.write(Array.from({ length: 80 }, (_, index) => String(index).padStart(280, "0")).join("\n") + "\nflood-done\n");
    return;
  }
  process.stdout.write(`value:${line}\n`);
});
