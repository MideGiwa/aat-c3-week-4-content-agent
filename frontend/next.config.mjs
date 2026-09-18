/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The App Router's client-side Router Cache normally keeps a page like
    // /requests/[id] "fresh enough" for 30 seconds after a visit, even
    // though the route itself is `force-dynamic` server-side — that's a
    // separate, client-only cache `force-dynamic` doesn't touch. On a
    // board where a card's status (and whether the page 404s while a
    // request is mid-pipeline) can change within seconds, that's stale
    // enough to plausibly explain "the board shows it but clicking it
    // 404s" — worth ruling out first since it's a one-line, zero-downside
    // fix. 0 means every client-side navigation to a dynamic route always
    // fetches fresh from the server, matching what `force-dynamic` already
    // does server-side.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
