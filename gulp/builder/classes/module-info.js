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
 * @class ModuleInfo
 * @public
 */
class ModuleInfo extends BaseModuleInfo {
   constructor(baseModuleInfo, countries, outputPaths = {}, staticServer) {
      super(baseModuleInfo);
      const { output, changedFilesOutput } = outputPaths;
      this.outputName = transliterate(path.basename(baseModuleInfo.path));

      // формируем список конечных директорий под каждый регион.
      if (countries) {
         this.regionOutput = {};

         countries.forEach((region) => {
            if (region !== 'RU') {
               if (changedFilesOutput) {
                  this.regionOutput[region] = path.join(`${changedFilesOutput}_${region}`, this.outputName);
               } else {
                  this.regionOutput[region] = path.join(`${output}_${region}`, this.outputName);
               }
            }
         });
      }

      this.output = path.join(output, this.outputName);
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

      this.metaTsFiles = [];

      // объект для записи navigation-modules.json
      this.navigationModules = [];

      this.isUnitTestModule = isModuleUnitTest(this.name);

      // we need to generate fonts for icons only if module
      // *-icons has icons folder
      if (this.name.endsWith('-icons')) {
         this.icons = true;
      }

      this.umdModules = new Set();
      this.tailwindInfo = undefined;
   }

   addMetaTsFile(filePath) {
      this.metaTsFiles.push(filePath);
   }

   addUMDModule(filePath) {
      this.umdModules.add(toPosix(filePath));
   }

   hasUMDModule(filePath) {
      return this.umdModules.has(toPosix(filePath));
   }
}

module.exports = ModuleInfo;
