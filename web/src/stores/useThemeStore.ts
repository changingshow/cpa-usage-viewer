/**
 * 主题状态管理
 * 从原项目 src/modules/theme.js 迁移
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '@/types';
import { STORAGE_KEY_THEME } from '@/utils/constants';

type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  initializeTheme: () => () => void;
}

const normalizeTheme = (theme: unknown): Theme => {
  return theme === 'dark' ? 'dark' : 'white';
};

const applyTheme = (theme: Theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    return;
  }

  document.documentElement.setAttribute('data-theme', 'white');
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'white',
      resolvedTheme: 'light',

      setTheme: (theme) => {
        const normalizedTheme = normalizeTheme(theme);
        applyTheme(normalizedTheme);
        set({
          theme: normalizedTheme,
          resolvedTheme: normalizedTheme === 'dark' ? 'dark' : 'light',
        });
      },

      cycleTheme: () => {
        const { theme, setTheme } = get();
        const order: Theme[] = ['white', 'dark'];
        const currentIndex = order.indexOf(theme);
        const nextTheme = order[(currentIndex + 1) % order.length];
        setTheme(nextTheme);
      },

      initializeTheme: () => {
        const { theme, setTheme } = get();

        // 应用已保存的主题
        setTheme(theme);

        return () => {};
      },
    }),
    {
      name: STORAGE_KEY_THEME,
    }
  )
);
