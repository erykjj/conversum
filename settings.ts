// settings.ts

import { PluginSettingTab, Setting, Notice } from 'obsidian';
import { getAvailableLanguages, getEngineVersion } from './engine-wrapper';
import type ConversumPlugin from './main';

export class ConversumSettingTab extends PluginSettingTab {
    plugin: ConversumPlugin;

    constructor(app: any, plugin: ConversumPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const headerEl = containerEl.createDiv({ cls: 'conversum-settings-header' });
        headerEl.createSpan({ text: 'con[VER]sum', cls: 'conversum-settings-title' });
        const engineVersion = getEngineVersion();
        headerEl.createSpan({ 
            text: `v${this.plugin.manifest.version} – ${engineVersion}`,
            cls: 'conversum-version-info'
        });
        new Setting(containerEl).setName('Language Settings').setHeading();
        const languages = getAvailableLanguages();
        const nonAslLanguages = languages.filter((l: any) => l.code !== 'ase');
        new Setting(containerEl)
            .setName('Source language')
            .setDesc('Language of the scripture references in your notes. Changing this will force a full reindex of all notes.')
            .addDropdown((dropdown) => {
                for (const lang of nonAslLanguages) {
                    dropdown.addOption(lang.code, `${lang.vernacularName} (${lang.code})`);
                }
                dropdown.setValue(this.plugin.settings.sourceLanguage);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.sourceLanguage = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateIndexerSettings();
                    await this.plugin.rebuildIndex();
                    this.display();
                    new Notice(`Source language updated to ${value}. Reindexing complete.`);
                });
            });
        new Setting(containerEl)
            .setName('Output language')
            .setDesc('Language for displaying book names and references')
            .addDropdown((dropdown) => {
                const filteredLanguages = languages.filter((l: any) => l.code !== 'ase');
                for (const lang of filteredLanguages) {
                    dropdown.addOption(lang.code, `${lang.vernacularName} (${lang.code})`);
                }
                dropdown.setValue(this.plugin.settings.outputLanguage);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.outputLanguage = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateIndexerSettings();
                    await this.plugin.reformatAllReferences();
                    this.display();
                    new Notice(`Output language updated to ${value}`);
                });
            });
        new Setting(containerEl)
            .setName('Reference format')
            .setDesc('How scripture references are displayed')
            .addDropdown((dropdown) => {
                dropdown.addOption('full', 'Full (1 Corinthians)');
                dropdown.addOption('standard', 'Standard (1 Cor.)');
                dropdown.addOption('official', 'Official (1Co)');
                dropdown.setValue(this.plugin.settings.nameFormat);
                dropdown.onChange(async (value: string) => {
                    this.plugin.settings.nameFormat = value as 'full' | 'standard' | 'official';
                    await this.plugin.saveSettings();
                    this.plugin.updateIndexerSettings();
                    await this.plugin.reformatAllReferences();
                    this.display();
                });
            });
        new Setting(containerEl).setName('Index Settings').setHeading();
        new Setting(containerEl)
            .setName('Auto-index')
            .setDesc('Automatically update the index when files change.')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.autoIndex);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoIndex = value;
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
                    this.display();
                });
            });
        new Setting(containerEl)
            .setName('Excluded folders')
            .setDesc('Additional folders to exclude from indexing (comma-separated). _templates, _attachments, and .obsidian are always excluded.')
            .addText((text) => {
                text.setPlaceholder('my_notes, drafts, archive');
                text.setValue(this.plugin.settings.excludedFolders.join(', '));
                text.onChange(async (value) => {
                    const folders = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
                    this.plugin.settings.excludedFolders = folders;
                    await this.plugin.saveSettings();
                    this.plugin.updateIndexerSettings();
                    if (this.plugin.settings.autoIndex) {
                        await this.plugin.rebuildIndex();
                    }
                    this.display();
                });
            });
        new Setting(containerEl)
            .setName('Rebuild index')
            .setDesc('Force a full rebuild of the concordance index')
            .addButton((button) => {
                button.setButtonText('Rebuild');
                button.setCta();
                button.onClick(async () => {
                    if (this.plugin.indexer?.isBusy()) {
                        new Notice('Indexing already in progress');
                        return;
                    }
                    await this.plugin.rebuildIndex();
                    this.display();
                });
            });
        const statusEl = containerEl.createDiv({ cls: 'conversum-status' });
        const data = this.plugin.indexer?.getData();
        const lastUpdated = data?.lastUpdated;
        const refCount = data ? Object.keys(data.references).length : 0;
        if (lastUpdated && lastUpdated > 0) {
            const date = new Date(lastUpdated);
            statusEl.createEl('p', {
                text: `Index updated: ${date.toLocaleString()}`,
                cls: 'conversum-status-item'
            });
        } else {
            statusEl.createEl('p', {
                text: 'Index not built',
                cls: 'conversum-status-item'
            });
        }
        statusEl.createEl('p', {
            text: `Unique references: ${refCount}`,
            cls: 'conversum-status-item'
        });
        const isFormatting = this.plugin.isFormattingBusy();
        const unformatted = this.plugin.getUnformattedCount();
        if (isFormatting) {
            statusEl.createEl('p', {
                text: `Formatting in progress... (${unformatted} remaining)`,
                cls: 'conversum-status-item conversum-status-formatting'
            });
        } else if (unformatted > 0) {
            statusEl.createEl('p', {
                text: `${unformatted} references need formatting`,
                cls: 'conversum-status-item conversum-status-warning'
            });
        } else if (refCount > 0) {
            statusEl.createEl('p', {
                text: 'All references formatted',
                cls: 'conversum-status-item conversum-status-ok'
            });
        }
        const footerEl = containerEl.createDiv({ cls: 'conversum-settings-footer' });
        footerEl.style.marginTop = '20px';
        footerEl.style.paddingTop = '12px';
        footerEl.style.borderTop = '1px solid var(--background-modifier-border)';
        footerEl.style.fontSize = '0.75rem';
        footerEl.style.color = 'var(--text-muted)';
        footerEl.style.textAlign = 'center';
        footerEl.innerHTML = `
            My other Obsidian plugin: <strong>tra.VER:ture</strong>:
            <a href="https://github.com/erykjj/traverture" target="_blank" rel="noopener noreferrer">GitHub repo</a>,
            <a href="https://community.obsidian.md/plugins/traverture" target="_blank" rel="noopener noreferrer">Obsidian Community</a>
        `;
    }
}