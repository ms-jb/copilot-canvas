import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const LINK = /<link\s+rel="apple-touch-icon"\s+href="[^"]*"\s*\/?>/;

export async function inlineAppleTouchIcon(html: string, rootDir: string): Promise<string> {
  const iconPath = resolve(rootDir, "ui", "public", "assets", "icon-180.png");
  const icon = await readFile(iconPath);
  const href = `data:image/png;base64,${icon.toString("base64")}`;
  return html.replace(LINK, `<link rel="apple-touch-icon" href="${href}" />`);
}
