import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchQueryInfo, SourceResult, SearchEvent, SearchErrorEvent } from "../types";

interface UseCuratorReturn {
    queries: SearchQueryInfo[];
    state: "SEARCHING" | "RESULT_SELECTION" | "COMPLETED";
    addQuery: (query: string, provider?: string) => Promise<void>;
    toggleSelect: (index: number) => void;
    selectedIndices: number[];
    submit: (payload: { selected: number[]; summary?: string; summaryMeta?: unknown; rawResults?: boolean }) => Promise<void>;
    cancel: () => Promise<void>;
    connected: boolean;
}

export function useCurator(
    sessionToken: string,
    serverUrl: string,
    initialQueries: string[],
    defaultProvider: string,
): UseCuratorReturn {
    const [queries, setQueries] = useState<SearchQueryInfo[]>(() =>
        initialQueries.map((q, i) => ({
            queryIndex: i,
            query: q,
            answer: "",
            results: [],
            provider: defaultProvider,
            loading: true,
        })),
    );
    const [state, setState] = useState<"SEARCHING" | "RESULT_SELECTION" | "COMPLETED">("SEARCHING");
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
    const [connected, setConnected] = useState(false);
    const eventSourceRef = useRef<EventSource | null>(null);
    const nextQueryIndex = useRef(initialQueries.length);

    // ── SSE Connection ─────────────────────────────────────────────────────────

    useEffect(() => {
        const url = `${serverUrl}/events?session=${sessionToken}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => setConnected(true);
        es.onerror = () => {
            setConnected(false);
            es.close();
        };

        es.addEventListener("result", (event: MessageEvent) => {
            const data: SearchEvent = JSON.parse(event.data);
            setQueries((prev) => {
                const next = [...prev];
                const existing = next.find((q) => q.queryIndex === data.queryIndex);
                if (existing) {
                    existing.answer = data.answer;
                    existing.results = data.results;
                    existing.provider = data.provider;
                    existing.loading = false;
                } else {
                    next.push({
                        queryIndex: data.queryIndex,
                        query: data.query,
                        answer: data.answer,
                        results: data.results,
                        provider: data.provider,
                        loading: false,
                    });
                }
                return next;
            });
        });

        es.addEventListener("search-error", (event: MessageEvent) => {
            const data: SearchErrorEvent = JSON.parse(event.data);
            setQueries((prev) => {
                const next = [...prev];
                const existing = next.find((q) => q.queryIndex === data.queryIndex);
                if (existing) {
                    existing.error = data.error;
                    existing.loading = false;
                } else {
                    next.push({
                        queryIndex: data.queryIndex,
                        query: data.query,
                        answer: "",
                        results: [],
                        provider: data.provider ?? defaultProvider,
                        loading: false,
                        error: data.error,
                    });
                }
                return next;
            });
        });

        es.addEventListener("done", () => {
            setState("RESULT_SELECTION");
        });

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [sessionToken, serverUrl, defaultProvider]);

    // ── Helper: post JSON ──────────────────────────────────────────────────────

    const postJson = useCallback(
        async (path: string, body: Record<string, unknown>): Promise<unknown> => {
            const res = await fetch(`${serverUrl}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: sessionToken, ...body }),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || `HTTP ${res.status}`);
            }
            return res.json();
        },
        [serverUrl, sessionToken],
    );

    // ── addQuery ───────────────────────────────────────────────────────────────

    const addQuery = useCallback(
        async (query: string, provider?: string) => {
            const qi = nextQueryIndex.current++;
            const qInfo: SearchQueryInfo = {
                queryIndex: qi,
                query,
                answer: "",
                results: [],
                provider: provider ?? defaultProvider,
                loading: true,
            };
            setQueries((prev) => [...prev, qInfo]);

            const body: Record<string, unknown> = { query };
            if (provider) body.provider = provider;

            const data = (await postJson("/search", body)) as {
                ok?: boolean;
                queryIndex?: number;
                answer?: string;
                results?: SourceResult[];
                provider?: string;
                error?: string;
            };

            setQueries((prev) => {
                const next = [...prev];
                const existing = next.find((q) => q.queryIndex === qi);
                if (!existing) return next;
                if (data.error) {
                    existing.error = data.error;
                } else {
                    existing.answer = data.answer ?? "";
                    existing.results = data.results ?? [];
                    existing.provider = data.provider ?? defaultProvider;
                }
                existing.loading = false;
                return next;
            });
        },
        [defaultProvider, postJson],
    );

    // ── Toggle Select ──────────────────────────────────────────────────────────

    const toggleSelect = useCallback((index: number) => {
        setSelectedIndices((prev) =>
            prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
        );
    }, []);

    // ── Submit ─────────────────────────────────────────────────────────────────

    const submit = useCallback(
        async (payload: { selected: number[]; summary?: string; summaryMeta?: unknown; rawResults?: boolean }) => {
            await postJson("/submit", payload as unknown as Record<string, unknown>);
            setState("COMPLETED");
        },
        [postJson],
    );

    // ── Cancel ─────────────────────────────────────────────────────────────────

    const cancel = useCallback(async () => {
        await postJson("/cancel", { reason: "user" });
        setState("COMPLETED");
    }, [postJson]);

    return { queries, state, addQuery, toggleSelect, selectedIndices, submit, cancel, connected };
}
