export const LIMITS = Object.freeze({
    maxPromptChars: 20000,
    maxBodyBytes: 64 * 1024,
    sendTimeoutMs: 30000,
    keepaliveMs: 15000,
    maxEntries: 500,
    /** Entries in api/bootstrap: the newest turns, for a first paint before the SSE snapshot. */
    bootstrapEntries: 60,
    /** Answering a prompt must stay well under the gateway's upstream timeout. */
    respondTimeoutMs: 20000,
    maxPrompts: 20,
    maxAnswerChars: 4000,
    maxPromptDetailChars: 4000,
    maxPlanChars: 20000,
    maxChoices: 20,
    maxFormFields: 20,
    /** A phone app reported as focused is skipped by notifications until this long after its last report. */
    pushPresenceTtlMs: 45000,
});
