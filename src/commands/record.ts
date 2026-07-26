import { spawn, execFileSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../lib/state.js";

const PID_FILE = `${STATE_DIR}/.web-record.pid`;
const CONFIG_FILE = `${STATE_DIR}/.web-record.json`;
const TEMP_VIDEO = `${STATE_DIR}/.web-record.mp4`;
const HLS_PLAYLIST = `${STATE_DIR}/.web-record.m3u8`;

function resolveOutput(output: string): string {
  return path.resolve(process.cwd(), output);
}

function stopRecording(pid: number): void {
  // A malformed stale pid must never signal the CLI's own process group
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  // Send SIGINT to ffmpeg so it finalizes any files it is writing
  try {
    process.kill(pid, "SIGINT");
  } catch {
    // A stale pid file should not prevent starting a new recorder
    return;
  }

  // Poll for exit so a replacement cannot write to the same files too early
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      break; // process exited
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

function cleanDashcamBuffer(): void {
  // Old segments must not leak into a later save from the replacement recorder
  const segments = readdirSync(STATE_DIR)
    .filter((f) => f.startsWith(".web-record") && f.endsWith(".ts"));
  for (const segment of segments) {
    try { unlinkSync(`${STATE_DIR}/${segment}`); } catch { /* best-effort cleanup */ }
  }
  try { unlinkSync(HLS_PLAYLIST); } catch { /* best-effort cleanup */ }
}

export function recordStart(opts: { output?: string }): void {
  if (existsSync(PID_FILE)) {
    process.stderr.write("Error: recording already in progress\n");
    process.exit(1);
  }

  const output = opts.output ?? "recording.mp4";
  const display = process.env.DISPLAY ?? ":99";

  const proc = spawn(
    "ffmpeg",
    [
      "-f", "x11grab",
      "-video_size", "1920x1080",
      "-framerate", "5",
      "-i", display,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-threads", "1",
      "-y",
      TEMP_VIDEO,
    ],
    { detached: true, stdio: "ignore" },
  );

  proc.unref();

  if (!proc.pid) {
    process.stderr.write("Error: failed to start ffmpeg (is it installed?)\n");
    process.exit(1);
  }

  writeFileSync(PID_FILE, String(proc.pid));
  writeFileSync(CONFIG_FILE, JSON.stringify({ mode: "record", output }));

  process.stderr.write(`Recording started (pid ${proc.pid})\n`);
}

export function recordStop(): void {
  if (!existsSync(PID_FILE)) {
    process.stderr.write("Error: no recording in progress\n");
    process.exit(1);
  }

  const pid = Number(readFileSync(PID_FILE, "utf-8").trim());
  let config: { mode: string; output: string };
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    config = { mode: "record", output: "recording.mp4" };
    process.stderr.write("Warning: config file corrupted, using defaults\n");
  }
  const output = resolveOutput(config.output);

  stopRecording(pid);

  if (config.mode === "record") {
    copyFileSync(TEMP_VIDEO, output);
    try { unlinkSync(TEMP_VIDEO); } catch { /* best-effort cleanup */ }
  } else if (config.mode === "dashcam") {
    // Collect HLS .ts segments
    const segments = readdirSync(STATE_DIR)
      .filter((f) => f.startsWith(".web-record") && f.endsWith(".ts"))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)?.[0] ?? "0");
        const nb = parseInt(b.match(/\d+/)?.[0] ?? "0");
        return na - nb;
      });

    if (segments.length > 0) {
      const listFile = `${STATE_DIR}/.web-record-concat.txt`;
      const lines = segments.map((f) => `file '${STATE_DIR}/${f}'`).join("\n");
      writeFileSync(listFile, lines);

      try {
        execFileSync(
          "ffmpeg",
          ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-y", output],
          { stdio: "ignore" },
        );
      } catch {
        process.stderr.write("Error: failed to concatenate segments\n");
        process.exit(1);
      }

      // Clean up segments, playlist, list file
      for (const f of segments) {
        try { unlinkSync(`${STATE_DIR}/${f}`); } catch { /* best-effort cleanup */ }
      }
      try { unlinkSync(listFile); } catch { /* best-effort cleanup */ }
      try { unlinkSync(HLS_PLAYLIST); } catch { /* best-effort cleanup */ }
    }
  }

  // Clean up pid and config
  try { unlinkSync(PID_FILE); } catch { /* best-effort cleanup */ }
  try { unlinkSync(CONFIG_FILE); } catch { /* best-effort cleanup */ }

  process.stderr.write(`Recording saved to ${output}\n`);
}

export function recordDashcam(opts: {
  output?: string;
  seconds?: number;
}): void {
  if (existsSync(PID_FILE)) {
    try {
      const pid = Number(readFileSync(PID_FILE, "utf-8").trim());
      stopRecording(pid);
    } catch {
      // An unreadable stale pid file should not prevent the replacement
    }
  }

  cleanDashcamBuffer();
  try { unlinkSync(PID_FILE); } catch { /* best-effort cleanup */ }
  try { unlinkSync(CONFIG_FILE); } catch { /* best-effort cleanup */ }

  const output = opts.output ?? "dashcam.mp4";
  const seconds = opts.seconds ?? 60;
  const display = process.env.DISPLAY ?? ":99";

  const proc = spawn(
    "ffmpeg",
    [
      "-f", "x11grab",
      "-video_size", "1920x1080",
      "-framerate", "3",
      "-i", display,
      "-vf", "scale=960:540",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "30",
      "-pix_fmt", "yuv420p",
      "-threads", "1",
      "-g", "3",
      "-hls_time", "1",
      "-hls_list_size", String(seconds),
      "-hls_flags", "delete_segments",
      "-y",
      HLS_PLAYLIST,
    ],
    { detached: true, stdio: "ignore" },
  );

  proc.unref();

  if (!proc.pid) {
    process.stderr.write("Error: failed to start ffmpeg (is it installed?)\n");
    process.exit(1);
  }

  writeFileSync(PID_FILE, String(proc.pid));
  writeFileSync(CONFIG_FILE, JSON.stringify({ mode: "dashcam", output }));

  process.stderr.write(
    `Dashcam started (pid ${proc.pid}, rolling ${seconds}s buffer)\n`,
  );
}

export function recordSave(opts: { output?: string }): void {
  if (!existsSync(PID_FILE)) {
    process.stderr.write("Error: no recording in progress\n");
    process.exit(1);
  }

  let config: { mode: string; output: string };
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    config = { mode: "dashcam", output: "dashcam.mp4" };
  }

  if (config.mode !== "dashcam") {
    process.stderr.write(
      "Error: save only works with dashcam mode - use 'record stop' for normal recordings\n",
    );
    process.exit(1);
  }

  const output = resolveOutput(opts.output ?? config.output);

  // Collect current HLS .ts segments (without stopping ffmpeg)
  const segments = readdirSync(STATE_DIR)
    .filter((f) => f.startsWith(".web-record") && f.endsWith(".ts"))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? "0");
      const nb = parseInt(b.match(/\d+/)?.[0] ?? "0");
      return na - nb;
    });

  if (segments.length === 0) {
    process.stderr.write("No segments yet - recording may have just started\n");
    process.exit(1);
  }

  const listFile = `${STATE_DIR}/.web-record-save-concat.txt`;
  const lines = segments.map((f) => `file '${STATE_DIR}/${f}'`).join("\n");
  writeFileSync(listFile, lines);

  try {
    execFileSync(
      "ffmpeg",
      ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-y", output],
      { stdio: "ignore" },
    );
  } catch {
    process.stderr.write("Error: failed to concatenate segments\n");
    process.exit(1);
  }

  try { unlinkSync(listFile); } catch { /* best-effort */ }

  process.stderr.write(`Dashcam buffer saved to ${output}\n`);
}
