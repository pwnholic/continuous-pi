import { vi } from "vitest";

// ─── Mock @mariozechner/pi-ai ─────────────────────────────────────────────────

vi.mock("@mariozechner/pi-ai", () => {
    const mockMessage = {
        role: "user",
        content: [{ type: "text", text: "test" }],
        timestamp: Date.now(),
    };

    const mockModel = {
        provider: "anthropic",
        id: "claude-haiku-4-5",
        baseUrl: undefined,
        headers: {},
        maxTokens: 4096,
        reasoning: false,
        name: "anthropic/claude-haiku-4-5",
    };

    return {
        Type: {
            String: (opts?: { description?: string }) => ({
                type: "string",
                description: opts?.description,
            }),
            Number: (opts?: { description?: string }) => ({
                type: "number",
                description: opts?.description,
            }),
            Boolean: () => ({ type: "boolean" }),
            Array: (items: unknown, opts?: { description?: string }) => ({
                type: "array",
                items,
                description: opts?.description,
            }),
            Object: (properties: Record<string, unknown>) => ({
                type: "object",
                properties,
            }),
            Optional: (schema: unknown) => schema,
        },
        StringEnum: (values: string[], opts?: { description?: string }) => ({
            type: "string",
            enum: values,
            description: opts?.description,
        }),
        getModel: () => mockModel,
        complete: vi.fn().mockResolvedValue({
            content: [{ text: "This is a mock summary response." }],
            stopReason: "stop",
        }),
        Message: mockMessage,
        Api: "anthropic",
    };
});

// ─── Mock @mariozechner/pi-tui ────────────────────────────────────────────────

vi.mock("@mariozechner/pi-tui", () => {
    return {
        Text: class MockText {
            lines: string;
            x: number;
            y: number;
            constructor(lines: string, x: number, y: number) {
                this.lines = lines;
                this.x = x;
                this.y = y;
            }
        },
        Box: class MockBox {
            children: unknown[];
            constructor(children: unknown[]) {
                this.children = children;
            }
        },
        truncateToWidth: (text: string, width: number, suffix: string) => {
            if (text.length <= width) return text;
            return text.slice(0, width - suffix.length) + suffix;
        },
    };
});

// ─── Mock @mariozechner/pi-coding-agent ───────────────────────────────────────

vi.mock("@mariozechner/pi-coding-agent", () => {
    return {
        ExtensionAPI: class MockExtensionAPI {},
        ExtensionContext: class MockExtensionContext {},
    };
});

// ─── Mock @sinclair/typebox ───────────────────────────────────────────────────

vi.mock("@sinclair/typebox", () => {
    return {
        Type: {
            String: (opts?: { description?: string }) => ({
                type: "string",
                description: opts?.description,
            }),
            Number: (opts?: { description?: string }) => ({
                type: "number",
                description: opts?.description,
            }),
            Boolean: () => ({ type: "boolean" }),
            Array: (items: unknown, opts?: { description?: string }) => ({
                type: "array",
                items,
                description: opts?.description,
            }),
            Object: (properties: Record<string, unknown>) => ({
                type: "object",
                properties,
            }),
            Optional: (schema: unknown) => schema,
        },
    };
});
