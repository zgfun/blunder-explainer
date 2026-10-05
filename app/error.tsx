"use client";

import { useEffect } from "react";
import { ErrorClient } from "@/components/analyze/StatusPages";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorClient retry={retry} digest={error.digest} />;
}
