import {
  deleteSkill,
  getSkill,
  listSkills,
  type Skill,
  saveSkill,
} from "../../automation/skills-store";
import { buildUserScriptsGuidance, getUserScriptsStatus } from "../../automation/userscripts";
import { readPresetOrCustomValue, resolvePresetOrCustom } from "../../lib/combo";
import { defaultSettings, loadSettings, saveSettings } from "../../lib/settings";
import { applyTheme, type ColorMode, type ColorScheme } from "../../lib/theme";
import { mountCheckbox } from "../../ui/zag-checkbox";
import { createDaemonStatusChecker } from "./daemon-status";
import { createLogsViewer } from "./logs-viewer";
import { createModelPresetsController } from "./model-presets";
import { mountOptionsPickers } from "./pickers";
import { createProcessesViewer } from "./processes-viewer";
import { createOptionsTabs } from "./tab-controller";

declare const __SUMMARIZE_GIT_HASH__: string;
declare const __SUMMARIZE_VERSION__: string;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const formEl = byId<HTMLFormElement>("form");
const statusEl = byId<HTMLSpanElement>("status");

const tokenEl = byId<HTMLInputElement>("token");
const tokenCopyBtn = byId<HTMLButtonElement>("tokenCopy");
const modelPresetEl = byId<HTMLSelectElement>("modelPreset");
const modelCustomEl = byId<HTMLInputElement>("modelCustom");
const languagePresetEl = byId<HTMLSelectElement>("languagePreset");
const languageCustomEl = byId<HTMLInputElement>("languageCustom");
const promptOverrideEl = byId<HTMLTextAreaElement>("promptOverride");
const autoToggleRoot = byId<HTMLDivElement>("autoToggle");
const maxCharsEl = byId<HTMLInputElement>("maxChars");
const hoverPromptEl = byId<HTMLTextAreaElement>("hoverPrompt");
const hoverPromptResetBtn = byId<HTMLButtonElement>("hoverPromptReset");
const chatToggleRoot = byId<HTMLDivElement>("chatToggle");
const automationToggleRoot = byId<HTMLDivElement>("automationToggle");
const automationPermissionsBtn = byId<HTMLButtonElement>("automationPermissions");
const userScriptsNoticeEl = byId<HTMLDivElement>("userScriptsNotice");
const skillsExportBtn = byId<HTMLButtonElement>("skillsExport");
const skillsImportBtn = byId<HTMLButtonElement>("skillsImport");
const skillsSearchEl = byId<HTMLInputElement>("skillsSearch");
const skillsListEl = byId<HTMLDivElement>("skillsList");
const skillsEmptyEl = byId<HTMLDivElement>("skillsEmpty");
const skillsConflictsEl = byId<HTMLDivElement>("skillsImportConflicts");
const hoverSummariesToggleRoot = byId<HTMLDivElement>("hoverSummariesToggle");
const summaryTimestampsToggleRoot = byId<HTMLDivElement>("summaryTimestampsToggle");
const slidesParallelToggleRoot = byId<HTMLDivElement>("slidesParallelToggle");
const slidesOcrToggleRoot = byId<HTMLDivElement>("slidesOcrToggle");
const extendedLoggingToggleRoot = byId<HTMLDivElement>("extendedLoggingToggle");
const autoCliFallbackToggleRoot = byId<HTMLDivElement>("autoCliFallbackToggle");
const autoCliOrderEl = byId<HTMLInputElement>("autoCliOrder");
const requestModeEl = byId<HTMLSelectElement>("requestMode");
const firecrawlModeEl = byId<HTMLSelectElement>("firecrawlMode");
const markdownModeEl = byId<HTMLSelectElement>("markdownMode");
const preprocessModeEl = byId<HTMLSelectElement>("preprocessMode");
const youtubeModeEl = byId<HTMLSelectElement>("youtubeMode");
const transcriberEl = byId<HTMLSelectElement>("transcriber");
const timeoutEl = byId<HTMLInputElement>("timeout");
const retriesEl = byId<HTMLInputElement>("retries");
const maxOutputTokensEl = byId<HTMLInputElement>("maxOutputTokens");
const pickersRoot = byId<HTMLDivElement>("pickersRoot");
const fontFamilyEl = byId<HTMLInputElement>("fontFamily");
const fontSizeEl = byId<HTMLInputElement>("fontSize");
const buildInfoEl = document.getElementById("buildInfo");
const daemonStatusEl = byId<HTMLDivElement>("daemonStatus");
const logsSourceEl = byId<HTMLSelectElement>("logsSource");
const logsTailEl = byId<HTMLInputElement>("logsTail");
const logsRefreshBtn = byId<HTMLButtonElement>("logsRefresh");
const logsAutoEl = byId<HTMLInputElement>("logsAuto");
const logsOutputEl = byId<HTMLDivElement>("logsOutput");
const logsRawEl = byId<HTMLPreElement>("logsRaw");
const logsTableEl = byId<HTMLTableElement>("logsTable");
const logsParsedEl = byId<HTMLInputElement>("logsParsed");
const logsMetaEl = byId<HTMLDivElement>("logsMeta");
const processesRefreshBtn = byId<HTMLButtonElement>("processesRefresh");
const processesAutoEl = byId<HTMLInputElement>("processesAuto");
const processesShowCompletedEl = byId<HTMLInputElement>("processesShowCompleted");
const processesLimitEl = byId<HTMLInputElement>("processesLimit");
const processesStreamEl = byId<HTMLSelectElement>("processesStream");
const processesTailEl = byId<HTMLInputElement>("processesTail");
const processesMetaEl = byId<HTMLDivElement>("processesMeta");
const processesTableEl = byId<HTMLTableElement>("processesTable");
const processesLogsTitleEl = byId<HTMLDivElement>("processesLogsTitle");
const processesLogsCopyBtn = byId<HTMLButtonElement>("processesLogsCopy");
const processesLogsOutputEl = byId<HTMLPreElement>("processesLogsOutput");
const tabsRoot = byId<HTMLDivElement>("tabs");
const tabButtons = Array.from(tabsRoot.querySelectorAll<HTMLButtonElement>("[data-tab]"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]"));

const tabStorageKey = "summarize:options-tab";

let autoValue = defaultSettings.autoSummarize;
let chatEnabledValue = defaultSettings.chatEnabled;
let automationEnabledValue = defaultSettings.automationEnabled;
let hoverSummariesValue = defaultSettings.hoverSummaries;
let summaryTimestampsValue = defaultSettings.summaryTimestamps;
let slidesParallelValue = defaultSettings.slidesParallel;
let slidesOcrEnabledValue = defaultSettings.slidesOcrEnabled;
let extendedLoggingValue = defaultSettings.extendedLogging;
let autoCliFallbackValue = defaultSettings.autoCliFallback;

let skillsCache: Skill[] = [];
let skillsFiltered: Skill[] = [];
let skillsSearchQuery = "";
let editingSkill: Skill | null = null;
let importConflicts: Array<{ skill: Skill; selected: boolean }> = [];
let importedSkills: Skill[] = [];

let isInitializing = true;
let saveTimer = 0;
let saveInFlight = false;
let saveQueued = false;
let saveSequence = 0;

const setStatus = (text: string) => {
  statusEl.textContent = text;
};

const logsLevelInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>("input[data-log-level]"),
);

const logsViewer = createLogsViewer({
  elements: {
    sourceEl: logsSourceEl,
    tailEl: logsTailEl,
    refreshBtn: logsRefreshBtn,
    autoEl: logsAutoEl,
    outputEl: logsOutputEl,
    rawEl: logsRawEl,
    tableEl: logsTableEl,
    parsedEl: logsParsedEl,
    metaEl: logsMetaEl,
    levelInputs: logsLevelInputs,
  },
  getToken: () => tokenEl.value.trim(),
  isActive: () => resolveActiveTab() === "logs",
});

const processesViewer = createProcessesViewer({
  elements: {
    refreshBtn: processesRefreshBtn,
    autoEl: processesAutoEl,
    showCompletedEl: processesShowCompletedEl,
    limitEl: processesLimitEl,
    streamEl: processesStreamEl,
    tailEl: processesTailEl,
    metaEl: processesMetaEl,
    tableEl: processesTableEl,
    logsTitleEl: processesLogsTitleEl,
    logsCopyBtn: processesLogsCopyBtn,
    logsOutputEl: processesLogsOutputEl,
  },
  getToken: () => tokenEl.value.trim(),
  isActive: () => resolveActiveTab() === "processes",
});

const { resolveActiveTab } = createOptionsTabs({
  root: tabsRoot,
  buttons: tabButtons,
  panels: tabPanels,
  storageKey: tabStorageKey,
  onLogsActiveChange: (active) => {
    if (active) {
      logsViewer.handleTabActivated();
    } else {
      logsViewer.handleTabDeactivated();
    }
  },
  onProcessesActiveChange: (active) => {
    if (active) {
      processesViewer.handleTabActivated();
    } else {
      processesViewer.handleTabDeactivated();
    }
  },
});

let statusTimer = 0;
const flashStatus = (text: string, duration = 900) => {
  window.clearTimeout(statusTimer);
  setStatus(text);
  statusTimer = window.setTimeout(() => setStatus(""), duration);
};

const scheduleAutoSave = (delay = 500) => {
  if (isInitializing) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveNow();
  }, delay);
};

const saveNow = async () => {
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  saveQueued = false;
  const currentSeq = ++saveSequence;
  setStatus("Saving…");
  try {
    const current = await loadSettings();
    await saveSettings({
      token: tokenEl.value || defaultSettings.token,
      model: modelPresets.readCurrentValue(),
      length: current.length,
      language: readPresetOrCustomValue({
        presetValue: languagePresetEl.value,
        customValue: languageCustomEl.value,
        defaultValue: defaultSettings.language,
      }),
      promptOverride: promptOverrideEl.value || defaultSettings.promptOverride,
      hoverPrompt: hoverPromptEl.value || defaultSettings.hoverPrompt,
      autoSummarize: autoValue,
      hoverSummaries: hoverSummariesValue,
      chatEnabled: chatEnabledValue,
      automationEnabled: automationEnabledValue,
      slidesEnabled: current.slidesEnabled,
      slidesParallel: slidesParallelValue,
      slidesOcrEnabled: slidesOcrEnabledValue,
      slidesLayout: current.slidesLayout,
      summaryTimestamps: summaryTimestampsValue,
      extendedLogging: extendedLoggingValue,
      autoCliFallback: autoCliFallbackValue,
      autoCliOrder: autoCliOrderEl.value || defaultSettings.autoCliOrder,
      maxChars: Number(maxCharsEl.value) || defaultSettings.maxChars,
      requestMode: requestModeEl.value || defaultSettings.requestMode,
      firecrawlMode: firecrawlModeEl.value || defaultSettings.firecrawlMode,
      markdownMode: markdownModeEl.value || defaultSettings.markdownMode,
      preprocessMode: preprocessModeEl.value || defaultSettings.preprocessMode,
      youtubeMode: youtubeModeEl.value || defaultSettings.youtubeMode,
      transcriber: transcriberEl.value || defaultSettings.transcriber,
      timeout: timeoutEl.value || defaultSettings.timeout,
      retries: (() => {
        const raw = retriesEl.value.trim();
        if (!raw) return defaultSettings.retries;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : defaultSettings.retries;
      })(),
      maxOutputTokens: maxOutputTokensEl.value || defaultSettings.maxOutputTokens,
      colorScheme: currentScheme || defaultSettings.colorScheme,
      colorMode: currentMode || defaultSettings.colorMode,
      fontFamily: fontFamilyEl.value || defaultSettings.fontFamily,
      fontSize: Number(fontSizeEl.value) || defaultSettings.fontSize,
    });
    if (currentSeq === saveSequence) {
      flashStatus("Saved");
    }
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      void saveNow();
    }
  }
};

const setBuildInfo = () => {
  if (!buildInfoEl) return;
  const version =
    typeof __SUMMARIZE_VERSION__ === "string" && __SUMMARIZE_VERSION__
      ? __SUMMARIZE_VERSION__
      : chrome?.runtime?.getManifest?.().version;
  const hash = typeof __SUMMARIZE_GIT_HASH__ === "string" ? __SUMMARIZE_GIT_HASH__ : "";
  const parts: string[] = [];
  if (version) parts.push(`v${version}`);
  if (hash && hash !== "unknown") parts.push(hash);
  buildInfoEl.textContent = parts.join(" · ");
  buildInfoEl.toggleAttribute("hidden", parts.length === 0);
};

const resolveExtensionVersion = () => {
  const injected =
    typeof __SUMMARIZE_VERSION__ === "string" && __SUMMARIZE_VERSION__ ? __SUMMARIZE_VERSION__ : "";
  return injected || chrome?.runtime?.getManifest?.().version || "";
};

const { checkDaemonStatus } = createDaemonStatusChecker({
  statusEl: daemonStatusEl,
  getExtensionVersion: resolveExtensionVersion,
});

const modelPresets = createModelPresetsController({
  presetEl: modelPresetEl,
  customEl: modelCustomEl,
  defaultValue: defaultSettings.model,
});

const languagePresets = [
  "auto",
  "en",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "nl",
  "sv",
  "no",
  "da",
  "fi",
  "pl",
  "cs",
  "tr",
  "ru",
  "uk",
  "ar",
  "hi",
  "ja",
  "ko",
  "zh-cn",
  "zh-tw",
];

let currentScheme: ColorScheme = defaultSettings.colorScheme;
let currentMode: ColorMode = defaultSettings.colorMode;

const pickerHandlers = {
  onSchemeChange: (value: ColorScheme) => {
    currentScheme = value;
    applyTheme({ scheme: currentScheme, mode: currentMode });
    scheduleAutoSave(200);
  },
  onModeChange: (value: ColorMode) => {
    currentMode = value;
    applyTheme({ scheme: currentScheme, mode: currentMode });
    scheduleAutoSave(200);
  },
};

const pickers = mountOptionsPickers(pickersRoot, {
  scheme: currentScheme,
  mode: currentMode,
  ...pickerHandlers,
});

const updateAutoToggle = () => {
  autoToggle.update({
    id: "options-auto",
    label: "Auto-summarize when panel is open",
    checked: autoValue,
    onCheckedChange: handleAutoToggleChange,
  });
};
const handleAutoToggleChange = (checked: boolean) => {
  autoValue = checked;
  updateAutoToggle();
  scheduleAutoSave(0);
};
const autoToggle = mountCheckbox(autoToggleRoot, {
  id: "options-auto",
  label: "Auto-summarize when panel is open",
  checked: autoValue,
  onCheckedChange: handleAutoToggleChange,
});

const updateChatToggle = () => {
  chatToggle.update({
    id: "options-chat",
    label: "Enable Chat mode in the side panel",
    checked: chatEnabledValue,
    onCheckedChange: handleChatToggleChange,
  });
};
const handleChatToggleChange = (checked: boolean) => {
  chatEnabledValue = checked;
  updateChatToggle();
  scheduleAutoSave(0);
};
const chatToggle = mountCheckbox(chatToggleRoot, {
  id: "options-chat",
  label: "Enable Chat mode in the side panel",
  checked: chatEnabledValue,
  onCheckedChange: handleChatToggleChange,
});

const updateAutomationToggle = () => {
  automationToggle.update({
    id: "options-automation",
    label: "Enable website automation",
    checked: automationEnabledValue,
    onCheckedChange: handleAutomationToggleChange,
  });
};
const handleAutomationToggleChange = (checked: boolean) => {
  automationEnabledValue = checked;
  updateAutomationToggle();
  scheduleAutoSave(0);
  void updateAutomationPermissionsUi();
};
const automationToggle = mountCheckbox(automationToggleRoot, {
  id: "options-automation",
  label: "Enable website automation",
  checked: automationEnabledValue,
  onCheckedChange: handleAutomationToggleChange,
});

async function updateAutomationPermissionsUi() {
  const status = await getUserScriptsStatus();
  const hasPermission = status.permissionGranted;
  const apiAvailable = status.apiAvailable;

  automationPermissionsBtn.disabled = !chrome.permissions || (hasPermission && apiAvailable);
  automationPermissionsBtn.textContent = hasPermission
    ? "Automation permissions granted"
    : "Enable automation permissions";

  if (!automationEnabledValue) {
    userScriptsNoticeEl.hidden = true;
    return;
  }

  if (apiAvailable && hasPermission) {
    userScriptsNoticeEl.hidden = true;
    return;
  }

  const steps = [buildUserScriptsGuidance(status)].filter(Boolean);

  userScriptsNoticeEl.textContent = steps.join(" ");
  userScriptsNoticeEl.hidden = false;
}

async function requestAutomationPermissions() {
  if (!chrome.permissions) return;
  try {
    const ok = await chrome.permissions.request({
      permissions: ["userScripts"],
    });
    if (!ok) {
      flashStatus("Permission request denied");
    }
  } catch {
    // ignore
  }
  await updateAutomationPermissionsUi();
}

automationPermissionsBtn.addEventListener("click", () => {
  void requestAutomationPermissions();
});

const updateSkillsEmptyState = () => {
  skillsEmptyEl.textContent = skillsSearchQuery
    ? "No skills match your search."
    : "No skills created yet.";
  skillsEmptyEl.hidden = skillsFiltered.length > 0 || importConflicts.length > 0;
};

const updateSkillDraft = (patch: Partial<Skill>) => {
  if (!editingSkill) return;
  editingSkill = { ...editingSkill, ...patch };
};

const renderSkills = () => {
  skillsListEl.replaceChildren();
  skillsConflictsEl.replaceChildren();

  if (importConflicts.length > 0) {
    skillsConflictsEl.hidden = false;
    const title = document.createElement("div");
    title.className = "skillName";
    title.textContent = "Import conflicts";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Select which skills should overwrite existing entries.";
    const list = document.createElement("div");
    list.className = "skillsConflictsList";

    importConflicts.forEach((conflict, index) => {
      const row = document.createElement("label");
      row.className = "skillsConflictItem";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = conflict.selected;
      checkbox.addEventListener("change", () => {
        importConflicts[index] = { ...conflict, selected: checkbox.checked };
      });

      const content = document.createElement("div");
      content.style.display = "grid";
      content.style.gap = "2px";

      const name = document.createElement("div");
      name.className = "skillName";
      name.textContent = conflict.skill.name;

      const domains = document.createElement("div");
      domains.className = "skillDomains";
      domains.textContent = conflict.skill.domainPatterns.join(", ");

      const desc = document.createElement("div");
      desc.className = "skillDescription";
      desc.textContent = conflict.skill.shortDescription;

      content.append(name, domains, desc);
      row.append(checkbox, content);
      list.append(row);
    });

    const actions = document.createElement("div");
    actions.className = "skillsConflictActions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "miniButton";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      importConflicts = [];
      importedSkills = [];
      renderSkills();
    });
    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "miniButton";
    importBtn.textContent = "Import selected";
    importBtn.addEventListener("click", () => {
      void performImport(importedSkills);
    });
    actions.append(cancelBtn, importBtn);

    skillsConflictsEl.append(title, hint, list, actions);
    updateSkillsEmptyState();
    return;
  }

  skillsConflictsEl.hidden = true;

  for (const skill of skillsFiltered) {
    if (editingSkill && editingSkill.name === skill.name) {
      const editor = document.createElement("div");
      editor.className = "skillEditor";

      const heading = document.createElement("div");
      heading.className = "skillName";
      heading.textContent = `Edit skill: ${editingSkill.name}`;

      const nameLabel = document.createElement("label");
      const nameLabelText = document.createElement("span");
      nameLabelText.textContent = "Name";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = editingSkill.name;
      nameInput.disabled = true;
      nameLabel.append(nameLabelText, nameInput);

      const domainLabel = document.createElement("label");
      const domainLabelText = document.createElement("span");
      domainLabelText.textContent = "Domain patterns (comma-separated)";
      const domainInput = document.createElement("input");
      domainInput.type = "text";
      domainInput.value = editingSkill.domainPatterns.join(", ");
      domainInput.addEventListener("input", () => {
        const patterns = domainInput.value
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        updateSkillDraft({ domainPatterns: patterns });
      });
      domainLabel.append(domainLabelText, domainInput);

      const shortLabel = document.createElement("label");
      const shortText = document.createElement("span");
      shortText.textContent = "Short description";
      const shortInput = document.createElement("input");
      shortInput.type = "text";
      shortInput.value = editingSkill.shortDescription;
      shortInput.addEventListener("input", () =>
        updateSkillDraft({ shortDescription: shortInput.value }),
      );
      shortLabel.append(shortText, shortInput);

      const descriptionLabel = document.createElement("label");
      const descriptionText = document.createElement("span");
      descriptionText.textContent = "Description (Markdown)";
      const descriptionInput = document.createElement("textarea");
      descriptionInput.rows = 4;
      descriptionInput.value = editingSkill.description;
      descriptionInput.addEventListener("input", () =>
        updateSkillDraft({ description: descriptionInput.value }),
      );
      descriptionLabel.append(descriptionText, descriptionInput);

      const examplesLabel = document.createElement("label");
      const examplesText = document.createElement("span");
      examplesText.textContent = "Examples (JavaScript)";
      const examplesInput = document.createElement("textarea");
      examplesInput.rows = 4;
      examplesInput.value = editingSkill.examples;
      examplesInput.addEventListener("input", () =>
        updateSkillDraft({ examples: examplesInput.value }),
      );
      examplesLabel.append(examplesText, examplesInput);

      const libraryLabel = document.createElement("label");
      const libraryText = document.createElement("span");
      libraryText.textContent = "Library code";
      const libraryInput = document.createElement("textarea");
      libraryInput.rows = 8;
      libraryInput.value = editingSkill.library;
      libraryInput.addEventListener("input", () =>
        updateSkillDraft({ library: libraryInput.value }),
      );
      libraryLabel.append(libraryText, libraryInput);

      const actionRow = document.createElement("div");
      actionRow.className = "skillActions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "miniButton";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        editingSkill = null;
        renderSkills();
      });
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "miniButton";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", () => {
        void saveEditingSkill();
      });
      actionRow.append(cancelBtn, saveBtn);

      editor.append(
        heading,
        nameLabel,
        domainLabel,
        shortLabel,
        descriptionLabel,
        examplesLabel,
        libraryLabel,
        actionRow,
      );
      skillsListEl.append(editor);
      continue;
    }

    const card = document.createElement("div");
    card.className = "skillCard";

    const header = document.createElement("div");
    header.className = "skillHeader";

    const name = document.createElement("div");
    name.className = "skillName";
    name.textContent = skill.name;

    const domains = document.createElement("div");
    domains.className = "skillDomains";
    domains.textContent = skill.domainPatterns.join(", ");

    header.append(name, domains);

    const desc = document.createElement("div");
    desc.className = "skillDescription";
    desc.textContent = skill.shortDescription;

    const actions = document.createElement("div");
    actions.className = "skillActions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "miniButton";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      editingSkill = { ...skill };
      renderSkills();
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "miniButton";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      void deleteSkillWithPrompt(skill);
    });
    actions.append(editBtn, deleteBtn);

    card.append(header, desc, actions);
    skillsListEl.append(card);
  }

  updateSkillsEmptyState();
};

const filterSkills = () => {
  const query = skillsSearchQuery.toLowerCase();
  skillsFiltered = skillsCache.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) ||
      skill.shortDescription.toLowerCase().includes(query) ||
      skill.domainPatterns.some((pattern) => pattern.toLowerCase().includes(query)),
  );
  renderSkills();
};

const loadSkills = async () => {
  skillsCache = (await listSkills()).sort((a, b) => a.name.localeCompare(b.name));
  filterSkills();
};

const deleteSkillWithPrompt = async (skill: Skill) => {
  if (!confirm(`Delete skill "${skill.name}"?`)) return;
  await deleteSkill(skill.name);
  editingSkill = null;
  await loadSkills();
};

const saveEditingSkill = async () => {
  if (!editingSkill) return;
  const now = new Date().toISOString();
  const toSave: Skill = {
    ...editingSkill,
    createdAt: editingSkill.createdAt || now,
    lastUpdated: now,
  };
  await saveSkill(toSave);
  editingSkill = null;
  await loadSkills();
};

const coerceSkill = (raw: unknown): Skill | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) return null;
  const domainPatterns = Array.isArray(obj.domainPatterns)
    ? obj.domainPatterns.map((pattern) => String(pattern).trim()).filter(Boolean)
    : [];
  const createdAt = typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString();
  const lastUpdated = typeof obj.lastUpdated === "string" ? obj.lastUpdated : createdAt;
  return {
    name,
    domainPatterns,
    shortDescription: typeof obj.shortDescription === "string" ? obj.shortDescription : "",
    description: typeof obj.description === "string" ? obj.description : "",
    examples: typeof obj.examples === "string" ? obj.examples : "",
    library: typeof obj.library === "string" ? obj.library : "",
    createdAt,
    lastUpdated,
  };
};

const exportSkills = async () => {
  const all = await listSkills();
  const json = JSON.stringify(all, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `summarize-skills-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const importSkills = async () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    void (async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          setStatus("Invalid skills file: expected an array.");
          return;
        }
        const incoming = parsed.map(coerceSkill).filter((skill): skill is Skill => Boolean(skill));
        importedSkills = incoming;

        const conflicts: Array<{ skill: Skill; selected: boolean }> = [];
        for (const skill of incoming) {
          const existing = await getSkill(skill.name);
          if (existing) conflicts.push({ skill, selected: true });
        }

        if (conflicts.length > 0) {
          importConflicts = conflicts;
          renderSkills();
          return;
        }

        await performImport(incoming);
      } catch (error) {
        setStatus(
          `Failed to import skills: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  });
  input.click();
};

const performImport = async (skills: Skill[]) => {
  const skip = new Set(importConflicts.filter((c) => !c.selected).map((c) => c.skill.name));
  const toImport = skills.filter((skill) => !skip.has(skill.name));
  for (const skill of toImport) {
    await saveSkill(skill);
  }
  importConflicts = [];
  importedSkills = [];
  await loadSkills();
  setStatus(`Imported ${toImport.length} skill(s).`);
  setTimeout(() => setStatus(""), 900);
};

skillsSearchEl.addEventListener("input", () => {
  skillsSearchQuery = skillsSearchEl.value.trim();
  filterSkills();
});

skillsExportBtn.addEventListener("click", () => {
  void exportSkills();
});

skillsImportBtn.addEventListener("click", () => {
  void importSkills();
});

const updateHoverSummariesToggle = () => {
  hoverSummariesToggle.update({
    id: "options-hover-summaries",
    label: "Hover summaries (experimental)",
    checked: hoverSummariesValue,
    onCheckedChange: handleHoverSummariesToggleChange,
  });
};
const handleHoverSummariesToggleChange = (checked: boolean) => {
  hoverSummariesValue = checked;
  updateHoverSummariesToggle();
  scheduleAutoSave(0);
};
const hoverSummariesToggle = mountCheckbox(hoverSummariesToggleRoot, {
  id: "options-hover-summaries",
  label: "Hover summaries (experimental)",
  checked: hoverSummariesValue,
  onCheckedChange: handleHoverSummariesToggleChange,
});

const updateSummaryTimestampsToggle = () => {
  summaryTimestampsToggle.update({
    id: "options-summary-timestamps",
    label: "Summary timestamps (media only)",
    checked: summaryTimestampsValue,
    onCheckedChange: handleSummaryTimestampsToggleChange,
  });
};
const handleSummaryTimestampsToggleChange = (checked: boolean) => {
  summaryTimestampsValue = checked;
  updateSummaryTimestampsToggle();
  scheduleAutoSave(0);
};
const summaryTimestampsToggle = mountCheckbox(summaryTimestampsToggleRoot, {
  id: "options-summary-timestamps",
  label: "Summary timestamps (media only)",
  checked: summaryTimestampsValue,
  onCheckedChange: handleSummaryTimestampsToggleChange,
});

const updateSlidesParallelToggle = () => {
  slidesParallelToggle.update({
    id: "options-slides-parallel",
    label: "Show summary first (parallel slides)",
    checked: slidesParallelValue,
    onCheckedChange: handleSlidesParallelToggleChange,
  });
};
const handleSlidesParallelToggleChange = (checked: boolean) => {
  slidesParallelValue = checked;
  updateSlidesParallelToggle();
  scheduleAutoSave(0);
};
const slidesParallelToggle = mountCheckbox(slidesParallelToggleRoot, {
  id: "options-slides-parallel",
  label: "Show summary first (parallel slides)",
  checked: slidesParallelValue,
  onCheckedChange: handleSlidesParallelToggleChange,
});

const updateSlidesOcrToggle = () => {
  slidesOcrToggle.update({
    id: "options-slides-ocr",
    label: "Enable OCR slide text",
    checked: slidesOcrEnabledValue,
    onCheckedChange: handleSlidesOcrToggleChange,
  });
};
const handleSlidesOcrToggleChange = (checked: boolean) => {
  slidesOcrEnabledValue = checked;
  updateSlidesOcrToggle();
  scheduleAutoSave(0);
};
const slidesOcrToggle = mountCheckbox(slidesOcrToggleRoot, {
  id: "options-slides-ocr",
  label: "Enable OCR slide text",
  checked: slidesOcrEnabledValue,
  onCheckedChange: handleSlidesOcrToggleChange,
});

const updateExtendedLoggingToggle = () => {
  extendedLoggingToggle.update({
    id: "options-extended-logging",
    label: "Extended logging (send full input/output to daemon logs)",
    checked: extendedLoggingValue,
    onCheckedChange: handleExtendedLoggingToggleChange,
  });
};
const handleExtendedLoggingToggleChange = (checked: boolean) => {
  extendedLoggingValue = checked;
  updateExtendedLoggingToggle();
  scheduleAutoSave(0);
};
const extendedLoggingToggle = mountCheckbox(extendedLoggingToggleRoot, {
  id: "options-extended-logging",
  label: "Extended logging (send full input/output to daemon logs)",
  checked: extendedLoggingValue,
  onCheckedChange: handleExtendedLoggingToggleChange,
});

const updateAutoCliFallbackToggle = () => {
  autoCliFallbackToggle.update({
    id: "options-auto-cli-fallback",
    label: "Auto CLI fallback for Auto model",
    checked: autoCliFallbackValue,
    onCheckedChange: handleAutoCliFallbackToggleChange,
  });
};
const handleAutoCliFallbackToggleChange = (checked: boolean) => {
  autoCliFallbackValue = checked;
  updateAutoCliFallbackToggle();
  scheduleAutoSave(0);
};
const autoCliFallbackToggle = mountCheckbox(autoCliFallbackToggleRoot, {
  id: "options-auto-cli-fallback",
  label: "Auto CLI fallback for Auto model",
  checked: autoCliFallbackValue,
  onCheckedChange: handleAutoCliFallbackToggleChange,
});

async function load() {
  const s = await loadSettings();
  tokenEl.value = s.token;
  void checkDaemonStatus(s.token);
  await modelPresets.refreshPresets(s.token);
  modelPresets.setValue(s.model);
  {
    const resolved = resolvePresetOrCustom({ value: s.language, presets: languagePresets });
    languagePresetEl.value = resolved.presetValue;
    languageCustomEl.hidden = !resolved.isCustom;
    languageCustomEl.value = resolved.customValue;
  }
  promptOverrideEl.value = s.promptOverride;
  hoverPromptEl.value = s.hoverPrompt || defaultSettings.hoverPrompt;
  autoValue = s.autoSummarize;
  chatEnabledValue = s.chatEnabled;
  automationEnabledValue = s.automationEnabled;
  hoverSummariesValue = s.hoverSummaries;
  summaryTimestampsValue = s.summaryTimestamps;
  slidesParallelValue = s.slidesParallel;
  slidesOcrEnabledValue = s.slidesOcrEnabled;
  extendedLoggingValue = s.extendedLogging;
  autoCliFallbackValue = s.autoCliFallback;
  updateAutoToggle();
  updateChatToggle();
  updateAutomationToggle();
  updateHoverSummariesToggle();
  updateSummaryTimestampsToggle();
  updateSlidesParallelToggle();
  updateSlidesOcrToggle();
  updateExtendedLoggingToggle();
  updateAutoCliFallbackToggle();
  autoCliOrderEl.value = s.autoCliOrder;
  maxCharsEl.value = String(s.maxChars);
  requestModeEl.value = s.requestMode;
  firecrawlModeEl.value = s.firecrawlMode;
  markdownModeEl.value = s.markdownMode;
  preprocessModeEl.value = s.preprocessMode;
  youtubeModeEl.value = s.youtubeMode;
  transcriberEl.value = s.transcriber;
  timeoutEl.value = s.timeout;
  retriesEl.value = typeof s.retries === "number" ? String(s.retries) : "";
  maxOutputTokensEl.value = s.maxOutputTokens;
  fontFamilyEl.value = s.fontFamily;
  fontSizeEl.value = String(s.fontSize);
  currentScheme = s.colorScheme;
  currentMode = s.colorMode;
  pickers.update({ scheme: currentScheme, mode: currentMode, ...pickerHandlers });
  applyTheme({ scheme: s.colorScheme, mode: s.colorMode });
  await loadSkills();
  await updateAutomationPermissionsUi();
  if (resolveActiveTab() === "logs") {
    logsViewer.handleTokenChanged();
  }
  if (resolveActiveTab() === "processes") {
    processesViewer.handleTokenChanged();
  }
  isInitializing = false;
}

let refreshTimer = 0;
tokenEl.addEventListener("input", () => {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void modelPresets.refreshPresets(tokenEl.value);
    void checkDaemonStatus(tokenEl.value);
    logsViewer.handleTokenChanged();
    processesViewer.handleTokenChanged();
  }, 350);
  scheduleAutoSave(600);
});

const copyToken = async () => {
  const token = tokenEl.value.trim();
  if (!token) {
    flashStatus("Token empty");
    return;
  }
  try {
    await navigator.clipboard.writeText(token);
    flashStatus("Token copied");
    return;
  } catch {
    // fallback
  }
  tokenEl.focus();
  tokenEl.select();
  tokenEl.setSelectionRange(0, token.length);
  const ok = document.execCommand("copy");
  flashStatus(ok ? "Token copied" : "Copy failed");
};

tokenCopyBtn.addEventListener("click", () => {
  void copyToken();
});

const refreshModelsIfStale = () => {
  modelPresets.refreshIfStale(tokenEl.value);
};

modelPresetEl.addEventListener("focus", refreshModelsIfStale);
modelPresetEl.addEventListener("pointerdown", refreshModelsIfStale);
modelCustomEl.addEventListener("focus", refreshModelsIfStale);
modelCustomEl.addEventListener("pointerdown", refreshModelsIfStale);

languagePresetEl.addEventListener("change", () => {
  languageCustomEl.hidden = languagePresetEl.value !== "custom";
  if (!languageCustomEl.hidden) languageCustomEl.focus();
  scheduleAutoSave(200);
});

hoverPromptResetBtn.addEventListener("click", () => {
  hoverPromptEl.value = defaultSettings.hoverPrompt;
  scheduleAutoSave(200);
});

modelPresetEl.addEventListener("change", () => {
  modelCustomEl.hidden = modelPresetEl.value !== "custom";
  if (!modelCustomEl.hidden) modelCustomEl.focus();
  scheduleAutoSave(200);
});

modelCustomEl.addEventListener("input", () => {
  scheduleAutoSave(600);
});

languageCustomEl.addEventListener("input", () => {
  scheduleAutoSave(600);
});

promptOverrideEl.addEventListener("input", () => {
  scheduleAutoSave(600);
});

hoverPromptEl.addEventListener("input", () => {
  scheduleAutoSave(600);
});

maxCharsEl.addEventListener("input", () => {
  scheduleAutoSave(400);
});

requestModeEl.addEventListener("change", () => {
  scheduleAutoSave(200);
});

firecrawlModeEl.addEventListener("change", () => {
  scheduleAutoSave(200);
});

markdownModeEl.addEventListener("change", () => {
  scheduleAutoSave(200);
});

preprocessModeEl.addEventListener("change", () => {
  scheduleAutoSave(200);
});

youtubeModeEl.addEventListener("change", () => {
  scheduleAutoSave(200);
});

transcriberEl.addEventListener("change", () => {
  scheduleAutoSave(200);
});

timeoutEl.addEventListener("input", () => {
  scheduleAutoSave(400);
});

retriesEl.addEventListener("input", () => {
  scheduleAutoSave(300);
});

maxOutputTokensEl.addEventListener("input", () => {
  scheduleAutoSave(300);
});

autoCliOrderEl.addEventListener("input", () => {
  scheduleAutoSave(300);
});

fontFamilyEl.addEventListener("input", () => {
  scheduleAutoSave(600);
});

fontSizeEl.addEventListener("input", () => {
  scheduleAutoSave(300);
});

logsSourceEl.addEventListener("change", () => {
  void logsViewer.refresh();
});

logsTailEl.addEventListener("change", () => {
  void logsViewer.refresh();
});

logsParsedEl.addEventListener("change", () => {
  logsViewer.render();
});

for (const input of logsLevelInputs) {
  input.addEventListener("change", () => {
    logsViewer.render();
  });
}

logsAutoEl.addEventListener("change", () => {
  if (logsAutoEl.checked) {
    logsViewer.startAuto();
    void logsViewer.refresh();
  } else {
    logsViewer.stopAuto();
  }
});

window.addEventListener("beforeunload", () => {
  logsViewer.stopAuto();
});

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  void saveNow();
});

setBuildInfo();
void load();
