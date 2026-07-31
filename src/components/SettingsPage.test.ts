import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('./SettingsPage.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

const categoryPanels = {
  ledger: [
    'LedgerCurrencySettingsPanel',
    'EcbReferenceRateSettings',
    'EmergencyFundSettings',
  ],
  references: ['ReferenceDataSettings'],
  data: ['LedgerBackupSettings'],
  appearance: [
    "t('languageAndDisplay')",
    "t('appUpdatesTitle')",
    "t('supportHushLedgerTitle')",
  ],
  connections: ['AiProviderSettingsForm'],
} as const

describe('settings page categories', () => {
  it('defines the five Calm Focus categories in the approved order', () => {
    const categoryDefinition = source.match(
      /export const SETTINGS_CATEGORIES = \[(.*?)\] as const/s,
    )?.[1] ?? ''

    const orderedCategoryIds = [
      'ledger',
      'references',
      'data',
      'appearance',
      'connections',
    ]
    const orderedLabelKeys = [
      'settingsCategoryLedger',
      'settingsCategoryReferences',
      'settingsCategoryData',
      'settingsCategoryAppearance',
      'settingsCategoryConnections',
    ]

    let previousIndex = -1
    orderedCategoryIds.forEach((id, index) => {
      const idIndex = categoryDefinition.indexOf(`id: '${id}'`)
      assert.ok(idIndex > previousIndex, `${id} should follow the approved category order`)
      assert.match(categoryDefinition, new RegExp(`labelKey: '${orderedLabelKeys[index]}'`))
      previousIndex = idIndex
    })
  })

  it('uses accessible pressed-state controls and a labelled content region', () => {
    assert.match(source, /<nav className="settings-category-navigation" aria-label=/)
    assert.match(source, /aria-pressed=\{selected\}/)
    assert.match(source, /aria-controls="settings-category-content"/)
    assert.match(source, /id="settings-category-content"/)
    assert.match(source, /role="region"/)
    assert.match(source, /aria-label=\{t\(activeCategoryConfig\.labelKey\)\}/)
  })

  it('opens contextual settings entry points in their intended categories', () => {
    assert.match(source, /activeCategory: SettingsCategory/)
    assert.match(source, /onCategoryChange: \(category: SettingsCategory\) => void/)
    assert.match(appSource, /onReview=\{\(\) => openSettings\('data'\)\}/)
    assert.match(appSource, /onManage=\{\(\) => openSettings\('ledger'\)\}/)
    assert.match(appSource, /onConfigure=\{\(\) => openSettings\('connections'\)\}/)
    assert.match(appSource, /activeCategory=\{settingsCategory\}/)
    assert.match(appSource, /onCategoryChange=\{setSettingsCategory\}/)
  })

  it('keeps each existing panel mounted inside its owning hidden category pane', () => {
    const renderSource = source.slice(source.indexOf('id="settings-category-content"'))

    for (const [category, panels] of Object.entries(categoryPanels)) {
      const nextCategory = Object.keys(categoryPanels)[
        Object.keys(categoryPanels).indexOf(category) + 1
      ]
      const start = renderSource.indexOf(`hidden={activeCategory !== '${category}'}`)
      const end = nextCategory
        ? renderSource.indexOf(`hidden={activeCategory !== '${nextCategory}'}`, start)
        : renderSource.indexOf('</div>', renderSource.indexOf('AiProviderSettingsForm', start))
      const categorySource = renderSource.slice(start, end)

      assert.ok(start >= 0, `${category} should have a persistent hidden pane`)
      for (const panel of panels) {
        assert.ok(categorySource.includes(panel), `${panel} should render in ${category}`)
        assert.equal(
          renderSource.split(panel).length - 1,
          1,
          `${panel} should appear only where expected`,
        )
      }
    }
  })
})
