/**
 * Prompt blocks (CR-003, review minor 3). Data goes in as JSON with every `<`, `>` and `&` escaped as a JSON unicode
 * escape, so text an artist wrote can't close its block (`</campaign_content>`) or open one the system prompt trusts.
 * The JSON still decodes to exactly the original strings.
 */
export function block(tag: string, value: unknown): string {
  const json = JSON.stringify(value, null, 2).replace(/[<>&]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `<${tag}>\n${json}\n</${tag}>`;
}
