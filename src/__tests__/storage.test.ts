import { beforeEach, describe, expect, it } from "vitest";
import { clearResults, generateId, getAllResults, getResult, getResultsByType, storeResult } from "../storage/index.js";
import type { StoredSearchData } from "../types.js";

describe("storage", () => {
    beforeEach(() => {
        clearResults();
    });

    it("generateId returns unique IDs", () => {
        const id1 = generateId();
        const id2 = generateId();
        expect(id1).not.toBe(id2);
    });

    it("stores and retrieves results", () => {
        const data: StoredSearchData = {
            id: "test-1",
            type: "fetch",
            timestamp: 1000,
            urls: [{ url: "https://example.com", title: "Example", content: "Hello", error: null }],
        };
        storeResult("test-1", data);
        const result = getResult("test-1");
        expect(result).not.toBeNull();
        expect(result?.urls?.[0]?.url).toBe("https://example.com");
    });

    it("returns null for unknown ID", () => {
        expect(getResult("nonexistent")).toBeNull();
    });

    it("lists all results", () => {
        const data1: StoredSearchData = {
            id: "a",
            type: "fetch",
            timestamp: 1,
            urls: [{ url: "https://a.com", title: "A", content: "A content", error: null }],
        };
        const data2: StoredSearchData = {
            id: "b",
            type: "search",
            timestamp: 2,
            queries: [{ query: "test", answer: "answer", results: [], timestamp: Date.now(), error: null }],
        };
        storeResult("a", data1);
        storeResult("b", data2);
        expect(getAllResults()).toHaveLength(2);
    });

    it("filters results by type", () => {
        const fetchData: StoredSearchData = {
            id: "f1",
            type: "fetch",
            timestamp: 1,
            urls: [{ url: "https://x.com", title: "X", content: "X", error: null }],
        };
        const searchData: StoredSearchData = {
            id: "s1",
            type: "search",
            timestamp: 2,
            queries: [{ query: "q", answer: "a", results: [], timestamp: Date.now(), error: null }],
        };
        storeResult("f1", fetchData);
        storeResult("s1", searchData);
        const fetches = getResultsByType("fetch");
        expect(fetches).toHaveLength(1);
        expect(fetches[0]?.id).toBe("f1");
    });

    it("overwrites existing key", () => {
        const data1: StoredSearchData = {
            id: "dup",
            type: "fetch",
            timestamp: 1,
            urls: [{ url: "https://old.com", title: "Old", content: "old", error: null }],
        };
        const data2: StoredSearchData = {
            id: "dup",
            type: "fetch",
            timestamp: 2,
            urls: [{ url: "https://new.com", title: "New", content: "new", error: null }],
        };
        storeResult("dup", data1);
        storeResult("dup", data2);
        const result = getResult("dup");
        expect(result?.urls?.[0]?.url).toBe("https://new.com");
    });
});
