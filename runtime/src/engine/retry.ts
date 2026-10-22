/**
 * Retry utilities for LLM calls
 *
 * Provides exponential backoff retry logic for resilient API calls.
 */

interface RetryOptions {
	maxRetries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	shouldRetry?: (error: Error) => boolean;
	onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<
	Omit<RetryOptions, "onRetry" | "shouldRetry">
> = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
};

/**
 * Check if an error is retryable (network errors, rate limits, server errors)
 */
export function isRetryableError(error: Error): boolean {
	const message = error.message.toLowerCase();

	// Rate limiting
	if (
		message.includes("rate limit") ||
		message.includes("429") ||
		message.includes("too many")
	) {
		return true;
	}

	// Server errors (5xx)
	if (
		message.includes("500") ||
		message.includes("502") ||
		message.includes("503") ||
		message.includes("504")
	) {
		return true;
	}

	// Network errors
	if (
		message.includes("network") ||
		message.includes("timeout") ||
		message.includes("econnreset") ||
		message.includes("econnrefused") ||
		message.includes("socket") ||
		message.includes("connection")
	) {
		return true;
	}

	// Temporary failures
	if (
		message.includes("temporarily unavailable") ||
		message.includes("try again")
	) {
		return true;
	}

	return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for a given attempt using exponential backoff with jitter
 */
function calculateDelay(
	attempt: number,
	initialDelayMs: number,
	maxDelayMs: number,
): number {
	// Exponential backoff: delay = initial * 2^attempt
	const exponentialDelay = initialDelayMs * 2 ** attempt;

	// Add jitter (0-25% of the delay)
	const jitter = exponentialDelay * Math.random() * 0.25;

	// Cap at max delay
	return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Execute a function with exponential backoff retry logic
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const {
		maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
		initialDelayMs = DEFAULT_RETRY_OPTIONS.initialDelayMs,
		maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
		shouldRetry = isRetryableError,
		onRetry,
	} = options;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Check if we should retry
			if (attempt < maxRetries && shouldRetry(lastError)) {
				const delayMs = calculateDelay(attempt, initialDelayMs, maxDelayMs);

				if (onRetry) {
					onRetry(attempt + 1, lastError, delayMs);
				}

				await sleep(delayMs);
			} else {
				throw lastError;
			}
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError ?? new Error("Unknown error in retry loop");
}

/**
 * Create a retry wrapper with pre-configured options
 */
export function createRetryWrapper(defaultOptions: RetryOptions = {}) {
	return <T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> => {
		return withRetry(fn, { ...defaultOptions, ...options });
	};
}
