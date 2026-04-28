declare module "turndown" {
    interface TurndownOptions {
        headingStyle?: "setext" | "atx";
        codeBlockStyle?: "indented" | "fenced";
    }

    class TurndownService {
        constructor(options?: TurndownOptions);
        turndown(html: string | unknown): string;
        addRule(key: string, rule: unknown): void;
        keep(filter: unknown): void;
        remove(filter: unknown): void;
    }

    export default TurndownService;
}
