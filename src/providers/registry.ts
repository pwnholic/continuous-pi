import type { ProviderAvailability, ResolvedSearchProvider, SearchProvider } from "../types.js";

export type { ProviderAvailability, ResolvedSearchProvider, SearchProvider };

const _providerNames: ResolvedSearchProvider[] = ["perplexity", "exa", "gemini"];

/**
 * Normalize user-provided provider string to valid SearchProvider.
 */
export function normalizeProvider(value: unknown): SearchProvider | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return "auto";
    const normalized = value.trim().toLowerCase() as SearchProvider;
    if (normalized === "auto" || normalized === "exa" || normalized === "perplexity" || normalized === "gemini") {
        return normalized;
    }
    return "auto";
}

/**
 * Resolve "auto" to the first available provider.
 * Falls back through: exa → perplexity → gemini
 */
export function resolveProvider(requested: unknown, available: ProviderAvailability): ResolvedSearchProvider {
    const provider = normalizeProvider(requested) ?? "auto";

    if (provider === "auto") {
        if (available.exa) return "exa";
        if (available.perplexity) return "perplexity";
        if (available.gemini) return "gemini";
        return "exa";
    }

    // Fallback chain for unavailable requested provider
    if (provider === "exa" && !available.exa) {
        if (available.perplexity) return "perplexity";
        if (available.gemini) return "gemini";
        return "exa";
    }
    if (provider === "perplexity" && !available.perplexity) {
        if (available.exa) return "exa";
        if (available.gemini) return "gemini";
        return "perplexity";
    }
    if (provider === "gemini" && !available.gemini) {
        if (available.exa) return "exa";
        if (available.perplexity) return "perplexity";
        return "gemini";
    }

    return provider;
}
