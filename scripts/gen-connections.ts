import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.resolve("agent/connections/mcp-servers.json");
const OUTPUT_DIR = path.resolve("agent/connections");

interface McpServerConfig {
  name: string;
  url: string;
  description: string;
  tokenEnv?: string;
  headers?: Record<string, string>;
}

const configs: McpServerConfig[] = JSON.parse(
  fs.readFileSync(CONFIG_PATH, "utf-8")
);

for (const cfg of configs) {
  const filePath = path.join(OUTPUT_DIR, `${cfg.name}.ts`);

  const urlExpr = cfg.tokenEnv
    ? `\`${cfg.url}?access_token=\${process.env.${cfg.tokenEnv}}\``
    : `"${cfg.url}"`;

  const headerLines = cfg.headers
    ? `,\n  headers: ${JSON.stringify(cfg.headers, null, 4)}`
    : "";

  const code = `import { defineMcpClientConnection } from "eve/connections";

export default defineMcpClientConnection({
  url: ${urlExpr},
  description: "${cfg.description}"${headerLines},
});
`;

  fs.writeFileSync(filePath, code, "utf-8");
  console.log(`Generated ${filePath}`);
}

console.log(`Done. ${configs.length} connection(s) generated.`);
