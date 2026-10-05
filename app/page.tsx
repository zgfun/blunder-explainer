import { HomeClient } from "@/components/analyze/HomeClient";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const url = typeof sp.url === "string" ? sp.url.slice(0, 300) : undefined;
  const username = typeof sp.username === "string" ? sp.username.slice(0, 25) : undefined;
  return <HomeClient initial={url ? { url, username } : undefined} />;
}
