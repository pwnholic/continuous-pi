import type { SearchQueryInfo } from "../types";

// ─── Inline SVG Icons ─────────────────────────────────────────────────────────

function SpinnerIcon({ className }: { className?: string }) {
    return (
        <svg className={className ?? "w-4 h-4 animate-spin"} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

function GlobeIcon({ className }: { className?: string }) {
    return (
        <svg className={className ?? "w-4 h-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
    );
}

function CheckIcon({ className }: { className?: string }) {
    return (
        <svg className={className ?? "w-5 h-5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
        </svg>
    );
}

interface Props {
    query: SearchQueryInfo;
    selected: boolean;
    onToggleSelect: () => void;
}

export function SearchResultCard({ query, selected, onToggleSelect }: Props) {
    const hasResults = query.results.length > 0;
    const isError = !!query.error;

    return (
        <div
            className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                selected
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
            } ${isError ? "border-red-300 bg-red-50" : ""}`}
            onClick={onToggleSelect}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-400">#{query.queryIndex}</span>
                        <h3 className="font-medium text-sm truncate">{query.query}</h3>
                        {query.provider && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                {query.provider}
                            </span>
                        )}
                    </div>

                    {query.loading && (
                        <div className="flex items-center gap-2 mt-2 text-gray-400 text-sm">
                            <SpinnerIcon />
                            Searching...
                        </div>
                    )}

                    {isError && <p className="mt-2 text-sm text-red-600">{query.error}</p>}

                    {!query.loading && !isError && hasResults && (
                        <div className="mt-2">
                            {query.answer && (
                                <p className="text-sm text-gray-700 mb-2 line-clamp-3">{query.answer}</p>
                            )}
                            <div className="space-y-1">
                                {query.results.slice(0, 5).map((result, i) => (
                                    <a
                                        key={i}
                                        href={result.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 truncate"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <GlobeIcon className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{result.title}</span>
                                        {result.domain && (
                                            <span className="shrink-0 text-gray-300">({result.domain})</span>
                                        )}
                                    </a>
                                ))}
                                {query.results.length > 5 && (
                                    <p className="text-xs text-gray-300">+{query.results.length - 5} more</p>
                                )}
                            </div>
                        </div>
                    )}

                    {!query.loading && !isError && !hasResults && (
                        <p className="mt-2 text-sm text-gray-400">No results found</p>
                    )}
                </div>

                <div className="shrink-0 mt-0.5">
                    {selected ? (
                        <CheckIcon className="w-5 h-5 text-blue-500" />
                    ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                    )}
                </div>
            </div>
        </div>
    );
}
