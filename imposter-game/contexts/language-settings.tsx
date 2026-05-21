import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { DEFAULT_LANGUAGE_ID, LANGUAGES, type LanguageOption } from '@/constants/languages';

type LanguageSettingsContextValue = {
  selectedLanguage: LanguageOption;
  selectedLanguageId: string;
  setSelectedLanguageId: (languageId: string) => void;
};

const LanguageSettingsContext = createContext<LanguageSettingsContextValue | null>(null);
const LANGUAGE_STORAGE_KEY = 'imposter:selected-language-id';

const isSupportedLanguageId = (languageId: string) =>
  LANGUAGES.some((language) => language.id === languageId);

export function LanguageSettingsProvider({ children }: { children: ReactNode }) {
  const [selectedLanguageId, setSelectedLanguageId] = useState(DEFAULT_LANGUAGE_ID);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((storedLanguageId) => {
        if (isMounted && storedLanguageId && isSupportedLanguageId(storedLanguageId)) {
          setSelectedLanguageId(storedLanguageId);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  const updateSelectedLanguageId = useCallback((languageId: string) => {
    const nextLanguageId = isSupportedLanguageId(languageId) ? languageId : DEFAULT_LANGUAGE_ID;

    setSelectedLanguageId(nextLanguageId);
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguageId).catch(() => undefined);
  }, []);

  const selectedLanguage = useMemo(
    () =>
      LANGUAGES.find((language) => language.id === selectedLanguageId) ??
      LANGUAGES.find((language) => language.id === DEFAULT_LANGUAGE_ID) ??
      LANGUAGES[0],
    [selectedLanguageId]
  );

  const value = useMemo(
    () => ({
      selectedLanguage,
      selectedLanguageId,
      setSelectedLanguageId: updateSelectedLanguageId,
    }),
    [selectedLanguage, selectedLanguageId, updateSelectedLanguageId]
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
