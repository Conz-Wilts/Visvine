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

// ─── Constants matching our message bubble CSS ───────────────────────────────

// Font used in message bubbles: text-sm = 14px, leading-relaxed = 1.625
const MESSAGE_FONT = '14px "Open Sauce One", ui-sans-serif, system-ui, sans-serif';
const MESSAGE_LINE_HEIGHT = 22.75; // 14px * 1.625

// Bubble chrome (padding, margins, etc.)
const BUBBLE_PADDING_X = 28; // px-3.5 = 14px * 2
const BUBBLE_PADDING_Y = 20; // py-2.5 = 10px * 2
const SENDER_NAME_HEIGHT = 20; // 11px font + margin, only for incoming messages
const TIMESTAMP_HEIGHT = 18; // 10px font + mt-1
const MESSAGE_GAP = 6; // space-y-1.5 equivalent (py-0.75 * 2 on wrapper)

// Additional chrome heights
const REPLY_PREVIEW_HEIGHT = 44; // reply quote above bubble
const REACTION_ROW_HEIGHT = 26; // reaction pills below bubble
const IMAGE_SINGLE_HEIGHT = 262; // max-h-64 + mt-1.5
const IMAGE_GRID_HEIGHT = 134; // h-32 + mt-1.5 + gap
const LINK_PREVIEW_HEIGHT = 180; // image + text card
const DELETED_MESSAGE_HEIGHT = 40; // fixed height for deleted messages

// Max bubble widths as fraction of container (matching CSS max-w-[78%] / max-w-[65%])
const BUBBLE_MAX_WIDTH_MOBILE = 0.78;
const BUBBLE_MAX_WIDTH_DESKTOP = 0.65;

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
    return DELETED_MESSAGE_HEIGHT + MESSAGE_GAP;
  }

  const maxWidthFraction = isMobile ? BUBBLE_MAX_WIDTH_MOBILE : BUBBLE_MAX_WIDTH_DESKTOP;
  const maxBubbleWidth = containerWidth * maxWidthFraction;
  const textMaxWidth = maxBubbleWidth - BUBBLE_PADDING_X;

  let height = 0;

  // Sender name (only for incoming messages)
  if (!message.isOwn) {
    height += SENDER_NAME_HEIGHT;
  }

  // Reply preview above bubble
  if (message.replyTo) {
    height += REPLY_PREVIEW_HEIGHT;
  }

  // Bubble padding top
  height += BUBBLE_PADDING_Y / 2;

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

  // Timestamp row (always present)
  height += TIMESTAMP_HEIGHT;

  // Bubble padding bottom
  height += BUBBLE_PADDING_Y / 2;

  // Reactions row below bubble
  if (message.reactions && message.reactions.length > 0) {
    height += REACTION_ROW_HEIGHT;
  }

  // Gap between messages
  height += MESSAGE_GAP;

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
