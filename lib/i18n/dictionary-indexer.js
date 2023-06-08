'use strict';

const { path, toSafePosix } = require('../../lib/platform/path');

const cssHelpers = require('../../packer/lib/css-helpers');
const resolveUrl = cssHelpers.rebaseUrls;

class DictionaryIndexer {
   constructor(localizations) {
      this.localizations = localizations;

      // множество ресурсов локализации:
      // 'en-US' - словарь
      // 'en-US.css' - стили
      this.dictionaryForContents = new Set();

      // список всех css для локализациёй
      // {<локаль>: [{filePath:<путь до файла>, text: <текст файла>}, ...], ...}
      this.cssStore = {};

      /**
       * full list of locales with specific locales for current region
       * @type {{}}
       */
      this.dictsStore = {};
   }

   addLocalizationJson(modulePath, filePath, locale, region, text) {
      if (this.localizations.includes(locale)) {
         if (!this.dictsStore[locale]) {
            this.dictsStore[locale] = {};
         }
         if (region) {
            const expectedFilePath = path.join(modulePath, 'lang', locale, `${region}.json`);
            if (toSafePosix(filePath) === toSafePosix(expectedFilePath)) {
               this.dictionaryForContents.add(
                  region.includes('-') ? region : `${locale}-${region}`
               );
               this.dictsStore[locale][region] = text;
            }
         } else {
            const expectedFilePath = path.join(modulePath, 'lang', locale, `${locale}.json`);
            if (toSafePosix(filePath) === toSafePosix(expectedFilePath)) {
               this.dictionaryForContents.add(locale);
               this.dictsStore[locale].default = text;
            }
         }
      }
   }

   addLocalizationCSS(filePath, locale, text) {
      if (this.localizations.includes(locale)) {
         this.dictionaryForContents.add(`${locale}.css`);
         if (filePath.endsWith('.css')) {
            if (!this.cssStore.hasOwnProperty(locale)) {
               this.cssStore[locale] = [];
            }
            this.cssStore[locale].push({
               filePath,
               text
            });
         }
      }
   }

   extractMergedDicts(locale) {
      if (!this.dictsStore[locale]) {
         return null;
      }

      const currentDictionaryRegions = Object.keys(this.dictsStore[locale])
         .filter(currentKey => currentKey !== 'default');
      if (currentDictionaryRegions.length === 0) {
         return null;
      }
      const defaultDictionary = this.dictsStore[locale].default;
      const result = {};
      currentDictionaryRegions.forEach((currentRegion) => {
         const currentRegionDictContent = this.dictsStore[locale][currentRegion];
         if (!defaultDictionary) {
            result[currentRegion] = currentRegionDictContent;
         } else {
            result[currentRegion] = { ...defaultDictionary };
            Object.keys(currentRegionDictContent).forEach((currentRegionKey) => {
               result[currentRegion][currentRegionKey] = currentRegionDictContent[currentRegionKey];
            });
         }
      });
      return result;
   }

   extractMergedCSSCode(modulePath, locale) {
      if (!this.cssStore.hasOwnProperty(locale)) {
         return '';
      }

      // порядок должен быть строго определён, чтобы не падали интеграционные тесты
      this.cssStore[locale].sort((a, b) => {
         if (a.filePath > b.filePath) {
            return 1;
         }
         if (a.filePath < b.filePath) {
            return -1;
         }
         return 0;
      });
      return this.cssStore[locale].map(
         cssObj => resolveUrl({
            root: path.dirname(modulePath),
            sourceFile: cssObj.filePath,
            css: cssObj.text,
            relativePackagePath: path.basename(modulePath)
         })
      ).join('\n');
   }

   getDictionaryForContents() {
      return [...this.dictionaryForContents];
   }
}

module.exports = DictionaryIndexer;
