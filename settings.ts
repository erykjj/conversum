// settings.ts

import { App, PluginSettingTab, SettingDefinitionItem, Notice } from 'obsidian';
import { getAvailableLanguages, getEngineVersion } from './engine-wrapper';
import { NameFormat } from './types';
import type ConversumPlugin from './main';

export class ConversumSettingTab extends PluginSettingTab {
    plugin: ConversumPlugin;

    constructor(app: App, plugin: ConversumPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        const s = this.plugin.settings as unknown as Record<string, unknown>;

        switch (key) {
            case 'sourceLanguage': {
                s.sourceLanguage = value;
                await this.plugin.saveSettings();
                this.plugin.updateIndexerSettings();
                await this.plugin.rebuildIndex();
                new Notice(`Source language updated to ${String(value)}. Reindexing complete.`);
                break;
            }
            case 'outputLanguage': {
                s.outputLanguage = value;
                await this.plugin.saveSettings();
                this.plugin.updateIndexerSettings();
                await this.plugin.reformatAllReferences();
                new Notice(`Output language updated to ${String(value)}`);
                break;
            }
            case 'nameFormat': {
                s.nameFormat = value as NameFormat;
                await this.plugin.saveSettings();
                this.plugin.updateIndexerSettings();
                await this.plugin.reformatAllReferences();
                break;
            }
            case 'autoIndex': {
                s.autoIndex = value;
                await this.plugin.saveSettings();
                if (value) {
                    this.plugin.startFileWatcher();
                    const data = this.plugin.indexer?.getData();
                    if (!data || Object.keys(data.references).length === 0) {
                        await this.plugin.rebuildIndex();
                    }
                } else {
                    this.plugin.stopFileWatcher();
                }
                break;
            }
        }
    }

    private renderStatus(el: HTMLElement): void {
        el.empty();
        const statusEl = el.createDiv({ cls: 'conversum-status' });
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

        const isFormatting = this.plugin.isFormattingBusy();
        const unformatted = this.plugin.getUnformattedCount();
        if (isFormatting) {
            statusEl.createEl('p', {
                text: `Formatting in progress... (${unformatted} remaining)`,
                cls: 'conversum-status-item conversum-status-formatting',
            });
        } else if (unformatted > 0) {
            statusEl.createEl('p', {
                text: `${unformatted} references need formatting`,
                cls: 'conversum-status-item conversum-status-warning',
            });
        } else if (refCount > 0) {
            statusEl.createEl('p', {
                text: 'All references formatted',
                cls: 'conversum-status-item conversum-status-ok',
            });
        }
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
                    await this.plugin.rebuildIndex();
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
                        desc: 'Language of the scripture references in your notes. Changing this will force a full reindex.',
                        control: {
                            type: 'dropdown',
                            key: 'sourceLanguage',
                            options: langOptions,
                        },
                    },
                    {
                        name: 'Output language',
                        desc: 'Language for displaying book names and references',
                        control: {
                            type: 'dropdown',
                            key: 'outputLanguage',
                            options: langOptions,
                        },
                    },
                    {
                        name: 'Reference format',
                        desc: 'How scripture references are displayed',
                        control: {
                            type: 'dropdown',
                            key: 'nameFormat',
                            options: {
                                full: 'Full (1 Corinthians)',
                                standard: 'Standard (1 Cor.)',
                                official: 'Official (1Co)',
                            },
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
                        control: {
                            type: 'toggle',
                            key: 'autoIndex',
                            defaultValue: true,
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