import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";

type State<T> = { data: T | undefined; error: string | undefined; loading: boolean };

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: undefined, error: undefined, loading: path !== null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    apiFetch<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: undefined, loading: false }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState((prev) => ({ ...prev, error: err.message, loading: false }));
      });
    return () => controller.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
