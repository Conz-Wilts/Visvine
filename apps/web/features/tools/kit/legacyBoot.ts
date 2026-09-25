/**
 * Booting a Tool written for kit 1: the same runtime, with kit 1's whole
 * stylesheet. Its own module so kit 2's bundle never carries kit 1's rules.
 */
import type { ComponentType } from 'react';
import { bootTool, type BootOptions } from './runtime';
import { KIT_CSS } from './legacy/styles';

export function bootLegacyTool(
  loadModule: () => Promise<{ default: ComponentType }>,
  options: BootOptions = {},
): Promise<void> {
  return bootTool(loadModule, { ...options, css: options.css ?? KIT_CSS });
}
