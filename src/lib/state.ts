// Container-internal directory for runtime state (chrome profile, dashcam
// segments, tab state, network log, heartbeat). Kept off /tmp so the host's
// /tmp can be bind-mounted at /tmp inside the container, letting users pass
// --output /tmp/foo and have files land on the host.
//
// Tests run on the host where /state does not exist; they override via
// WEB_STATE_DIR=/tmp before importing the module under test.
export const STATE_DIR = process.env.WEB_STATE_DIR ?? "/state";
