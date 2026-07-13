import { readFileSync } from "node:fs";
import { STATE_DIR } from "../lib/state.js";

const NETWORK_LOG = `${STATE_DIR}/web-network.json`;

interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  type: string;
  size: number;
}

export async function network(opts: { json?: boolean; clear?: boolean }): Promise<void> {
  let entries: NetworkEntry[] = [];
  try {
    entries = JSON.parse(readFileSync(NETWORK_LOG, "utf-8"));
  } catch {
    // No log file yet — no requests captured
  }

  if (entries.length === 0) {
    console.log("No network requests captured. Run 'navigate' first.");
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    console.log(`${entries.length} requests captured\n`);
    console.log("STATUS\tMETHOD\tTYPE\tSIZE\tURL");
    for (const e of entries) {
      console.log(`${e.status}\t${e.method}\t${e.type}\t${e.size}\t${e.url}`);
    }
  }
}
