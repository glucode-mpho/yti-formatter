export type SectionName = "yesterday" | "today" | "impediments";

export type StandupSections = {
  yesterday: string[];
  today: string[];
  impediments: string[];
};

export type StandupEntry = {
  id: string;
  dateISO: string;
  displayName: string;
  rawTranscript: string;
  formattedText: string;
  markdownContent: string;
  markdownFileName: string;
  sections: StandupSections;
  createdAt: string;
};
