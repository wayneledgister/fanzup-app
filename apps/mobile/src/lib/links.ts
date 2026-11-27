/** In-app navigation targets after sign-in (FR-BCK-002) and web pages opened in an in-app browser (FR-MOB-007). */
import * as WebBrowser from "expo-web-browser";
import { env } from "./env";
export { safeAppNext } from "./next";

export const webUrl = (path: string) => (env.webUrl ? `${env.webUrl}${path}` : null);

export async function openWeb(path: string) {
  const url = webUrl(path);
  if (url) await WebBrowser.openBrowserAsync(url);
}

export const campaignShareUrl = (slug: string) => webUrl(`/campaigns/${slug}`) ?? `fanzup://campaigns/${slug}`;
