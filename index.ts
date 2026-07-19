import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clearSnapshots,
  getDHashlineConfig,
  getSnapshotStats,
  registerDHashlineTools,
  restoreSessionSnapshots,
} from "./src/tools.js";

export default function dhashlineExtension(pi: ExtensionAPI): void {
  registerDHashlineTools(pi);
  pi.on("session_start", async (_event, ctx) => {
    restoreSessionSnapshots(ctx);
  });
  pi.registerCommand("dhashline", {
    description: "Show DHashline session snapshot status; use /dhashline clear to reset snapshots",
    handler: async (args, ctx) => {
      if (args.trim() === "clear") {
        clearSnapshots(pi, ctx);
        ctx.ui.notify("DHashline session snapshots cleared", "info");
        return;
      }
      const stats = getSnapshotStats(ctx);
      const config = getDHashlineConfig(ctx);
      ctx.ui.notify(
        `DHashline: ${stats.paths} paths, ${stats.versions} snapshots, ${stats.bytes} bytes; max file ${config.maxFileBytes} bytes`,
        "info",
      );
    },
  });
}
