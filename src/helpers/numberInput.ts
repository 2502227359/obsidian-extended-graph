import { TextComponent } from "obsidian";

/**
 * Number text input with clamping and blur normalization.
 *
 * Invalid (NaN) values are never stored. Out-of-range values are clamped.
 * An empty field falls back to `fallback` when provided (reset-to-default UX).
 * On blur the field is reset to the stored value, so the UI always ends up
 * reflecting the actual setting instead of a rejected user input.
 */
export function setupNumberInput(
    input: TextComponent,
    options: {
        min?: number,
        max?: number,
        fallback?: number,
        get: () => number,
        set: (value: number) => unknown
    }
): void {
    input.onChange(async (value) => {
        if (value === "" && options.fallback !== undefined) {
            await options.set(options.fallback);
            return;
        }
        const n = parseFloat(value);
        if (isNaN(n)) return;
        await options.set(Math.clamp(n, options.min ?? -Infinity, options.max ?? Infinity));
    });
    input.inputEl.addEventListener("blur", () => {
        input.setValue(options.get().toString());
    });
}
