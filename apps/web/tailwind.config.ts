import type { Config } from 'tailwindcss';
import { dasignaturePreset } from '@dasignature/ui/tailwind-preset';

export default {
  presets: [dasignaturePreset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
