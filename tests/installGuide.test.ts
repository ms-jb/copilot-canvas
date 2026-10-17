import { expect, it } from "vite-plus/test";
import {
  detectInstallPlatform,
  installGuide,
  type InstallPlatform,
} from "../ui/src/components/share/installGuide.ts";

const UA: Record<InstallPlatform, string> = {
  "ios-safari":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "ios-other":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
  "android-chrome":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  "android-edge":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
  "android-samsung":
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  "android-firefox": "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  other:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

it("recognizes each phone browser", () => {
  for (const [platform, userAgent] of Object.entries(UA)) {
    expect(detectInstallPlatform(userAgent)).toBe(platform);
  }
});

it("treats an iPad that reports a Mac user agent as iOS", () => {
  const ipad =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  expect(detectInstallPlatform(ipad, 5)).toBe("ios-safari");
  expect(detectInstallPlatform(ipad, 0)).toBe("other");
});

it("gives every platform steps, and warns iOS about the separate sign-in", () => {
  for (const platform of Object.keys(UA) as InstallPlatform[]) {
    expect(installGuide(platform).steps.length).toBeGreaterThan(0);
  }
  expect(installGuide("ios-safari").note).toMatch(/sign in/);
  expect(installGuide("android-chrome").note).toBeUndefined();
});
