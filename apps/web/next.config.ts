import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The share token is in the URL of this page, so every request the page makes to
   * another origin would otherwise carry it in the `Referer` header — to an image host,
   * an analytics endpoint, or whatever a recipient clicks through to. The API sends the
   * same header on its own responses; this is the half that covers the document.
   *
   * It cannot cover the browser's own history, or the access log of whatever serves
   * this page. See README, "Known limitations".
   */
  async headers() {
    return [
      {
        source: "/s/:token*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
