import { defineSandbox } from "eve/sandbox";
import { microsandbox } from "eve/sandbox/microsandbox";

export default defineSandbox({
  backend: microsandbox({ memoryMiB: 2048 }),

  // 模板级：只执行一次，后续 session 复用结果
  async bootstrap({ use }) {
    const sandbox = await use();
    await sandbox.run({ command: "apt-get install -y git" });
  },

  // Session 级：每个新 session 执行一次
  async onSession({ use, ctx }) {
    const sandbox = await use({ networkPolicy: "deny-all" });
    // 可以做 per-session 初始化
  },
});
