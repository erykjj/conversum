// settings.ts

import { App, PluginSettingTab, SettingDefinitionItem, Notice } from 'obsidian';
import { getAvailableLanguages, getEngineVersion } from './engine-wrapper';
import type ConversumPlugin from './main';

export class ConversumSettingTab extends PluginSettingTab {
    plugin: ConversumPlugin;

    constructor(app: App, plugin: ConversumPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private renderStatus(el: HTMLElement): void {
        el.empty();
        const statusEl = el.createDiv({ cls: 'conversum-status' });

        if (this.plugin.isBatchInProgress() || this.plugin.indexer?.isBusy() || this.plugin.isRebuildInProgress()) {
                statusEl.createEl('p', { text: 'Indexing in progress...',
                cls: 'conversum-status-item conversum-status-formatting',
            });
        }

        const data = this.plugin.indexer?.getData();
        const lastUpdated = data?.lastUpdated;
        const refCount = data ? Object.keys(data.references).length : 0;

        if (lastUpdated && lastUpdated > 0) {
            statusEl.createEl('p', {
                text: `Index updated: ${new Date(lastUpdated).toLocaleString()}`,
                cls: 'conversum-status-item',
            });
        } else {
            statusEl.createEl('p', {
                text: 'Index not built',
                cls: 'conversum-status-item',
            });
        }
        statusEl.createEl('p', {
            text: `Unique references: ${refCount}`,
            cls: 'conversum-status-item',
        });
    }

    private renderExcludedFolders(setting: import('obsidian').Setting): void {
        setting.addText((text) => {
            text.setPlaceholder('my_notes, drafts, archive');
            text.setValue(this.plugin.settings.excludedFolders.join(', '));
            text.onChange(async (value) => {
                const folders = value
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                this.plugin.settings.excludedFolders = folders;
                await this.plugin.saveSettings();
                this.plugin.updateIndexerSettings();
                if (this.plugin.settings.autoIndex) {
                    void this.plugin.rebuildIndex();
                }
            });
        });
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const languages = getAvailableLanguages();
        const nonAslLanguages = languages.filter((l) => l.code !== 'ase');
        const langOptions: Record<string, string> = {};
        for (const l of nonAslLanguages) {
            langOptions[l.code] = `${l.vernacularName} (${l.code})`;
        }

        return [
            // ─── Header ───
            {
                name: '',
                render: (setting) => {
                    setting.settingEl.empty();
                    setting.settingEl.addClass('conversum-settings-header');
                    const headerEl = setting.settingEl.createDiv();
                    headerEl.createSpan({
                        text: 'con[VER]sum  ',
                        cls: 'conversum-settings-title',
                    });
                    headerEl.createSpan({
                        text: `v${this.plugin.manifest.version} \u2013 ${getEngineVersion()}`,
                        cls: 'conversum-version-info',
                    });
                },
            },

            // ─── Language ───
            {
                type: 'group',
                heading: 'Language',
                items: [
                    {
                        name: 'Source language',
                        desc: 'Language of the scripture references in your notes. Changing this forces a full reindex.',
                        render: (setting) => {
                            setting.addDropdown((dropdown) => {
                                for (const [code, label] of Object.entries(langOptions)) {
                                    dropdown.addOption(code, label);
                                }
                                dropdown
                                    .setValue(this.plugin.settings.sourceLanguage)
                                    .onChange(async (value) => {
                                        this.plugin.settings.sourceLanguage = value;
                                        await this.plugin.saveSettings();
                                        this.plugin.updateIndexerSettings();
                                        void this.plugin.rebuildIndex();
                                    });
                            });
                        },
                    },
                    {
                        name: 'Output language',
                        desc: 'Language for displaying book names and references',
                        render: (setting) => {
                            setting.addDropdown((dropdown) => {
                                for (const [code, label] of Object.entries(langOptions)) {
                                    dropdown.addOption(code, label);
                                }
                                dropdown
                                    .setValue(this.plugin.settings.outputLanguage)
                                    .onChange(async (value) => {
                                        this.plugin.settings.outputLanguage = value;
                                        await this.plugin.saveSettings();
                                        this.plugin.updateIndexerSettings();
                                        this.plugin.refreshConcordanceView();
                                    });
                            });
                        },
                    },
                    {
                        name: 'Reference format',
                        desc: 'How scripture references are displayed',
                        render: (setting) => {
                            setting.addDropdown((dropdown) => {
                                dropdown.addOption('full', 'Full (1 Corinthians)');
                                dropdown.addOption('standard', 'Standard (1 Cor.)');
                                dropdown.addOption('official', 'Official (1Co)');
                                dropdown
                                    .setValue(this.plugin.settings.nameFormat)
                                    .onChange(async (value) => {
                                        this.plugin.settings.nameFormat = value as 'full' | 'standard' | 'official';
                                        await this.plugin.saveSettings();
                                        this.plugin.updateIndexerSettings();
                                        this.plugin.refreshConcordanceView();
                                    });
                            });
                        },
                    },
                ],
            },

            // ─── Index ───
            {
                type: 'group',
                heading: 'Index',
                items: [
                    {
                        name: 'Auto-index',
                        desc: 'Automatically update the index when files change',
                        render: (setting) => {
                            setting.addToggle((toggle) => {
                                toggle
                                    .setValue(this.plugin.settings.autoIndex)
                                    .onChange(async (value) => {
                                        this.plugin.settings.autoIndex = value;
                                        await this.plugin.saveSettings();
                                        if (value) {
                                            void this.plugin.startFileWatcherWithCatchUp();
                                        } else {
                                            this.plugin.stopFileWatcher();
                                        }
                                        this.plugin.refreshConcordanceView();
                                    });
                            });
                        },
                    },
                    {
                        name: 'Excluded folders',
                        desc: 'Additional folders to exclude from indexing (comma-separated).',
                        render: (setting) => {
                            this.renderExcludedFolders(setting);
                        },
                    },
                    {
                        name: 'Rebuild index',
                        desc: 'Force a full rebuild of the concordance index',
                        render: (setting) => {
                            setting.settingEl.addClass('conversum-rebuild-row');
                            setting.addButton((button) => {
                                button.setButtonText('Rebuild');
                                button.setCta();
                                button.onClick(async () => {
                                    if (this.plugin.indexer?.isBusy()) {
                                        new Notice('Indexing already in progress');
                                        return;
                                    }
                                    await this.plugin.rebuildIndex();
                                    this.update();
                                });
                            });
                        },
                    },
                    {
                        name: '',
                        desc: '',
                        render: (setting) => {
                            setting.settingEl.addClass('conversum-status-row');
                            const control = setting.settingEl.querySelector('.setting-item-control') as HTMLElement;
                            if (control) {
                                control.empty();
                                this.renderStatus(control);
                            }
                        },
                    },
                ],
            },

            // ─── Footer ───
            {
                type: 'group',
                heading: '',
                items: [
                    {
                        name: '',
                        render: (setting) => {
                            setting.settingEl.empty();
                            setting.settingEl.addClass('conversum-settings-footer-row');
                            const footerEl = setting.settingEl.createDiv({ cls: 'conversum-settings-footer' });
                            footerEl.appendChild(
                                document.createTextNode('My other Obsidian plugins: ')
                            );

                            const entries: Array<[string, string]> = [
                                ['in(REF)ens', 'https://github.com/erykjj/inrefens'],
                                ['mu/TEX/tum', 'https://github.com/erykjj/mutextum'],
                                ['tra.VER:ture', 'https://github.com/erykjj/traverture'],
                            ];

                            entries.forEach(([text, href], i) => {
                                const strong = footerEl.createEl('strong');
                                const link = strong.createEl('a', { text, href });
                                link.setAttribute('target', '_blank');
                                link.setAttribute('rel', 'noopener noreferrer');
                                if (i < entries.length - 1) {
                                    footerEl.appendChild(document.createTextNode(', '));
                                }
                            });
                        },
                    },
                ],
            },
        ];
    }
}