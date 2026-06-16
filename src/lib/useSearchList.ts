import { useCallback, useEffect, useRef, useState } from "react";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/**
 * Cursor-paginated, debounced-search list. Designed for "load more" UIs that
 * stay smooth at scale: a new search resets the list, and `loadMore` appends.
 * Stale responses are dropped so fast typing never shows out-of-order results.
 */
export function useSearchList<T>(
  fetchPage: (params: { q: string; cursor: string | null }) => Promise<Page<T>>,
) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const reqId = useRef(0);

  // Debounce the search term.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  // Reset + reload whenever the debounced term changes.
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    fetchRef.current({ q: debounced, cursor: null })
      .then((page) => {
        if (id !== reqId.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setTotal(page.total);
      })
      .catch(() => {
        if (id === reqId.current) setItems([]);
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [debounced]);

  // Synchronous in-flight guard: the `loadingMore` STATE updates a render late,
  // so two quick calls could both pass a state-only check and double-append.
  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(() => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const id = reqId.current;
    setLoadingMore(true);
    fetchRef.current({ q: debounced, cursor })
      .then((page) => {
        // Drop the page if a new search bumped reqId while this was in flight.
        if (id !== reqId.current) return;
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        /* keep the current list; the row stays available to retry */
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [cursor, debounced]);

  const patchItem = useCallback((match: (it: T) => boolean, next: (it: T) => T) => {
    setItems((prev) => prev.map((it) => (match(it) ? next(it) : it)));
  }, []);

  const removeItem = useCallback((match: (it: T) => boolean) => {
    setItems((prev) => prev.filter((it) => !match(it)));
    setTotal((t) => (t === undefined ? t : Math.max(0, t - 1)));
  }, []);

  const addItem = useCallback((item: T) => {
    setItems((prev) => [item, ...prev]);
    setTotal((t) => (t === undefined ? t : t + 1));
  }, []);

  return {
    query,
    setQuery,
    items,
    total,
    loading,
    loadingMore,
    hasMore: cursor !== null,
    loadMore,
    patchItem,
    removeItem,
    addItem,
  };
}
