/**
 * Return point for Stripe bank redirects (3-D Secure, redirect-based methods): PaymentSheet's `returnURL` is
 * `fanzup://stripe-redirect`, which Expo Router would otherwise open as an unknown route on top of checkout. This
 * screen hands the URL to Stripe and steps straight back, so checkout (still mounted underneath) keeps its state and
 * goes on to the capture poll and confirmation.
 */
import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { handleURLCallback } from "@stripe/stripe-react-native";
import { Loading, Screen } from "@/components/ui";

export default function StripeRedirect() {
  const url = Linking.useLinkingURL();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      if (url) await handleURLCallback(url).catch(() => false);
      if (router.canGoBack()) router.back();
      else router.replace("/backed"); // app was cold-started by the redirect: show where the backing stands
    })();
  }, [url]);
  return <Screen edges={[]}><Loading label="Returning to checkout" /></Screen>;
}
