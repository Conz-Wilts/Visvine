'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';

const MAX_VISIBLE_ROWS = 5;

interface ChatInterfaceProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  buttonIcon?: ReactNode;
  hideSubmitButton?: boolean;
  className?: string;
}

export default function ChatInterface({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type your message...',
  buttonIcon,
  hideSubmitButton = false,
  className = ''
}: ChatInterfaceProps = {}) {
  const isControlled = value !== undefined;
  const [internalMessage, setInternalMessage] = useState('');
  const message = isControlled ? value ?? '' : internalMessage;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const baseButtonClasses = `
    w-9
    h-9
    bg-brand-green
    hover:bg-brand-green
    disabled:bg-gray-300
    disabled:cursor-not-allowed
    rounded-full
    flex
    items-center
    justify-center
    transition-colors
    duration-200
    shadow-sm
  `;

  const renderedButtonIcon = buttonIcon ?? (
    <svg
      className="w-4 h-4 text-white"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
        d="M4 12h16M20 12l-6-6M20 12l-6 6"
      />
    </svg>
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    onSubmit?.(trimmedMessage);

    if (!isControlled) {
      setInternalMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInputChange = (nextValue: string) => {
    if (!isControlled) {
      setInternalMessage(nextValue);
    }
    onChange?.(nextValue);
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const parseValue = (value: string) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const styles = window.getComputedStyle(textarea);
    const lineHeight = parseValue(styles.lineHeight) || parseValue(styles.fontSize) * 1.2 || 20;
    const verticalPadding = parseValue(styles.paddingTop) + parseValue(styles.paddingBottom);
    const verticalBorder = parseValue(styles.borderTopWidth) + parseValue(styles.borderBottomWidth);
    const maxHeight = lineHeight * MAX_VISIBLE_ROWS + verticalPadding + verticalBorder;

    textarea.style.height = 'auto';
    textarea.style.maxHeight = `${maxHeight}px`;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    const hasOverflow = textarea.scrollHeight > maxHeight;
    textarea.style.overflowY = hasOverflow ? 'auto' : 'hidden';
    setIsOverflowing(hasOverflow);
  }, [message]);

  const hasContent = Boolean(message.trim());
  const shouldShowInlineButton = !hideSubmitButton && !isOverflowing;
  const shouldShowStackedButton = !hideSubmitButton && isOverflowing;

  return (
    <div className={`w-full max-w-3xl mx-auto ${className}`}>
      <form onSubmit={handleSubmit} className="relative">
        <div className="bg-surface-2 border border-border-default rounded-full overflow-hidden focus-within:border-border-default transition-all duration-200 px-3 py-3 relative shadow-sm">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={placeholder}
            className={`
              block
              w-full
              py-2
              pl-4
              ${shouldShowInlineButton ? 'pr-12' : 'pr-4'}
              text-base
              text-text-primary
              bg-transparent
              resize-none
              focus:outline-none
              transition-all
              duration-200
              placeholder:text-text-muted
              leading-tight
            `}
            style={{ height: 'auto' }}
          />
          {shouldShowStackedButton && (
            <div className="flex justify-end mt-2">
              <button
                type="submit"
                disabled={!hasContent}
                className={baseButtonClasses}
              >
                {renderedButtonIcon}
              </button>
            </div>
          )}
          {shouldShowInlineButton && (
            <button
              type="submit"
              disabled={!hasContent}
              className={`${baseButtonClasses} absolute right-2 top-1/2 -translate-y-1/2`}
            >
              {renderedButtonIcon}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
