const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export const extractEmailsFromText = (text: string): string[] => {
  if (!text) {
    return [];
  }

  const matches = text.match(EMAIL_REGEX);
  return matches ?? [];
};
