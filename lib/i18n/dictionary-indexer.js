'use strict';

const { path, toSafePosix } = require('../../lib/platform/path');

const cssHelpers = require('../../packer/lib/css-helpers');
const resolveUrl = cssHelpers.rebaseUrls;
const indexer = {};

class DictionaryIndexer {
   constructor(localizations) {
      this.localizations = localizations;

      // множество ресурсов локализации:
      // 'en-US' - словарь
      // 'en-US.css' - стили
      this.dictionaryForContents = {};

      // список всех css для локализациёй
      // {<локаль>: [{filePath:<путь до файла>, text: <текст файла>}, ...], ...}
      this.cssStore = {};

      /**
       * full list of locales with specific locales for current region
       * @type {{}}
       */
      this.dictsStore = {};
   }

   addDictionary(locale, dictionary = locale) {
      if (!this.dictionaryForContents[locale]) {
         this.dictionaryForContents[locale] = [];
      }

      if (!this.dictionaryForContents[locale].includes(dictionary)) {
         this.dictionaryForContents[locale].push(dictionary);
      }
   }

   addLocalizationJson(modulePath, filePath, locale, region, text) {
      if (this.localizations.includes(locale)) {
         if (!this.dictsStore[locale]) {
            this.dictsStore[locale] = {};
         }
         if (region) {
            const expectedFilePath = path.join(modulePath, 'lang', locale, `${region}.json`);
            if (toSafePosix(filePath) === toSafePosix(expectedFilePath)) {
               this.addDictionary(locale, region.includes('-') ? region : `${locale}-${region}`);
               this.dictsStore[locale][region] = text;
            }
         } else {
            const expectedFilePath = path.join(modulePath, 'lang', locale, `${locale}.json`);
            if (toSafePosix(filePath) === toSafePosix(expectedFilePath)) {
               if (locale.includes('-')) {
                  this.addDictionary(locale.split('-')[0], locale);
               } else {
                  this.addDictionary(locale);
               }
               this.dictsStore[locale].default = text;
            }
         }
      }
   }

   addLocalizationCSS(filePath, locale, text) {
      if (this.localizations.includes(locale)) {
         this.addDictionary(locale, `${locale}.css`);
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

   getDictionaryForContents(language) {
      if (!language) {
         const result = [];

         Object.keys(this.dictionaryForContents).forEach((locale) => {
            if (this.dictionaryForContents[locale] instanceof Array) {
               result.push(...this.dictionaryForContents[locale]);
            }
         });

         return result;
      }

      return this.dictionaryForContents[language] || [];
   }
}

module.exports = {
   setDictionaryIndexer(moduleName, localizations) {
      indexer[moduleName] = new DictionaryIndexer(localizations);
   },
   indexer(moduleName) {
      return indexer[moduleName];
   }
};
