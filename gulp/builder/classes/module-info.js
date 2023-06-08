/**
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toPosix } = require('../../../lib/platform/path');
const transliterate = require('../../../lib/transliterate'),
   BaseModuleInfo = require('../../common/classes/base-module-info');

function isModuleUnitTest(name) {
   return (
      name.endsWith('Test') ||
      name.endsWith('Unit') ||
      name.endsWith('Tests')
   );
}

/**
 * Класс для работы с модулями проекта. Накапливает данные о модулях, которые плохо ложатся на кеш
 */
class ModuleInfo extends BaseModuleInfo {
   constructor(baseModuleInfo, commonOutputPath, staticServer) {
      super(baseModuleInfo);
      this.outputName = transliterate(path.basename(baseModuleInfo.path));
      this.output = path.join(commonOutputPath, this.outputName);
      this.outputRoot = path.dirname(this.output);

      // объект для записи contents.json
      // availableLanguage, defaultLanguage добавляются только при локализации
      const runtimeModuleInfo = {};
      if (this.folderName !== this.runtimeModuleName) {
         runtimeModuleInfo.name = this.folderName;
      }
      if (staticServer && baseModuleInfo.name === 'HotReload') {
         runtimeModuleInfo.staticServer = staticServer;
      }
      this.contents = {
         htmlNames: {},
         modules: {
            [this.runtimeModuleName]: runtimeModuleInfo
         }
      };

      // объект для записи static_templates.json
      // соответствие запроса html физическиому расположению файла
      this.staticTemplates = {};

      // объект для записи navigation-modules.json
      this.navigationModules = [];

      this.filesHash = {};

      this.isUnitTestModule = isModuleUnitTest(this.name);

      this.icons = this.name.endsWith('-icons');

      this.umdModules = new Set();
   }

   addFileHash(fileName, hash) {
      this.filesHash[fileName] = hash;
   }

   addUMDModule(filePath) {
      this.umdModules.add(toPosix(filePath));
   }

   hasUMDModule(filePath) {
      return this.umdModules.has(toPosix(filePath));
   }

   getSortedHashList() {
      const result = [];
      Object.keys(this.filesHash).forEach(currentFile => result.push(this.filesHash[currentFile]));
      return result.sort();
   }
}

module.exports = ModuleInfo;
