import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_LANGUAGE_ID, LANGUAGES, type LanguageOption } from '@/constants/languages';

type LanguageSettingsContextValue = {
  selectedLanguage: LanguageOption;
  selectedLanguageId: string;
  setSelectedLanguageId: (languageId: string) => void;
};

const LanguageSettingsContext = createContext<LanguageSettingsContextValue | null>(null);

export function LanguageSettingsProvider({ children }: { children: ReactNode }) {
  const [selectedLanguageId, setSelectedLanguageId] = useState(DEFAULT_LANGUAGE_ID);

  const selectedLanguage = useMemo(
    () =>
      LANGUAGES.find((language) => language.id === selectedLanguageId) ??
      LANGUAGES.find((language) => language.id === DEFAULT_LANGUAGE_ID) ??
      LANGUAGES[0],
    [selectedLanguageId]
  );

  const value = useMemo(
    () => ({ selectedLanguage, selectedLanguageId, setSelectedLanguageId }),
    [selectedLanguage, selectedLanguageId]
  );

  return (
    <LanguageSettingsContext.Provider value={value}>
      {children}
    </LanguageSettingsContext.Provider>
  );
}

export function useLanguageSettings() {
  const value = useContext(LanguageSettingsContext);

  if (!value) {
    throw new Error('useLanguageSettings must be used inside LanguageSettingsProvider');
  }

  return value;
}
