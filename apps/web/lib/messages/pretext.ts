/**
 * Pretext integration for message height calculation.
 *
 * Uses @chenglou/pretext to calculate message bubble heights without DOM reflow.
 * prepare() runs once per message text (cached), layout() is pure arithmetic on resize.
 *
 * This enables accurate scroll positioning, flicker-free virtualization, and instant
 * height recalculation on window resize.
 */

import { prepare, layout, type PreparedText } from '@chenglou/pretext';
import type { SerializedMessage } from './types';

// ─── Constants matching the linear MessageRow CSS ────────────────────────────

// Message body text: text-[15px], leading-relaxed = 1.625
const MESSAGE_FONT = '15px "Open Sauce One", ui-sans-serif, system-ui, sans-serif';
const MESSAGE_LINE_HEIGHT = 24.375; // 15px * 1.625

// Row chrome: avatar gutter (h-9 w-9 + gap-3), row padding, and bubble card
const AVATAR_GUTTER_WIDTH = 48; // w-9 (36px) + gap-3 (12px)
const ROW_PADDING_X = 24; // px-3 = 12px * 2 on the row
const ROW_PADDING_Y = 8; // py-1 = 4px * 2 on the row
const BUBBLE_PADDING_X = 34; // px-4 = 16px * 2 + 1px border each side
const BUBBLE_PADDING_Y = 22; // py-2.5 = 10px * 2 + 1px border each side
const HEADER_LINE_HEIGHT = 20; // name · time line (13px semibold + baseline gap)

// Additional chrome heights
const REPLY_PREVIEW_HEIGHT = 46; // reply quote above the body
const REACTION_ROW_HEIGHT = 26; // reaction pills below the body
const IMAGE_SINGLE_HEIGHT = 262; // max-h-64 + mt-1.5
const IMAGE_GRID_HEIGHT = 134; // h-32 + mt-1.5 + gap
const LINK_PREVIEW_HEIGHT = 180; // image + text card
const DELETED_MESSAGE_HEIGHT = 28; // fixed height for deleted messages

// The feed spans the full width between the side boxes; the ResizeObserver measures
// the feed container directly, minus the row's px-6 (24px each side) on desktop.
const FEED_HORIZONTAL_PADDING = 48;

// ─── Cache ───────────────────────────────────────────────────────────────────

const preparedCache = new Map<string, PreparedText>();

function getPrepared(text: string): PreparedText {
  let cached = preparedCache.get(text);
  if (!cached) {
    cached = prepare(text, MESSAGE_FONT);
    preparedCache.set(text, cached);

    // Evict old entries if cache grows too large
    if (preparedCache.size > 2000) {
      const iter = preparedCache.keys();
      for (let i = 0; i < 500; i++) {
        const key = iter.next().value;
        if (key !== undefined) preparedCache.delete(key);
      }
    }
  }
  return cached;
}

// ─── Height calculation ──────────────────────────────────────────────────────

export interface MessageHeightOptions {
  /** Width of the messages container in pixels */
  containerWidth: number;
  /** Whether we're on mobile (affects max bubble width) */
  isMobile?: boolean;
}

/**
 * Calculate the pixel height of a single message bubble including all chrome.
 * Uses pretext for text measurement — no DOM reflow.
 */
export function calculateMessageHeight(
  message: SerializedMessage,
  options: MessageHeightOptions,
): number {
  const { containerWidth, isMobile = false } = options;

  // Deleted messages have fixed height
  if (message.deletedAt) {
    return DELETED_MESSAGE_HEIGHT;
  }

  const effectiveWidth = isMobile ? containerWidth : containerWidth - FEED_HORIZONTAL_PADDING;
  const textMaxWidth = effectiveWidth - ROW_PADDING_X - AVATAR_GUTTER_WIDTH - BUBBLE_PADDING_X;

  let height = ROW_PADDING_Y + BUBBLE_PADDING_Y;

  // Name · time header line. Whether it renders depends on sender grouping
  // (decided at render time), so estimate with half its height on average.
  height += HEADER_LINE_HEIGHT / 2;

  // Reply preview above the body
  if (message.replyTo) {
    height += REPLY_PREVIEW_HEIGHT;
  }

  // Text content height via pretext
  if (message.text) {
    const prepared = getPrepared(message.text);
    const result = layout(prepared, textMaxWidth, MESSAGE_LINE_HEIGHT);
    height += result.height;
  }

  // Images
  if (message.images && message.images.length > 0) {
    if (message.images.length === 1) {
      height += IMAGE_SINGLE_HEIGHT;
    } else {
      height += IMAGE_GRID_HEIGHT;
    }
  }

  // Link previews
  if (message.linkPreviews && message.linkPreviews.length > 0) {
    height += LINK_PREVIEW_HEIGHT * message.linkPreviews.length;
  }

  // Reactions row below the body
  if (message.reactions && message.reactions.length > 0) {
    height += REACTION_ROW_HEIGHT;
  }

  return Math.ceil(height);
}

/**
 * Batch-calculate heights for an array of messages.
 * prepare() is called once per unique text; layout() is pure arithmetic.
 */
export function calculateMessageHeights(
  messages: SerializedMessage[],
  options: MessageHeightOptions,
): number[] {
  return messages.map((msg) => calculateMessageHeight(msg, options));
}

/**
 * Get total height of all messages. Useful for scroll calculations.
 */
export function calculateTotalHeight(
  messages: SerializedMessage[],
  options: MessageHeightOptions,
): number {
  let total = 0;
  for (const msg of messages) {
    total += calculateMessageHeight(msg, options);
  }
  return total;
}

/**
 * Clear the pretext preparation cache.
 * Call when font changes or on memory pressure.
 */
export function clearPretextCache(): void {
  preparedCache.clear();
}
